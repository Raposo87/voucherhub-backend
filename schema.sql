-- Basic vouchers table
CREATE TABLE IF NOT EXISTS vouchers (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  partner_slug VARCHAR(100) NOT NULL,
  code VARCHAR(64) NOT NULL UNIQUE,
  amount_cents INTEGER,
  currency VARCHAR(10) DEFAULT 'eur',
  stripe_session_id VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT NOW()
);
