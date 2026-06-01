const OpenAI = require('openai');
const logger = require('../utils/logger');
const db = require('../config/database');
const CampaignService = require('./campaignService');

const openai = new OpenAI();

class CommandService {
  /**
   * Process a natural language command from the user
   */
  async processCommand(command) {
    logger.info(`Processing command: ${command}`);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [
          {
            role: 'system',
            content: `You are a command parser for a lead generation system. Parse the user's natural language command into a structured action.

Available actions:
1. "create_campaign" - Find/extract leads (params: industry, region, volume, name)
2. "start_campaign" - Start processing a campaign (params: campaign_id)
3. "launch_campaign" - Start sending emails for a campaign (params: campaign_id)
4. "pause_campaign" - Pause a campaign (params: campaign_id)
5. "get_stats" - Get statistics (params: campaign_id or "all")
6. "list_leads" - List leads (params: status, campaign_id, limit)
7. "update_settings" - Update settings (params: key, value)

Respond in JSON:
{
  "action": "<action_name>",
  "params": { ... },
  "confirmation_message": "<human-readable description of what will be done>"
}`
          },
          { role: 'user', content: command }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2
      });

      const parsed = JSON.parse(response.choices[0].message.content);
      return await this.executeAction(parsed);

    } catch (err) {
      logger.error('Command processing error:', err.message);
      return {
        success: false,
        message: `I couldn't understand that command. Try something like:\n- "Find 100 leads in healthcare industry in Dubai"\n- "Start campaign #1"\n- "Show me stats"\n- "Pause all campaigns"`,
        error: err.message
      };
    }
  }

  /**
   * Execute a parsed action
   */
  async executeAction(parsed) {
    const { action, params, confirmation_message } = parsed;

    switch (action) {
      case 'create_campaign': {
        const campaign = CampaignService.createCampaign({
          name: params.name || `${params.industry} - ${params.region}`,
          target_industry: params.industry,
          target_region: params.region,
          target_volume: params.volume || 100,
          command: confirmation_message
        });

        // Auto-start the campaign
        const result = await CampaignService.startCampaign(campaign.id);

        return {
          success: true,
          message: `Campaign created and processing: "${campaign.name}"\n\nResults:\n- Leads found: ${result.leads_found}\n- Leads qualified: ${result.leads_qualified}\n- Emails generated: ${result.emails_generated}\n\nCampaign is ready. Use "Launch campaign #${campaign.id}" to start sending emails.`,
          data: result
        };
      }

      case 'start_campaign': {
        const result = await CampaignService.startCampaign(params.campaign_id);
        return {
          success: true,
          message: `Campaign #${params.campaign_id} processing started.\n${confirmation_message}`,
          data: result
        };
      }

      case 'launch_campaign': {
        const result = await CampaignService.launchCampaign(params.campaign_id);
        return {
          success: true,
          message: `Campaign #${params.campaign_id} launched! ${result.sent}/${result.total} emails sent.`,
          data: result
        };
      }

      case 'pause_campaign': {
        CampaignService.pauseCampaign(params.campaign_id);
        return {
          success: true,
          message: `Campaign #${params.campaign_id} paused.`
        };
      }

      case 'get_stats': {
        if (params.campaign_id && params.campaign_id !== 'all') {
          const stats = CampaignService.getCampaignStats(params.campaign_id);
          return { success: true, message: confirmation_message, data: stats };
        } else {
          const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
          const totalLeads = db.prepare('SELECT COUNT(*) as count FROM leads').get();
          const totalEmails = db.prepare('SELECT COUNT(*) as count FROM emails WHERE status = ?').get('sent');
          return {
            success: true,
            message: `Overall Stats:\n- Total campaigns: ${campaigns.length}\n- Total leads: ${totalLeads.count}\n- Emails sent: ${totalEmails.count}`,
            data: { campaigns, totalLeads: totalLeads.count, totalEmails: totalEmails.count }
          };
        }
      }

      case 'list_leads': {
        let query = 'SELECT * FROM leads';
        const conditions = [];
        const queryParams = [];

        if (params.status) {
          conditions.push('status = ?');
          queryParams.push(params.status);
        }
        if (params.campaign_id) {
          conditions.push('campaign_id = ?');
          queryParams.push(params.campaign_id);
        }
        if (conditions.length) {
          query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY qualification_score DESC LIMIT ?';
        queryParams.push(params.limit || 20);

        const leads = db.prepare(query).all(...queryParams);
        return {
          success: true,
          message: `Found ${leads.length} leads.`,
          data: leads
        };
      }

      case 'update_settings': {
        db.prepare('INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
          .run(params.key, params.value);
        return {
          success: true,
          message: `Setting "${params.key}" updated to "${params.value}".`
        };
      }

      default:
        return {
          success: false,
          message: `Unknown action: ${action}. Please try a different command.`
        };
    }
  }
}

module.exports = new CommandService();
