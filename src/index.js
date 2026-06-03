require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');
const cron = require('node-cron');

const logger = require('./utils/logger');
const db = require('./config/database');
const { runMigrations } = require('../migrations/run');

// Import routes
const leadsRouter = require('./routes/leads');
const campaignsRouter = require('./routes/campaigns');
const emailsRouter = require('./routes/emails');
const commandsRouter = require('./routes/commands');
const analyticsRouter = require('./routes/analytics');
const settingsRouter = require('./routes/settings');

// Import services
const FollowUpService = require('./services/followUpService');
const CampaignService = require('./services/campaignService');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use('/api/', limiter);

// Health check (before other routes)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/leads', leadsRouter);
app.use('/api/campaigns', campaignsRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/commands', commandsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/settings', settingsRouter);

// Serve frontend in production
const frontendPath = path.join(__dirname, '../public');
app.use(express.static(frontendPath));

// Catch-all: serve frontend for non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(`Error: ${err.message}`, { stack: err.stack });
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error'
  });
});

// Initialize database and start server
async function start() {
  try {
    // Run migrations
    runMigrations();
    logger.info('Database migrations completed');

    // Schedule follow-up emails (every hour)
    cron.schedule('0 * * * *', async () => {
      logger.info('Running follow-up email check...');
      try {
        await FollowUpService.processFollowUps();
      } catch (err) {
        logger.error('Follow-up processing error:', err);
      }
    });

    // Schedule active campaigns processing (every 30 minutes)
    cron.schedule('*/30 * * * *', async () => {
      logger.info('Processing active campaigns...');
      try {
        await CampaignService.processActiveCampaigns();
      } catch (err) {
        logger.error('Campaign processing error:', err);
      }
    });

    app.listen(PORT, () => {
      logger.info(`LeadGen Agent server running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

module.exports = app;
