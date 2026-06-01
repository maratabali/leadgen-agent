const express = require('express');
const router = express.Router();
const db = require('../config/database');
const CommandService = require('../services/commandService');

// POST /api/commands - Process a natural language command
router.post('/', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: 'Command is required' });

    const result = await CommandService.processCommand(command);

    // Log the command
    db.prepare('INSERT INTO activity_log (type, message, details) VALUES (?, ?, ?)')
      .run('command', command, JSON.stringify(result));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/commands/history - Get command history
router.get('/history', (req, res) => {
  const history = db.prepare(
    "SELECT * FROM activity_log WHERE type = 'command' ORDER BY created_at DESC LIMIT 50"
  ).all();
  res.json(history);
});

module.exports = router;
