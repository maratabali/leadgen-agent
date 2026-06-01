const logger = require('../utils/logger');
const db = require('../config/database');
const EmailGenerationService = require('./emailGenerationService');
const EmailSendingService = require('./emailSendingService');

class FollowUpService {
  /**
   * Process all pending follow-ups
   */
  async processFollowUps() {
    const settings = this.getSettings();
    const followupDays = parseInt(settings.followup_days || '3');
    const maxFollowups = parseInt(settings.max_followups || '3');

    // Find leads that need follow-up:
    // - Status is 'contacted' (initial email sent)
    // - Last email was sent more than X days ago
    // - Haven't reached max follow-ups
    // - Haven't received a reply
    const leadsNeedingFollowup = db.prepare(`
      SELECT l.*, 
        (SELECT MAX(e.sent_at) FROM emails e WHERE e.lead_id = l.id AND e.status = 'sent') as last_email_date,
        (SELECT MAX(e.followup_number) FROM emails e WHERE e.lead_id = l.id) as last_followup_num,
        (SELECT COUNT(*) FROM emails e WHERE e.lead_id = l.id AND e.status = 'sent') as total_sent
      FROM leads l
      WHERE l.status IN ('contacted', 'followed_up')
        AND l.contact_email IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM emails e WHERE e.lead_id = l.id AND e.replied_at IS NOT NULL
        )
      HAVING last_email_date IS NOT NULL
        AND datetime(last_email_date, '+${followupDays} days') <= datetime('now')
        AND (last_followup_num IS NULL OR last_followup_num < ?)
    `).all(maxFollowups);

    logger.info(`Found ${leadsNeedingFollowup.length} leads needing follow-up`);

    let sent = 0;
    for (const lead of leadsNeedingFollowup) {
      try {
        const followupNum = (lead.last_followup_num || 0) + 1;

        // Generate follow-up email
        const email = await EmailGenerationService.generateEmail(lead, followupNum);

        // Save to database
        const result = db.prepare(`
          INSERT INTO emails (lead_id, campaign_id, type, subject, body, status, followup_number)
          VALUES (?, ?, 'followup', ?, ?, 'pending', ?)
        `).run(lead.id, lead.campaign_id, email.subject, email.body, followupNum);

        // Send the email
        const sendResult = await EmailSendingService.sendEmail(result.lastInsertRowid);

        if (sendResult.success) {
          // Update lead status
          db.prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
            .run('followed_up', lead.id);
          sent++;
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 30000));
      } catch (err) {
        logger.error(`Follow-up error for lead ${lead.id}:`, err.message);
      }
    }

    logger.info(`Follow-up processing complete: ${sent} emails sent`);

    // Log activity
    if (sent > 0) {
      db.prepare('INSERT INTO activity_log (type, message) VALUES (?, ?)')
        .run('followup_batch', `Sent ${sent} follow-up emails`);
    }

    return { processed: leadsNeedingFollowup.length, sent };
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

module.exports = new FollowUpService();
