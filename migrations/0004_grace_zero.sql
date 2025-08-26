-- Set grace period to zero for all chats (we no longer use grace)
UPDATE chats SET grace_days = 0;

