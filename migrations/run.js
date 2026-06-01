const db = require('../src/config/database');

function runMigrations() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      contact_name TEXT,
      contact_email TEXT,
      phone TEXT,
      website TEXT,
      industry TEXT,
      location TEXT,
      website_status TEXT DEFAULT 'unknown',
      website_score INTEGER DEFAULT 0,
      qualification_score INTEGER DEFAULT 0,
      qualification_reason TEXT,
      status TEXT DEFAULT 'new',
      source TEXT,
      campaign_id INTEGER,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      target_industry TEXT,
      target_region TEXT,
      target_volume INTEGER DEFAULT 100,
      status TEXT DEFAULT 'draft',
      command TEXT,
      leads_found INTEGER DEFAULT 0,
      leads_qualified INTEGER DEFAULT 0,
      emails_sent INTEGER DEFAULT 0,
      emails_opened INTEGER DEFAULT 0,
      responses INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL,
      campaign_id INTEGER,
      type TEXT DEFAULT 'initial',
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      sent_at DATETIME,
      opened_at DATETIME,
      replied_at DATETIME,
      followup_number INTEGER DEFAULT 0,
      scheduled_at DATETIME,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (lead_id) REFERENCES leads(id),
      FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'initial',
      subject_template TEXT NOT NULL,
      body_template TEXT NOT NULL,
      variables TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
    CREATE INDEX IF NOT EXISTS idx_leads_campaign ON leads(campaign_id);
    CREATE INDEX IF NOT EXISTS idx_emails_lead ON emails(lead_id);
    CREATE INDEX IF NOT EXISTS idx_emails_status ON emails(status);
    CREATE INDEX IF NOT EXISTS idx_emails_scheduled ON emails(scheduled_at);
  `);

  // Insert default settings if not exist
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );

  const defaults = {
    smtp_host: 'smtp.titan.email',
    smtp_port: '465',
    smtp_secure: 'true',
    smtp_user: 'sales@jhitzone.com',
    smtp_pass: 'Sales@123',
    smtp_from_name: 'JH IT Zone',
    smtp_from_email: 'sales@jhitzone.com',
    followup_days: '3',
    max_followups: '3',
    email_rate_per_hour: '50',
    email_rate_per_day: '500',
    company_name: 'JH IT Zone',
    company_website: 'www.jhitzone.com',
    company_services: 'website development, chatbot and AI agents development, software development, cyber security, digital marketing, cloud computing'
  };

  const insertMany = db.transaction(() => {
    for (const [key, value] of Object.entries(defaults)) {
      insertSetting.run(key, value);
    }
  });
  insertMany();
}

module.exports = { runMigrations };

// Run if called directly
if (require.main === module) {
  runMigrations();
  console.log('Migrations completed successfully');
}
