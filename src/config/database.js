const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.dirname(process.env.DB_PATH || './data/leadgen.db');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/leadgen.db');
const db = new Database(dbPath);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

module.exports = db;
