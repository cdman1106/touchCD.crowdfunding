ALTER TABLE projects ADD COLUMN event_info TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN audio_at TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN release_update TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN shipping_note TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN shipping_fee INTEGER CHECK (shipping_fee BETWEEN 0 AND 100000);
ALTER TABLE reservations ADD COLUMN fulfillment TEXT NOT NULL DEFAULT 'pickup' CHECK (fulfillment IN ('pickup', 'shipping'));
ALTER TABLE reservations ADD COLUMN shipping_fee INTEGER NOT NULL DEFAULT 0 CHECK (shipping_fee BETWEEN 0 AND 100000);
ALTER TABLE reservations ADD COLUMN postal_code TEXT NOT NULL DEFAULT '';
ALTER TABLE reservations ADD COLUMN shipping_address TEXT NOT NULL DEFAULT '';
