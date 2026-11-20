ALTER TABLE reservations ADD COLUMN email_verified_at TEXT;
ALTER TABLE reservations ADD COLUMN pickup_at TEXT;
ALTER TABLE reservations ADD COLUMN paid_receipt_id TEXT;

CREATE TABLE email_verifications (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  digest TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  UNIQUE (campaign_id, email)
);

CREATE INDEX email_verifications_expiry ON email_verifications(expires_at);

CREATE TABLE email_rate_limits (
  scope_key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL,
  count INTEGER NOT NULL
);

CREATE INDEX email_rate_limits_expiry ON email_rate_limits(expires_at);

CREATE TABLE payment_receipts (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations(id),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at TEXT
);
