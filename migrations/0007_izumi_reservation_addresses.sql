-- Collect delivery addresses when reserving; preserve existing orders and custom shipping guidance.
UPDATE projects
SET shipping_note = replace(shipping_note, '配送先はStripe決済時に入力してください。', '配送先は無料予約時に入力してください。')
WHERE id = 'izumi-wada-jazz-date'
  AND instr(shipping_note, '配送先はStripe決済時に入力してください。') > 0;
