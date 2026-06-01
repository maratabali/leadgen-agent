const express = require('express');
const router = express.Router();
const db = require('../config/database');
const logger = require('../utils/logger');
const CampaignService = require('../services/campaignService');

// GET /api/campaigns - List all campaigns
router.get('/', (req, res) => {
  try {
    const campaigns = db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/:id - Get campaign details
router.get('/:id', (req, res) => {
  const stats = CampaignService.getCampaignStats(parseInt(req.params.id));
  if (!stats) return res.status(404).json({ error: 'Campaign not found' });
  res.json(stats);
});

// POST /api/campaigns - Create campaign
router.post('/', (req, res) => {
  try {
    const campaign = CampaignService.createCampaign(req.body);
    res.status(201).json(campaign);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/start - Start campaign processing
router.post('/:id/start', async (req, res) => {
  try {
    const result = await CampaignService.startCampaign(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    logger.error('Campaign start error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/launch - Launch email sending
router.post('/:id/launch', async (req, res) => {
  try {
    const result = await CampaignService.launchCampaign(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    logger.error('Campaign launch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/campaigns/:id/pause - Pause campaign
router.post('/:id/pause', (req, res) => {
  try {
    const result = CampaignService.pauseCampaign(parseInt(req.params.id));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/campaigns/:id - Delete campaign
router.delete('/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM emails WHERE campaign_id = ?').run(req.params.id);
    db.prepare('DELETE FROM leads WHERE campaign_id = ?').run(req.params.id);
    db.prepare('DELETE FROM campaigns WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
