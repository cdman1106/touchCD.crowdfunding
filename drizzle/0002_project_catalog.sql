CREATE TABLE artists (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

--> statement-breakpoint
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  artist_slug TEXT NOT NULL REFERENCES artists(slug),
  slug TEXT NOT NULL,
  title TEXT NOT NULL,
  story TEXT NOT NULL DEFAULT '',
  pickup TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price BETWEEN 1 AND 1000000),
  deadline TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL DEFAULT '',
  music TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'draft' CHECK (visibility IN ('draft', 'unlisted', 'listed')),
  reservation_open INTEGER NOT NULL DEFAULT 0 CHECK (reservation_open IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (artist_slug, slug)
);
