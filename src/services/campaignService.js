const logger = require('../utils/logger');
const db = require('../config/database');
const LeadExtractionService = require('./leadExtractionService');
const QualificationService = require('./qualificationService');
const EmailGenerationService = require('./emailGenerationService');
const EmailSendingService = require('./emailSendingService');

class CampaignService {
  /**
   * Create a new campaign
   */
  createCampaign(data) {
    const result = db.prepare(`
      INSERT INTO campaigns (name, description, target_industry, target_region, target_volume, status, command)
      VALUES (?, ?, ?, ?, ?, 'draft', ?)
    `).run(
      data.name,
      data.description || '',
      data.target_industry,
      data.target_region,
      data.target_volume || 100,
      data.command || ''
    );

    return { id: result.lastInsertRowid, ...data };
  }

  /**
   * Start a campaign - runs the full pipeline
   */
  async startCampaign(campaignId) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    // Update status
    db.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('extracting', campaignId);

    logger.info(`Starting campaign ${campaignId}: ${campaign.name}`);

    try {
      // Step 1: Extract leads
      logger.info('Step 1: Extracting leads...');
      const rawLeads = await LeadExtractionService.extractLeads(campaign);

      db.prepare('UPDATE campaigns SET leads_found = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(rawLeads.length, 'qualifying', campaignId);

      // Step 2: Qualify leads
      logger.info('Step 2: Qualifying leads...');
      const qualifiedLeads = await QualificationService.qualifyBatch(rawLeads, 40);

      // Step 3: Save qualified leads
      const savedCount = QualificationService.saveLeads(qualifiedLeads, campaignId);

      db.prepare('UPDATE campaigns SET leads_qualified = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(savedCount, 'generating_emails', campaignId);

      // Step 4: Generate emails for qualified leads with emails
      logger.info('Step 3: Generating emails...');
      const leadsWithEmails = db.prepare(
        'SELECT * FROM leads WHERE campaign_id = ? AND contact_email IS NOT NULL AND status = ?'
      ).all(campaignId, 'qualified');

      const emails = await EmailGenerationService.generateBatch(leadsWithEmails, campaignId);

      // Update campaign status to ready
      db.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('ready', campaignId);

      // Log activity
      db.prepare('INSERT INTO activity_log (type, message, details) VALUES (?, ?, ?)')
        .run('campaign_ready', `Campaign "${campaign.name}" is ready`, JSON.stringify({
          campaign_id: campaignId,
          leads_found: rawLeads.length,
          leads_qualified: savedCount,
          emails_generated: emails.length
        }));

      return {
        campaign_id: campaignId,
        leads_found: rawLeads.length,
        leads_qualified: savedCount,
        emails_generated: emails.length,
        status: 'ready'
      };

    } catch (err) {
      logger.error(`Campaign ${campaignId} error:`, err);
      db.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run('error', campaignId);
      throw err;
    }
  }

  /**
   * Launch a campaign (start sending emails)
   */
  async launchCampaign(campaignId) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) throw new Error('Campaign not found');

    db.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('sending', campaignId);

    // Get all draft emails for this campaign
    const emails = db.prepare(
      'SELECT id FROM emails WHERE campaign_id = ? AND status = ?'
    ).all(campaignId, 'draft');

    const emailIds = emails.map(e => e.id);
    const results = await EmailSendingService.sendBatch(emailIds);

    const sentCount = results.filter(r => r.success).length;

    db.prepare('UPDATE campaigns SET emails_sent = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(sentCount, 'active', campaignId);

    return { sent: sentCount, total: emailIds.length, results };
  }

  /**
   * Pause a campaign
   */
  pauseCampaign(campaignId) {
    db.prepare('UPDATE campaigns SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run('paused', campaignId);
    return { status: 'paused' };
  }

  /**
   * Process all active campaigns (called by cron)
   */
  async processActiveCampaigns() {
    const activeCampaigns = db.prepare(
      "SELECT * FROM campaigns WHERE status = 'active'"
    ).all();

    for (const campaign of activeCampaigns) {
      // Check for unsent emails
      const unsent = db.prepare(
        "SELECT id FROM emails WHERE campaign_id = ? AND status = 'draft'"
      ).all(campaign.id);

      if (unsent.length > 0) {
        const batch = unsent.slice(0, 10); // Send max 10 at a time
        await EmailSendingService.sendBatch(batch.map(e => e.id));
      }
    }
  }

  /**
   * Get campaign stats
   */
  getCampaignStats(campaignId) {
    const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId);
    if (!campaign) return null;

    const stats = db.prepare(`
      SELECT 
        COUNT(*) as total_emails,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
      FROM emails WHERE campaign_id = ?
    `).get(campaignId);

    return { ...campaign, email_stats: stats };
  }
}

module.exports = new CampaignService();
