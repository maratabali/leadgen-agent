const express = require('express');
const router = express.Router();
const db = require('../config/database');

// GET /api/analytics/overview - Dashboard overview stats
router.get('/overview', (req, res) => {
  try {
    const leads = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_count,
        SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) as qualified,
        SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
        SUM(CASE WHEN status = 'followed_up' THEN 1 ELSE 0 END) as followed_up,
        SUM(CASE WHEN status = 'responded' THEN 1 ELSE 0 END) as responded
      FROM leads
    `).get();

    const emails = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN opened_at IS NOT NULL THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN replied_at IS NOT NULL THEN 1 ELSE 0 END) as replied
      FROM emails
    `).get();

    const campaigns = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM campaigns
    `).get();

    const recentActivity = db.prepare(
      'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 10'
    ).all();

    res.json({ leads, emails, campaigns, recentActivity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/daily - Daily stats for charts
router.get('/daily', (req, res) => {
  try {
    const days = parseInt(req.query.days || '30');
    
    const emailsByDay = db.prepare(`
      SELECT DATE(sent_at) as date, COUNT(*) as count
      FROM emails
      WHERE sent_at IS NOT NULL AND sent_at >= datetime('now', '-${days} days')
      GROUP BY DATE(sent_at)
      ORDER BY date
    `).all();

    const leadsByDay = db.prepare(`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM leads
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY DATE(created_at)
      ORDER BY date
    `).all();

    res.json({ emailsByDay, leadsByDay });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
