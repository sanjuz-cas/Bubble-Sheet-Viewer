const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/bubblesheet',
});

async function main() {
  await client.connect();
  console.log('Connected to PostgreSQL');

  await client.query(`
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answer_keys (
      id VARCHAR PRIMARY KEY,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      subject TEXT NOT NULL,
      total_questions INTEGER NOT NULL,
      options_per_question INTEGER NOT NULL,
      answers_encrypted TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scan_results (
      id VARCHAR PRIMARY KEY,
      user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      answer_key_id VARCHAR NOT NULL,
      answer_key_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      data_encrypted TEXT NOT NULL,
      score REAL NOT NULL,
      total_questions INTEGER NOT NULL,
      percentage REAL NOT NULL,
      scanned_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  console.log('Database tables verified/created successfully.');
  const res = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public'");
  console.log('Current Tables:', res.rows.map(r => r.table_name));
  await client.end();
}

main().catch((err) => {
  console.error('Setup DB Error:', err);
  process.exit(1);
});
