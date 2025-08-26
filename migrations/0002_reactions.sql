ALTER TABLE chat_members ADD COLUMN last_reaction_at TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_members_reaction ON chat_members (chat_id, last_reaction_at);

