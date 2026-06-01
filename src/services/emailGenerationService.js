const OpenAI = require('openai');
const logger = require('../utils/logger');
const db = require('../config/database');

const openai = new OpenAI();

class EmailGenerationService {
  /**
   * Generate a personalized cold email for a lead
   */
  async generateEmail(lead, type = 'initial') {
    const settings = this.getSettings();
    const leadNotes = lead.notes ? JSON.parse(lead.notes) : {};

    let prompt;
    if (type === 'initial') {
      prompt = this.getInitialEmailPrompt(lead, leadNotes, settings);
    } else {
      prompt = this.getFollowUpPrompt(lead, leadNotes, settings, type);
    }

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.7
      });

      const result = JSON.parse(response.choices[0].message.content);
      return {
        subject: result.subject,
        body: result.body
      };
    } catch (err) {
      logger.error(`Email generation error for ${lead.company_name}:`, err.message);
      return this.getFallbackEmail(lead, type);
    }
  }

  getInitialEmailPrompt(lead, notes, settings) {
    return `You are a professional business development email writer for "${settings.company_name}" (${settings.company_website}).

Services offered: ${settings.company_services}

Write a personalized cold outreach email to this lead:
- Company: ${lead.company_name}
- Contact: ${lead.contact_name || 'Business Owner'}
- Their Website: ${lead.website || 'None'}
- Website Status: ${lead.website_status}
- Website Score: ${lead.website_score}/100
- Industry: ${lead.industry || 'Unknown'}
- Qualification Reason: ${lead.qualification_reason}
- Recommended Services: ${notes.recommended_services ? notes.recommended_services.join(', ') : 'General IT services'}
- Email Angle: ${notes.email_angle || 'General outreach'}

Guidelines:
1. Keep it SHORT (under 150 words body)
2. Personalize based on their specific situation
3. Mention a specific problem you noticed (e.g., no website, slow website, no chatbot)
4. Offer a specific solution from our services
5. Include a clear CTA (call, meeting, reply)
6. Professional but friendly tone
7. Do NOT use generic templates - make it feel personal
8. Do NOT be pushy or salesy
9. Sign off as "JH IT Zone Team"

Respond in JSON:
{
  "subject": "<email subject line>",
  "body": "<full email body in plain text with line breaks>"
}`;
  }

  getFollowUpPrompt(lead, notes, settings, followupNum) {
    return `You are writing a follow-up email (#${followupNum}) for "${settings.company_name}".

Previous context:
- Company: ${lead.company_name}
- Contact: ${lead.contact_name || 'Business Owner'}
- Their situation: ${lead.qualification_reason}
- Services we recommended: ${notes.recommended_services ? notes.recommended_services.join(', ') : 'IT services'}

Guidelines for follow-up #${followupNum}:
1. Keep it VERY SHORT (under 100 words)
2. Reference the previous email casually
3. Add new value (a quick tip, stat, or insight relevant to their industry)
4. Different angle from the first email
5. Gentle CTA
6. If this is follow-up #3, make it a "break-up" email (last chance, no hard feelings)

Respond in JSON:
{
  "subject": "<email subject line - can be Re: previous or new>",
  "body": "<full email body>"
}`;
  }

  getFallbackEmail(lead, type) {
    if (type === 'initial') {
      return {
        subject: `Quick question about ${lead.company_name}'s online presence`,
        body: `Hi ${lead.contact_name || 'there'},

I came across ${lead.company_name} and noticed ${lead.website ? 'some opportunities to improve your online presence' : "you don't seem to have a website yet"}.

At JH IT Zone, we help businesses like yours with website development, AI chatbots, and digital marketing solutions that drive real results.

Would you be open to a quick 10-minute chat this week to explore how we could help?

Best regards,
JH IT Zone Team
www.jhitzone.com`
      };
    } else {
      return {
        subject: `Following up - ${lead.company_name}`,
        body: `Hi ${lead.contact_name || 'there'},

Just wanted to follow up on my previous email. I understand you're busy, but I genuinely believe we could help ${lead.company_name} grow with the right digital strategy.

Would a quick call work for you this week?

Best,
JH IT Zone Team`
      };
    }
  }

  /**
   * Generate emails for multiple leads
   */
  async generateBatch(leads, campaignId) {
    const emails = [];

    for (const lead of leads) {
      if (!lead.contact_email) continue;

      const email = await this.generateEmail(lead, 'initial');

      const insertStmt = db.prepare(`
        INSERT INTO emails (lead_id, campaign_id, type, subject, body, status)
        VALUES (?, ?, 'initial', ?, ?, 'draft')
      `);

      const result = insertStmt.run(lead.id, campaignId, email.subject, email.body);

      emails.push({
        id: result.lastInsertRowid,
        lead_id: lead.id,
        ...email
      });

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return emails;
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

module.exports = new EmailGenerationService();
