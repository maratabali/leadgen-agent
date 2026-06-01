const OpenAI = require('openai');
const logger = require('../utils/logger');
const db = require('../config/database');

const openai = new OpenAI();

class QualificationService {
  /**
   * Qualify a single lead using AI
   */
  async qualifyLead(lead) {
    const prompt = `You are a lead qualification AI for "JH IT Zone", an IT services company offering:
- Website development
- Chatbot and AI agents development
- Software development
- Cyber security
- Digital marketing
- Cloud computing

Analyze this potential lead and provide a qualification score (0-100) and reasoning:

Company: ${lead.company_name}
Website: ${lead.website || 'None'}
Website Status: ${lead.website_status || 'unknown'}
Website Score: ${lead.website_score || 'N/A'}/100
Website Issues: ${lead.website_issues ? lead.website_issues.join(', ') : 'None identified'}
Industry: ${lead.industry || 'Unknown'}
Location: ${lead.location || 'Unknown'}
Description: ${lead.description || 'N/A'}

Qualification criteria:
1. Companies with NO website = HIGH priority (score 80-100)
2. Companies with POOR website (score < 50) = HIGH priority (score 70-90)
3. Companies that could benefit from AI/chatbot solutions = MEDIUM-HIGH (score 60-80)
4. Companies that might need digital marketing = MEDIUM (score 50-70)
5. Companies with good websites and likely have IT teams = LOW priority (score 0-30)

Respond in JSON format:
{
  "score": <number 0-100>,
  "reason": "<brief explanation of why this lead is qualified or not>",
  "recommended_services": ["<service1>", "<service2>"],
  "priority": "<high|medium|low>",
  "email_angle": "<suggested approach for cold email>"
}`;

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3
      });

      const result = JSON.parse(response.choices[0].message.content);
      return {
        qualification_score: result.score,
        qualification_reason: result.reason,
        recommended_services: result.recommended_services,
        priority: result.priority,
        email_angle: result.email_angle
      };
    } catch (err) {
      logger.error(`AI qualification error for ${lead.company_name}:`, err.message);
      // Fallback scoring based on website status
      return this.fallbackQualification(lead);
    }
  }

  /**
   * Fallback qualification without AI
   */
  fallbackQualification(lead) {
    let score = 50;
    let reason = '';
    const services = [];

    if (!lead.website || lead.website_status === 'no_website') {
      score = 90;
      reason = 'No website found - strong candidate for website development';
      services.push('website development');
    } else if (lead.website_score < 30) {
      score = 80;
      reason = 'Very poor website quality - needs complete redesign';
      services.push('website development', 'digital marketing');
    } else if (lead.website_score < 50) {
      score = 70;
      reason = 'Poor website - could benefit from improvements and AI integration';
      services.push('website development', 'chatbot development');
    } else if (lead.website_score < 70) {
      score = 55;
      reason = 'Average website - could benefit from AI chatbot and digital marketing';
      services.push('chatbot development', 'digital marketing');
    } else {
      score = 30;
      reason = 'Good website - lower priority but may need AI/cloud services';
      services.push('AI agents', 'cloud computing');
    }

    return {
      qualification_score: score,
      qualification_reason: reason,
      recommended_services: services,
      priority: score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low',
      email_angle: reason
    };
  }

  /**
   * Qualify multiple leads in batch
   */
  async qualifyBatch(leads, minScore = 40) {
    const qualified = [];

    for (const lead of leads) {
      const qualification = await this.qualifyLead(lead);

      const qualifiedLead = {
        ...lead,
        ...qualification
      };

      if (qualification.qualification_score >= minScore) {
        qualified.push(qualifiedLead);
      }

      // Rate limiting for API calls
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Sort by score descending
    qualified.sort((a, b) => b.qualification_score - a.qualification_score);

    return qualified;
  }

  /**
   * Save qualified leads to database
   */
  saveLeads(leads, campaignId) {
    const insert = db.prepare(`
      INSERT INTO leads (company_name, contact_name, contact_email, phone, website, 
        industry, location, website_status, website_score, qualification_score, 
        qualification_reason, status, source, campaign_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'qualified', ?, ?, ?)
    `);

    const insertMany = db.transaction((leads) => {
      for (const lead of leads) {
        insert.run(
          lead.company_name,
          lead.contact_name || null,
          lead.contact_email || null,
          lead.phone || null,
          lead.website || null,
          lead.industry || null,
          lead.location || null,
          lead.website_status || 'unknown',
          lead.website_score || 0,
          lead.qualification_score,
          lead.qualification_reason,
          lead.source || 'search',
          campaignId,
          JSON.stringify({
            recommended_services: lead.recommended_services,
            email_angle: lead.email_angle,
            priority: lead.priority
          })
        );
      }
    });

    insertMany(leads);
    return leads.length;
  }
}

module.exports = new QualificationService();
