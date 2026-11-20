CREATE TABLE project_payment_settings (
  campaign_id TEXT PRIMARY KEY,
  checkout_url TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT ''
);

ALTER TABLE reservations ADD COLUMN payment_url TEXT NOT NULL DEFAULT '';
