const nodemailer = require('nodemailer');
const logger = require('../utils/logger');
const db = require('../config/database');

class EmailSendingService {
  constructor() {
    this.transporter = null;
    this.sentThisHour = 0;
    this.sentToday = 0;
    this.hourStart = Date.now();
    this.dayStart = Date.now();
  }

  /**
   * Initialize or get SMTP transporter
   */
  getTransporter() {
    const settings = this.getSettings();

    this.transporter = nodemailer.createTransport({
      host: settings.smtp_host || process.env.SMTP_HOST,
      port: parseInt(settings.smtp_port || process.env.SMTP_PORT || '465'),
      secure: (settings.smtp_secure || process.env.SMTP_SECURE) === 'true',
      auth: {
        user: settings.smtp_user || process.env.SMTP_USER,
        pass: settings.smtp_pass || process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    return this.transporter;
  }

  /**
   * Check rate limits
   */
  checkRateLimit() {
    const settings = this.getSettings();
    const maxPerHour = parseInt(settings.email_rate_per_hour || '50');
    const maxPerDay = parseInt(settings.email_rate_per_day || '500');

    // Reset hourly counter
    if (Date.now() - this.hourStart > 3600000) {
      this.sentThisHour = 0;
      this.hourStart = Date.now();
    }

    // Reset daily counter
    if (Date.now() - this.dayStart > 86400000) {
      this.sentToday = 0;
      this.dayStart = Date.now();
    }

    if (this.sentThisHour >= maxPerHour) {
      return { allowed: false, reason: 'Hourly rate limit reached' };
    }
    if (this.sentToday >= maxPerDay) {
      return { allowed: false, reason: 'Daily rate limit reached' };
    }

    return { allowed: true };
  }

  /**
   * Send a single email
   */
  async sendEmail(emailId) {
    // Check rate limit
    const rateCheck = this.checkRateLimit();
    if (!rateCheck.allowed) {
      logger.warn(`Rate limit: ${rateCheck.reason}`);
      return { success: false, error: rateCheck.reason };
    }

    // Get email details
    const email = db.prepare(`
      SELECT e.*, l.contact_email, l.contact_name, l.company_name
      FROM emails e
      JOIN leads l ON e.lead_id = l.id
      WHERE e.id = ?
    `).get(emailId);

    if (!email) {
      return { success: false, error: 'Email not found' };
    }

    if (!email.contact_email) {
      db.prepare('UPDATE emails SET status = ?, error_message = ? WHERE id = ?')
        .run('failed', 'No recipient email address', emailId);
      return { success: false, error: 'No recipient email' };
    }

    const settings = this.getSettings();
    const transporter = this.getTransporter();

    try {
      const mailOptions = {
        from: `"${settings.smtp_from_name || 'JH IT Zone'}" <${settings.smtp_from_email || settings.smtp_user}>`,
        to: email.contact_email,
        subject: email.subject,
        text: email.body,
        html: this.textToHtml(email.body),
        headers: {
          'X-Campaign-Id': email.campaign_id ? String(email.campaign_id) : 'manual',
          'X-Lead-Id': String(email.lead_id)
        }
      };

      const info = await transporter.sendMail(mailOptions);

      // Update email status
      db.prepare('UPDATE emails SET status = ?, sent_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('sent', emailId);

      // Update lead status
      db.prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('contacted', email.lead_id);

      // Update counters
      this.sentThisHour++;
      this.sentToday++;

      // Log activity
      db.prepare('INSERT INTO activity_log (type, message, details) VALUES (?, ?, ?)')
        .run('email_sent', `Email sent to ${email.contact_email}`, JSON.stringify({
          email_id: emailId,
          lead: email.company_name,
          subject: email.subject,
          messageId: info.messageId
        }));

      logger.info(`Email sent to ${email.contact_email} (${email.company_name})`);
      return { success: true, messageId: info.messageId };

    } catch (err) {
      logger.error(`Email send error to ${email.contact_email}:`, err.message);

      db.prepare('UPDATE emails SET status = ?, error_message = ? WHERE id = ?')
        .run('failed', err.message, emailId);

      return { success: false, error: err.message };
    }
  }

  /**
   * Send batch of emails with rate limiting
   */
  async sendBatch(emailIds, delayBetween = 30000) {
    const results = [];

    for (const emailId of emailIds) {
      const rateCheck = this.checkRateLimit();
      if (!rateCheck.allowed) {
        logger.warn(`Batch sending paused: ${rateCheck.reason}`);
        break;
      }

      const result = await this.sendEmail(emailId);
      results.push({ emailId, ...result });

      // Delay between emails (default 30 seconds)
      if (emailIds.indexOf(emailId) < emailIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetween));
      }
    }

    return results;
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection() {
    try {
      const transporter = this.getTransporter();
      await transporter.verify();
      return { success: true, message: 'SMTP connection verified' };
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  /**
   * Convert plain text to simple HTML
   */
  textToHtml(text) {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const html = escaped
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');

    return `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #333;">
      <p>${html}</p>
    </div>`;
  }

  getSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  }
}

module.exports = new EmailSendingService();
