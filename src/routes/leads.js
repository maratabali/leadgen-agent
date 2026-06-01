const express = require('express');
const router = express.Router();
const db = require('../config/database');
const logger = require('../utils/logger');

// GET /api/leads - List all leads with filtering
router.get('/', (req, res) => {
  try {
    const { status, campaign_id, search, page = 1, limit = 50, sort = 'qualification_score', order = 'desc' } = req.query;

    let query = 'SELECT * FROM leads';
    const conditions = [];
    const params = [];

    if (status) { conditions.push('status = ?'); params.push(status); }
    if (campaign_id) { conditions.push('campaign_id = ?'); params.push(campaign_id); }
    if (search) {
      conditions.push('(company_name LIKE ? OR contact_email LIKE ? OR industry LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
    const total = db.prepare(countQuery).get(...params).total;

    // Add sorting and pagination
    const validSorts = ['qualification_score', 'created_at', 'company_name', 'status'];
    const sortCol = validSorts.includes(sort) ? sort : 'qualification_score';
    const sortOrder = order === 'asc' ? 'ASC' : 'DESC';
    query += ` ORDER BY ${sortCol} ${sortOrder} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const leads = db.prepare(query).all(...params);

    res.json({ leads, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    logger.error('Error fetching leads:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/leads/:id - Get single lead
router.get('/:id', (req, res) => {
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });

  // Get associated emails
  const emails = db.prepare('SELECT * FROM emails WHERE lead_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json({ ...lead, emails });
});

// PUT /api/leads/:id - Update lead
router.put('/:id', (req, res) => {
  const { status, notes, contact_email, contact_name } = req.body;
  const updates = [];
  const params = [];

  if (status) { updates.push('status = ?'); params.push(status); }
  if (notes) { updates.push('notes = ?'); params.push(notes); }
  if (contact_email) { updates.push('contact_email = ?'); params.push(contact_email); }
  if (contact_name) { updates.push('contact_name = ?'); params.push(contact_name); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);

  db.prepare(`UPDATE leads SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(req.params.id);
  res.json(lead);
});

// DELETE /api/leads/:id - Delete lead
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM emails WHERE lead_id = ?').run(req.params.id);
  db.prepare('DELETE FROM leads WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET /api/leads/stats/summary - Lead statistics
router.get('/stats/summary', (req, res) => {
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
      SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) as qualified,
      SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
      SUM(CASE WHEN status = 'followed_up' THEN 1 ELSE 0 END) as followed_up,
      SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) as responded,
      AVG(qualification_score) as avg_score
    FROM leads
  `).get();
  res.json(stats);
});

module.exports = router;
