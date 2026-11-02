-- Dữ liệu khởi tạo. Admin có thể sửa trong trang quản trị.

INSERT INTO servers (code, name, capacity) VALUES
  ('s1', 'Máy chủ Tâm An 1', 200),
  ('s2', 'Máy chủ Tâm An 2', 200)
ON CONFLICT (code) DO NOTHING;

-- Ba ngôi chùa HƯ CẤU, lấy cảm hứng chung từ kiến trúc chùa Việt. Toạ độ khu vực khớp với bản đồ 3D (client/src/world/layout.ts).
INSERT INTO temples (code, name, region, description, history, min_level, map_x, map_y, zones) VALUES
 ('tam_an', 'Tâm An Tự', 'Đồng bằng',
  'Ngôi chùa làng giữa cánh đồng lúa, mái ngói đỏ, ao sen trước sân. Nơi khởi đầu của mọi hành giả.',
  'Chùa hư cấu trong game. Bố cục "nội công ngoại quốc" quen thuộc của chùa làng Bắc Bộ: tam quan, sân, tiền đường, chánh điện, gác chuông và ao sen.',
  1, 0.46, 0.30,
  '[{"code":"gate","name":"Cổng tam quan","x":0,"z":34,"r":6},{"code":"courtyard","name":"Sân chùa","x":0,"z":16,"r":8},{"code":"incense","name":"Lư hương","x":0,"z":5,"r":4},{"code":"bell","name":"Gác chuông","x":-16,"z":6,"r":4.5},{"code":"main_hall","name":"Chánh điện","x":0,"z":-14,"r":9},{"code":"lotus_pond","name":"Ao sen","x":-24,"z":-6,"r":9},{"code":"lantern_lake","name":"Hồ hoa đăng","x":24,"z":6,"r":10},{"code":"meditation","name":"Rừng trúc thiền","x":-24,"z":22,"r":7},{"code":"chanting_hall","name":"Giảng đường","x":22,"z":-20,"r":7}]'),
 ('van_son', 'Vân Sơn Tự', 'Miền núi',
  'Chùa nép trên lưng núi, quanh năm mây phủ, rừng thông reo. Hợp để thiền định.',
  'Chùa hư cấu trong game. Gợi cảm hứng từ các thiền viện miền núi phía Bắc: sương sớm, bậc đá, tiếng chuông vang qua thung lũng.',
  3, 0.30, 0.18,
  '[{"code":"gate","name":"Cổng núi","x":0,"z":34,"r":6},{"code":"courtyard","name":"Sân đá","x":0,"z":16,"r":8},{"code":"incense","name":"Lư hương đá","x":0,"z":5,"r":4},{"code":"bell","name":"Chuông vọng cốc","x":-16,"z":6,"r":4.5},{"code":"main_hall","name":"Đại hùng bảo điện","x":0,"z":-14,"r":9},{"code":"lotus_pond","name":"Suối sen","x":-24,"z":-6,"r":9},{"code":"lantern_lake","name":"Hồ mây","x":24,"z":6,"r":10},{"code":"meditation","name":"Rừng thông thiền","x":-24,"z":22,"r":7},{"code":"chanting_hall","name":"Thiền đường","x":22,"z":-20,"r":7}]'),
 ('hai_nguyet', 'Hải Nguyệt Tự', 'Ven biển',
  'Chùa bên bờ biển miền Trung, đêm rằm trăng soi mặt nước, hoa đăng trôi ra vịnh.',
  'Chùa hư cấu trong game. Gợi cảm hứng từ những ngôi chùa ven biển miền Trung với tháp chuông nhìn ra vịnh và gió biển quanh năm.',
  6, 0.62, 0.62,
  '[{"code":"gate","name":"Cổng biển","x":0,"z":34,"r":6},{"code":"courtyard","name":"Sân cát","x":0,"z":16,"r":8},{"code":"incense","name":"Lư hương đồng","x":0,"z":5,"r":4},{"code":"bell","name":"Tháp chuông","x":-16,"z":6,"r":4.5},{"code":"main_hall","name":"Chánh điện","x":0,"z":-14,"r":9},{"code":"lotus_pond","name":"Đầm sen","x":-24,"z":-6,"r":9},{"code":"lantern_lake","name":"Vịnh hoa đăng","x":24,"z":6,"r":10},{"code":"meditation","name":"Đồi dương thiền","x":-24,"z":22,"r":7},{"code":"chanting_hall","name":"Giảng đường","x":22,"z":-20,"r":7}]')
ON CONFLICT (code) DO NOTHING;

INSERT INTO items (code, name, category, description, price_sen, price_ngoc, data, stackable, giftable, min_level) VALUES
 ('huong',      'Nén hương',          'offering', 'Dâng tại lư hương trước sân.',              5,  NULL, '{}', TRUE, TRUE, 1),
 ('nen',        'Ngọn nến',           'offering', 'Thắp trên bàn thờ chánh điện.',             6,  NULL, '{}', TRUE, TRUE, 1),
 ('hoa',        'Hoa sen tươi',       'offering', 'Dâng lên bàn thờ chánh điện.',              8,  NULL, '{}', TRUE, TRUE, 1),
 ('hoa_dang',   'Hoa đăng',           'offering', 'Thả trên hồ kèm một lời nguyện.',           10, NULL, '{}', TRUE, TRUE, 1),
 ('ao_lam',     'Áo tràng lam',       'robe',     'Áo tràng màu lam cơ bản.',                  NULL, NULL, '{"slot":"robe","color":"#4f6d8f"}', FALSE, FALSE, 1),
 ('ao_nau',     'Áo tràng nâu',       'robe',     'Sắc nâu đất mộc mạc.',                      120, NULL, '{"slot":"robe","color":"#7a5236"}', FALSE, FALSE, 1),
 ('ao_xam',     'Áo tràng xám tro',   'robe',     'Sắc xám tro thanh nhã.',                    150, NULL, '{"slot":"robe","color":"#8c8a86"}', FALSE, FALSE, 2),
 ('ao_vang',    'Áo vàng nghệ',       'robe',     'Sắc vàng nghệ ấm áp.',                      220, NULL, '{"slot":"robe","color":"#d39b2a"}', FALSE, FALSE, 4),
 ('ao_trang',   'Áo tràng trắng',     'robe',     'Sắc trắng tinh khiết.',                     260, NULL, '{"slot":"robe","color":"#ece6da"}', FALSE, FALSE, 5),
 ('chuoi_go',   'Chuỗi hạt gỗ trầm',  'item',     'Chuỗi 108 hạt màu gỗ trầm.',                150, NULL, '{"slot":"bead","color":"#6b3f22"}', FALSE, FALSE, 1),
 ('chuoi_ngoc', 'Chuỗi hạt ngọc bích','item',     'Chuỗi 108 hạt xanh ngọc.',                  320, NULL, '{"slot":"bead","color":"#3f8f7a"}', FALSE, FALSE, 3),
 ('den_long',   'Đèn lồng cầm tay',   'decor',    'Phụ kiện: đèn lồng giấy, sáng ấm về đêm.',  180, NULL, '{"slot":"accessory","kind":"lantern"}', FALSE, FALSE, 2),
 ('o_giay',     'Ô giấy dầu',         'decor',    'Phụ kiện: ô giấy dầu che nắng.',            200, NULL, '{"slot":"accessory","kind":"umbrella"}', FALSE, FALSE, 3),
 ('hao_quang',  'Hào quang sen',      'special',  'Phụ kiện đặc biệt: vầng sáng sen dưới chân.',NULL, 6,   '{"slot":"accessory","kind":"aura"}', FALSE, FALSE, 5),
 ('ao_kim',     'Áo tràng kim tuyến', 'special',  'Áo tràng thêu chỉ vàng.',                   NULL, 10,  '{"slot":"robe","color":"#b8862b","trim":"#f3d36b"}', FALSE, FALSE, 8)
ON CONFLICT (code) DO NOTHING;

INSERT INTO activities (code, name, merit, exp, sen, min_interval_ms, daily_cap, consumes_item, zone) VALUES
 ('prostrate', 'Lạy Phật',      1,  2, 0, 2500,   300, NULL,       'main_hall'),
 ('bead',      'Lần tràng hạt', 10, 15, 5, 250,    20,  NULL,       NULL),
 ('meditate',  'Thiền định',    2,  3, 1, 0,      120, NULL,       'meditation,main_hall'),
 ('chant',     'Tụng kinh',     15, 20, 5, 0,      10,  NULL,       'chanting_hall,main_hall'),
 ('incense',   'Thắp hương',    8,  5, 0, 300000, 20,  'huong',    'incense'),
 ('candle',    'Thắp nến',      6,  4, 0, 300000, 20,  'nen',      'main_hall'),
 ('flower',    'Dâng hoa',      6,  4, 0, 300000, 20,  'hoa',      'main_hall'),
 ('bell',      'Thỉnh chuông',  1,  1, 0, 30000,  30,  NULL,       'bell'),
 ('lantern',   'Thả hoa đăng',  12, 8, 0, 20000,  10,  'hoa_dang', 'lantern_lake'),
 ('explore',   'Khám phá',      5,  10, 5, 0,     100, NULL,       NULL)
ON CONFLICT (code) DO NOTHING;

INSERT INTO missions (code, name, description, period, reset, metric, target, reward_merit, reward_exp, reward_sen, reward_ngoc, reward_item, reward_item_qty, min_level, sort) VALUES
 ('d_prostrate', 'Lễ bái đầu ngày',   'Lạy Phật 20 lần trong chánh điện.',          'daily',     'daily',  'prostrate',    20, 5, 20, 15, 0, NULL, 0, 1, 1),
 ('d_bead',      'Một chuỗi niệm',    'Lần trọn 1 chuỗi 108 hạt.',                   'daily',     'daily',  'bead_round',   1,  5, 20, 10, 0, NULL, 0, 1, 2),
 ('d_meditate',  'Tĩnh tâm',          'Thiền định tổng cộng 5 phút.',                'daily',     'daily',  'meditate_min', 5,  5, 20, 10, 0, NULL, 0, 1, 3),
 ('d_offering',  'Dâng lễ',           'Dâng 2 lễ: hương, nến hoặc hoa.',             'daily',     'daily',  'offering',     2,  5, 15, 10, 0, 'huong', 2, 1, 4),
 ('d_bell',      'Tiếng chuông sớm',  'Thỉnh chuông 3 lần.',                         'daily',     'daily',  'bell',         3,  3, 10, 5,  0, NULL, 0, 1, 5),
 ('d_chant',     'Một thời kinh',     'Tụng trọn 1 bài kinh.',                       'daily',     'daily',  'chant',        1,  5, 20, 10, 0, NULL, 0, 1, 6),
 ('w_bead',      'Tuần trì niệm',     'Lần 15 chuỗi hạt trong tuần.',                'weekly',    'weekly', 'bead_round',   15, 30, 100, 50, 1, NULL, 0, 1, 10),
 ('w_meditate',  'Tuần an định',      'Thiền tổng cộng 60 phút trong tuần.',         'weekly',    'weekly', 'meditate_min', 60, 30, 100, 50, 1, NULL, 0, 1, 11),
 ('w_days',      'Bền tâm',           'Lên chùa 5 ngày khác nhau trong tuần.',       'weekly',    'weekly', 'active_day',   5,  30, 100, 50, 1, NULL, 0, 1, 12),
 ('s_lantern',   'Ngọn đèn đầu tiên', 'Thả chiếc hoa đăng đầu tiên.',                'special',   'once',   'lantern',      1,  10, 30, 20, 0, 'hoa_dang', 1, 1, 20),
 ('s_level5',    'Vững bước',         'Đạt cấp 5.',                                  'special',   'once',   'level',        5,  20, 50, 50, 1, NULL, 0, 1, 21),
 ('p_explore5',  'Bước chân hành hương','Nhận 5 dấu mộc hành hương.',                'pilgrimage','once',   'explore',      5,  10, 30, 30, 0, NULL, 0, 1, 30),
 ('p_explore9',  'Trọn Tâm An Tự',    'Nhận đủ 9 dấu mộc (mọi khu của một chùa).',   'pilgrimage','once',   'explore',      9,  20, 60, 50, 1, NULL, 0, 1, 31),
 ('p_explore18', 'Lên núi Vân Sơn',   'Nhận 18 dấu mộc hành hương.',                 'pilgrimage','once',   'explore',      18, 40, 120, 80, 2, NULL, 0, 3, 32),
 ('p_explore27', 'Viên mãn hành hương','Nhận đủ 27 dấu mộc của cả ba chùa.',         'pilgrimage','once',   'explore',      27, 80, 200, 150, 5, NULL, 0, 6, 33),
 ('c_chat',      'Lời chào đạo hữu',  'Gửi 1 lời chào ở kênh chung.',                'community', 'daily',  'chat',         1,  1, 5, 5, 0, NULL, 0, 1, 40),
 ('c_coop',      'Cộng tu',           'Tham gia cộng tu 5 lần (cùng tu với ≥2 người khác).','community','daily','coop',   5,  10, 20, 15, 0, NULL, 0, 1, 41),
 ('c_friend',    'Thiện hữu',         'Kết bạn với 1 người chơi.',                   'community', 'once',   'friend',       1,  5, 20, 20, 0, NULL, 0, 1, 42),
 ('c_gift',      'Hoan hỷ bố thí',    'Tặng quà cho bạn 1 lần trong tuần.',          'community', 'weekly', 'gift',         1,  10, 30, 20, 0, NULL, 0, 3, 43)
ON CONFLICT (code) DO NOTHING;

INSERT INTO achievements (code, name, description, stat, threshold, points, title, reward_ngoc) VALUES
 ('a_pro_108',   'Trăm lẻ tám lạy',   'Lạy Phật 108 lần.',            'prostrations',       108,  10, 'Lễ Bái Tinh Cần', 0),
 ('a_pro_1080',  'Nghìn lạy',         'Lạy Phật 1.080 lần.',          'prostrations',       1080, 30, 'Đảnh Lễ Kiên Tâm', 2),
 ('a_bead_10',   'Mười chuỗi',        'Lần 10 chuỗi hạt.',            'bead_rounds',        10,   10, NULL, 0),
 ('a_bead_108',  'Trì niệm',          'Lần 108 chuỗi hạt.',           'bead_rounds',        108,  30, 'Hành Giả Trì Niệm', 2),
 ('a_med_60',    'Một giờ tĩnh lặng', 'Thiền tổng cộng 60 phút.',     'meditation_minutes', 60,   10, NULL, 0),
 ('a_med_600',   'Thiền giả',         'Thiền tổng cộng 600 phút.',    'meditation_minutes', 600,  30, 'Thiền Giả', 2),
 ('a_chant_10',  'Mười thời kinh',    'Tụng 10 bài kinh.',            'chants',             10,   10, 'Người Trì Kinh', 0),
 ('a_off_20',    'Lễ vật đầy đủ',     'Dâng 20 lễ vật.',              'offerings',          20,   10, NULL, 0),
 ('a_lan_10',    'Mười ngọn đèn',     'Thả 10 hoa đăng.',             'lanterns',           10,   10, 'Người Thắp Đèn', 0),
 ('a_gift_5',    'Bố thí',            'Tặng quà 5 lần.',              'gifts_sent',         5,    10, 'Tâm Bố Thí', 1),
 ('a_days_7',    'Bảy ngày lên chùa', 'Lên chùa 7 ngày.',             'days_active',        7,    10, NULL, 1),
 ('a_days_30',   'Một tháng bền tâm', 'Lên chùa 30 ngày.',            'days_active',        30,   30, 'Bền Tâm', 3),
 ('a_lv_5',      'Cấp 5',             'Đạt cấp 5.',                   'level',              5,    10, NULL, 0),
 ('a_lv_10',     'Cấp 10',            'Đạt cấp 10.',                  'level',              10,   20, 'Đạo Tâm Vững Chãi', 1)
ON CONFLICT (code) DO NOTHING;
