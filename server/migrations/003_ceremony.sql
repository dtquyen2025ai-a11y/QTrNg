-- Đại lễ cộng tu theo lịch (6h, 20h; thêm 12h ngày Rằm/mùng Một)
CREATE TABLE IF NOT EXISTS ceremonies (
  id            BIGSERIAL PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('scheduled','adhoc')),
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  lunar_label   TEXT,
  multiplier    REAL NOT NULL DEFAULT 1,
  participants  INT NOT NULL DEFAULT 0,
  created_by    BIGINT REFERENCES users(id),
  finished      BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (kind, starts_at)
);

CREATE TABLE IF NOT EXISTS ceremony_attendance (
  ceremony_id   BIGINT NOT NULL REFERENCES ceremonies(id) ON DELETE CASCADE,
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  presence      REAL NOT NULL,          -- tỉ lệ thời gian có mặt (0..1)
  rewarded      BOOLEAN NOT NULL,
  merit         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (ceremony_id, character_id)
);

ALTER TABLE character_stats ADD COLUMN IF NOT EXISTS ceremonies BIGINT NOT NULL DEFAULT 0;

INSERT INTO activities (code, name, merit, exp, sen, min_interval_ms, daily_cap, consumes_item, zone) VALUES
 ('ceremony', 'Đại lễ cộng tu', 30, 40, 15, 0, 3, NULL, 'main_hall')
ON CONFLICT (code) DO NOTHING;

INSERT INTO missions (code, name, description, period, reset, metric, target, reward_merit, reward_exp, reward_sen, reward_ngoc, min_level, sort) VALUES
 ('d_ceremony', 'Dự đại lễ',        'Tham dự trọn 1 buổi đại lễ cộng tu tại Chánh điện.', 'community', 'daily',  'ceremony', 1, 10, 20, 15, 0, 1, 44),
 ('w_ceremony', 'Đại chúng đồng tu', 'Tham dự 3 buổi đại lễ trong tuần.',                  'weekly',    'weekly', 'ceremony', 3, 30, 100, 40, 1, 1, 13)
ON CONFLICT (code) DO NOTHING;

INSERT INTO achievements (code, name, description, stat, threshold, points, title, reward_ngoc) VALUES
 ('a_cer_1',  'Lần đầu dự lễ', 'Tham dự trọn một buổi đại lễ.', 'ceremonies', 1,  10, NULL, 0),
 ('a_cer_30', 'Thường trụ đạo tràng', 'Tham dự 30 buổi đại lễ.', 'ceremonies', 30, 30, 'Đạo Tràng Hộ Pháp', 3)
ON CONFLICT (code) DO NOTHING;
