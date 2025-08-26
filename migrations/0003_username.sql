ALTER TABLE chat_members ADD COLUMN username TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_members_username ON chat_members (chat_id, username);

