const express = require('express');
const router = express.Router();
const db = require('../config/database');
const EmailSendingService = require('../services/emailSendingService');

// GET /api/settings - Get all settings
router.get('/', (req, res) => {
  try {
    const rows = db.prepare('SELECT * FROM settings').all();
    const settings = {};
    for (const row of rows) {
      // Mask password
      if (row.key === 'smtp_pass') {
        settings[row.key] = '********';
      } else {
        settings[row.key] = row.value;
      }
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/settings - Update settings
router.put('/', (req, res) => {
  try {
    const updates = req.body;
    const upsert = db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    );

    const updateMany = db.transaction((entries) => {
      for (const [key, value] of Object.entries(entries)) {
        if (value !== '********') { // Don't update masked passwords
          upsert.run(key, value);
        }
      }
    });

    updateMany(updates);
    res.json({ success: true, message: 'Settings updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/test-smtp - Test SMTP connection
router.post('/test-smtp', async (req, res) => {
  try {
    const result = await EmailSendingService.verifyConnection();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
