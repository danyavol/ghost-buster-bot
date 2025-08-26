-- D1 schema init
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chats (
  chat_id INTEGER PRIMARY KEY,
  title TEXT,
  activity_window_days INTEGER NOT NULL DEFAULT 60,
  grace_days INTEGER NOT NULL DEFAULT 7,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_members (
  chat_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member', -- creator|administrator|member|restricted|left|kicked
  joined_at TEXT,
  last_message_at TEXT,
  last_activity_at TEXT,
  warned_at TEXT,
  excluded INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id),
  FOREIGN KEY (chat_id) REFERENCES chats(chat_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_members_activity ON chat_members (chat_id, role, excluded, last_activity_at);
CREATE INDEX IF NOT EXISTS idx_chat_members_warned ON chat_members (chat_id, warned_at);

