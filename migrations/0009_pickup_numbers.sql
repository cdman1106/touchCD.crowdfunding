-- Preserve assigned numbers even after a reservation is cancelled or removed.
CREATE TABLE IF NOT EXISTS pickup_numbers (
  reservation_id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  number INTEGER NOT NULL CHECK (number > 0),
  UNIQUE (campaign_id, number)
);
