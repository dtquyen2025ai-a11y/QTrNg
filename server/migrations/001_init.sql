-- Tâm An Online – schema khởi tạo
-- Toàn bộ số dư tài nguyên chỉ được thay đổi qua server (economy.ts) trong transaction có khóa dòng.

CREATE TABLE IF NOT EXISTS servers (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  capacity    INT NOT NULL DEFAULT 200,
  is_open     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id                 BIGSERIAL PRIMARY KEY,
  username           TEXT UNIQUE NOT NULL,
  password_hash      TEXT NOT NULL,
  recovery_hash      TEXT NOT NULL,
  role               TEXT NOT NULL DEFAULT 'player'
                     CHECK (role IN ('player','support','moderator','game_admin','super_admin')),
  is_banned          BOOLEAN NOT NULL DEFAULT FALSE,
  ban_reason         TEXT,
  muted_until        TIMESTAMPTZ,
  token_version      INT NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS temples (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  region        TEXT NOT NULL,
  description   TEXT NOT NULL,
  history       TEXT NOT NULL,
  min_level     INT NOT NULL DEFAULT 1,
  map_x         REAL NOT NULL DEFAULT 0,   -- vị trí trên bản đồ hành hương (0..1)
  map_y         REAL NOT NULL DEFAULT 0,
  zones         JSONB NOT NULL DEFAULT '[]', -- [{code,name,x,z,r}] dấu mộc hành hương
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS characters (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  server_id     INT NOT NULL REFERENCES servers(id),
  dharma_name   TEXT NOT NULL,
  gender        TEXT NOT NULL CHECK (gender IN ('nam','nu')),
  hair          TEXT NOT NULL,
  skin          TEXT NOT NULL,
  equipment     JSONB NOT NULL DEFAULT '{}',  -- {robe, accessory, bead}: item code
  title_code    TEXT,
  temple_id     INT NOT NULL REFERENCES temples(id),
  pos_x         REAL NOT NULL DEFAULT 0,
  pos_z         REAL NOT NULL DEFAULT 40,
  rot_y         REAL NOT NULL DEFAULT 0,
  last_daily_gift DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, server_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS characters_name_uq ON characters (lower(dharma_name));

CREATE TABLE IF NOT EXISTS character_stats (
  character_id      BIGINT PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
  level             INT NOT NULL DEFAULT 1,
  exp               BIGINT NOT NULL DEFAULT 0,
  achievement_points INT NOT NULL DEFAULT 0,
  prostrations      BIGINT NOT NULL DEFAULT 0,
  bead_rounds       BIGINT NOT NULL DEFAULT 0,
  bead_progress     INT NOT NULL DEFAULT 0,
  last_bead_at      TIMESTAMPTZ,
  last_prostrate_at TIMESTAMPTZ,
  meditation_minutes BIGINT NOT NULL DEFAULT 0,
  chants            BIGINT NOT NULL DEFAULT 0,
  offerings         BIGINT NOT NULL DEFAULT 0,
  lanterns          BIGINT NOT NULL DEFAULT 0,
  gifts_sent        BIGINT NOT NULL DEFAULT 0,
  days_active       INT NOT NULL DEFAULT 0,
  last_active_date  DATE
);

-- Ví tài nguyên: merit (chỉ tăng), sen, ngoc
CREATE TABLE IF NOT EXISTS currencies (
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  code          TEXT NOT NULL CHECK (code IN ('merit','sen','ngoc')),
  balance       BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
  PRIMARY KEY (character_id, code)
);

CREATE TABLE IF NOT EXISTS items (
  id           SERIAL PRIMARY KEY,
  code         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  category     TEXT NOT NULL CHECK (category IN ('offering','robe','item','decor','special')),
  description  TEXT NOT NULL DEFAULT '',
  price_sen    INT,
  price_ngoc   INT,
  data         JSONB NOT NULL DEFAULT '{}',  -- robe: {color}, decor: {...}
  stackable    BOOLEAN NOT NULL DEFAULT TRUE,
  giftable     BOOLEAN NOT NULL DEFAULT TRUE,
  min_level    INT NOT NULL DEFAULT 1,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventory (
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  item_id       INT NOT NULL REFERENCES items(id),
  quantity      INT NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  acquired_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, item_id)
);

CREATE TABLE IF NOT EXISTS activities (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  merit           INT NOT NULL,
  exp             INT NOT NULL,
  sen             INT NOT NULL,
  min_interval_ms INT NOT NULL DEFAULT 0,
  daily_cap       INT NOT NULL,          -- số lần (hoặc phút với thiền) được thưởng mỗi ngày
  consumes_item   TEXT,                  -- code vật phẩm tiêu hao
  zone            TEXT,                  -- khu vực bắt buộc (nhiều khu: phân cách bằng dấu phẩy)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS activity_history (
  id            BIGSERIAL PRIMARY KEY,
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  activity_code TEXT NOT NULL REFERENCES activities(code),
  amount        INT NOT NULL DEFAULT 1,     -- lần / phút
  rewarded      BOOLEAN NOT NULL,
  merit         INT NOT NULL DEFAULT 0,
  exp           INT NOT NULL DEFAULT 0,
  sen           INT NOT NULL DEFAULT 0,
  meta          JSONB NOT NULL DEFAULT '{}',
  day           DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_history_char_day ON activity_history (character_id, day, activity_code);
CREATE INDEX IF NOT EXISTS activity_history_created ON activity_history (created_at);

-- Phiên đang chạy (thiền, tụng kinh) để server đo thời gian thực
CREATE TABLE IF NOT EXISTS activity_sessions (
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,
  ref           TEXT,
  planned       INT NOT NULL,          -- giây
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, kind)
);

CREATE TABLE IF NOT EXISTS missions (
  id           SERIAL PRIMARY KEY,
  code         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  period       TEXT NOT NULL CHECK (period IN ('daily','weekly','special','pilgrimage','community')),
  reset        TEXT NOT NULL DEFAULT 'daily' CHECK (reset IN ('daily','weekly','once')),
  metric       TEXT NOT NULL,     -- prostrate, bead_round, meditate_min, chant, offering, bell, lantern, explore, gift, friend, chat, coop
  target       INT NOT NULL,
  reward_merit INT NOT NULL DEFAULT 0,
  reward_exp   INT NOT NULL DEFAULT 0,
  reward_sen   INT NOT NULL DEFAULT 0,
  reward_ngoc  INT NOT NULL DEFAULT 0,
  reward_item  TEXT,
  reward_item_qty INT NOT NULL DEFAULT 0,
  min_level    INT NOT NULL DEFAULT 1,
  starts_at    TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  sort         INT NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS mission_progress (
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  mission_id    INT NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  period_key    TEXT NOT NULL,     -- '2026-11-02' | '2026-W45' | 'once'
  progress      INT NOT NULL DEFAULT 0,
  claimed_at    TIMESTAMPTZ,
  PRIMARY KEY (character_id, mission_id, period_key)
);

CREATE TABLE IF NOT EXISTS achievements (
  id           SERIAL PRIMARY KEY,
  code         TEXT UNIQUE NOT NULL,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  stat         TEXT NOT NULL,     -- cột trong character_stats hoặc 'level'
  threshold    BIGINT NOT NULL,
  points       INT NOT NULL DEFAULT 10,
  title        TEXT,              -- danh hiệu mở khóa
  reward_ngoc  INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS character_achievements (
  character_id   BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  achievement_id INT NOT NULL REFERENCES achievements(id),
  unlocked_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS friends (
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  friend_id     BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  status        TEXT NOT NULL CHECK (status IN ('pending','accepted','blocked')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, friend_id),
  CHECK (character_id <> friend_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id            BIGSERIAL PRIMARY KEY,
  server_id     INT NOT NULL REFERENCES servers(id),
  temple_id     INT REFERENCES temples(id),
  sender_id     BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  recipient_id  BIGINT REFERENCES characters(id) ON DELETE CASCADE,  -- NULL = kênh chung
  body          TEXT NOT NULL,
  is_hidden     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_recent ON messages (server_id, created_at DESC);

CREATE TABLE IF NOT EXISTS gifts (
  id            BIGSERIAL PRIMARY KEY,
  sender_id     BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  recipient_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  sen           INT NOT NULL DEFAULT 0,
  item_id       INT REFERENCES items(id),
  item_qty      INT NOT NULL DEFAULT 0,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS pilgrimage_progress (
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  temple_id     INT NOT NULL REFERENCES temples(id),
  zone_code     TEXT NOT NULL,
  stamped_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, temple_id, zone_code)
);

-- Sổ cái: mọi thay đổi tài nguyên/vật phẩm
CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,      -- activity, mission, shop, gift_in, gift_out, level_up, achievement, daily_gift, admin, explore
  currency      TEXT,               -- merit | sen | ngoc | exp | item
  item_id       INT REFERENCES items(id),
  delta         BIGINT NOT NULL,
  balance_after BIGINT,
  ref           TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_char ON transactions (character_id, created_at DESC);

CREATE TABLE IF NOT EXISTS game_events (
  id              SERIAL PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  merit_multiplier REAL NOT NULL DEFAULT 1,
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS lanterns (
  id            BIGSERIAL PRIMARY KEY,
  character_id  BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  server_id     INT NOT NULL REFERENCES servers(id),
  temple_id     INT NOT NULL REFERENCES temples(id),
  wish          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reports (
  id            BIGSERIAL PRIMARY KEY,
  reporter_id   BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  target_id     BIGINT NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  message_id    BIGINT REFERENCES messages(id) ON DELETE SET NULL,
  reason        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  handled_by    BIGINT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_logs (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    BIGINT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,
  target      TEXT,
  detail      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
