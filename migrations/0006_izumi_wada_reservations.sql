-- Izumi Wada: managed reservation campaign; no payment URL is public.
INSERT INTO artists (slug, name) VALUES ('izumi-wada','和田いづみ') ON CONFLICT(slug) DO NOTHING;
INSERT INTO projects (id,artist_slug,slug,title,story,pickup,price,deadline,image,music,contact,visibility,reservation_open,shipping_note,shipping_fee)
VALUES ('izumi-wada-jazz-date','izumi-wada','a-jazz-date-with-izumi','A Jazz Date with Izumi','赤と黒のアートワークを収めたミニCD型キーホルダー。好きな歌声をいつもそばに。','ライブ会場で受取。日時・会場は後日案内。',3000,'','https://touchcd-crowdfunding.cdman1106.workers.dev/touchcd-jazz-both.webp','','mailto:cdman1106@gmail.com','listed',1,'製造成立後に発送時期をご案内します。配送先はStripe決済時に入力してください。',500)
ON CONFLICT(artist_slug,slug) DO NOTHING;
INSERT INTO campaign_settings (campaign_id,reservation_goal,paid_goal,capacity,offline_reserved,offline_paid)
VALUES ('izumi-wada-jazz-date',35,25,10000,0,0) ON CONFLICT(campaign_id) DO NOTHING;
