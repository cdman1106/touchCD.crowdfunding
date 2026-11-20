CREATE TABLE campaign_settings (
  campaign_id TEXT PRIMARY KEY,
  reservation_goal INTEGER NOT NULL CHECK (reservation_goal BETWEEN 1 AND 10000),
  paid_goal INTEGER NOT NULL CHECK (paid_goal BETWEEN 1 AND reservation_goal),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN reservation_goal AND 10000),
  offline_reserved INTEGER NOT NULL DEFAULT 0 CHECK (offline_reserved BETWEEN 0 AND capacity),
  offline_paid INTEGER NOT NULL DEFAULT 0 CHECK (offline_paid BETWEEN 0 AND offline_reserved)
);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 5),
  paid INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
  created_at TEXT NOT NULL,
  UNIQUE (campaign_id, email)
);
