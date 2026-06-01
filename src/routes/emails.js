const express = require('express');
const router = express.Router();
const db = require('../config/database');
const logger = require('../utils/logger');
const EmailSendingService = require('../services/emailSendingService');
const EmailGenerationService = require('../services/emailGenerationService');

// GET /api/emails - List emails
router.get('/', (req, res) => {
  try {
    const { status, campaign_id, lead_id, page = 1, limit = 50 } = req.query;
    let query = `
      SELECT e.*, l.company_name, l.contact_email, l.contact_name
      FROM emails e
      JOIN leads l ON e.lead_id = l.id
    `;
    const conditions = [];
    const params = [];

    if (status) { conditions.push('e.status = ?'); params.push(status); }
    if (campaign_id) { conditions.push('e.campaign_id = ?'); params.push(campaign_id); }
    if (lead_id) { conditions.push('e.lead_id = ?'); params.push(lead_id); }

    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY e.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const emails = db.prepare(query).all(...params);
    res.json(emails);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/emails/:id - Get single email
router.get('/:id', (req, res) => {
  const email = db.prepare(`
    SELECT e.*, l.company_name, l.contact_email, l.contact_name
    FROM emails e
    JOIN leads l ON e.lead_id = l.id
    WHERE e.id = ?
  `).get(req.params.id);
  if (!email) return res.status(404).json({ error: 'Email not found' });
  res.json(email);
});

// PUT /api/emails/:id - Update email (edit before sending)
router.put('/:id', (req, res) => {
  const { subject, body } = req.body;
  if (!subject && !body) return res.status(400).json({ error: 'Nothing to update' });

  const updates = [];
  const params = [];
  if (subject) { updates.push('subject = ?'); params.push(subject); }
  if (body) { updates.push('body = ?'); params.push(body); }
  params.push(req.params.id);

  db.prepare(`UPDATE emails SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const email = db.prepare('SELECT * FROM emails WHERE id = ?').get(req.params.id);
  res.json(email);
});

// POST /api/emails/:id/send - Send a specific email
router.post('/:id/send', async (req, res) => {
  try {
    const result = await EmailSendingService.sendEmail(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/emails/send-batch - Send multiple emails
router.post('/send-batch', async (req, res) => {
  try {
    const { email_ids } = req.body;
    if (!email_ids || !email_ids.length) {
      return res.status(400).json({ error: 'No email IDs provided' });
    }
    const results = await EmailSendingService.sendBatch(email_ids);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/emails/generate - Generate email for a lead
router.post('/generate', async (req, res) => {
  try {
    const { lead_id, type = 'initial' } = req.body;
    const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(lead_id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const email = await EmailGenerationService.generateEmail(lead, type);
    res.json(email);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/emails/verify-smtp - Verify SMTP connection
router.post('/verify-smtp', async (req, res) => {
  try {
    const result = await EmailSendingService.verifyConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
