-- Confirm the Izumi Wada live pickup and the pre-Lunar-New-Year order schedule.
UPDATE projects SET deadline = '2027-01-03T23:59:00+09:00', pickup = '2027年2月24日（水）Music Bar Bridge（福岡市中央区浄水通5-10 ケインズ浄水B1F）。19:30開演。商品の受取時間・場所の詳細は予約者へご案内します。', event_info = 'Premium Live / Jazz Live｜和田いづみ（Vo.）・石川雄一（Gt.）｜2027年2月24日（水）19:30開演｜Music Bar Bridge｜Music Charge 3,000円＋2オーダー（商品代金とは別）'
WHERE id = 'izumi-wada-jazz-date';
INSERT INTO project_payment_settings (campaign_id, checkout_url, deadline)
SELECT id, '', '2027-01-06T23:59:00+09:00' FROM projects WHERE id = 'izumi-wada-jazz-date'
ON CONFLICT(campaign_id) DO UPDATE SET deadline = excluded.deadline;
