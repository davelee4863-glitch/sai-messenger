PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
 id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, nickname TEXT NOT NULL,
 created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS auth_credentials (
 user_id TEXT PRIMARY KEY REFERENCES users(id), password_salt TEXT NOT NULL, password_hash TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS rooms (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('direct','group')),
 title TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id),
 direct_key TEXT UNIQUE, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS room_members (
 room_id TEXT NOT NULL REFERENCES rooms(id), user_id TEXT NOT NULL REFERENCES users(id),
 active INTEGER NOT NULL CHECK(active IN (0,1)), joined_at INTEGER NOT NULL,
 PRIMARY KEY(room_id,user_id)
) STRICT;
CREATE TABLE IF NOT EXISTS messages (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 room_id TEXT NOT NULL REFERENCES rooms(id), sender_id TEXT NOT NULL REFERENCES users(id),
 client_id TEXT NOT NULL, body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000), created_at INTEGER NOT NULL,
 UNIQUE(room_id,sender_id,client_id)
) STRICT;
CREATE INDEX IF NOT EXISTS messages_room_seq ON messages(room_id,seq);
CREATE TABLE IF NOT EXISTS message_receipts (
 message_id TEXT NOT NULL REFERENCES messages(id), user_id TEXT NOT NULL REFERENCES users(id),
 delivered_at INTEGER, PRIMARY KEY(message_id,user_id)
) STRICT;
CREATE TABLE IF NOT EXISTS proposals (
 id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id), host_id TEXT NOT NULL REFERENCES users(id),
 payload TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','ignored','confirmed')),
 version INTEGER NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS promises (
 id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE REFERENCES proposals(id),
 proposal_version INTEGER NOT NULL, room_id TEXT NOT NULL REFERENCES rooms(id),
 host_id TEXT NOT NULL REFERENCES users(id), payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('confirmed','cancelled')), version INTEGER NOT NULL,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS promise_attendees (
 promise_id TEXT NOT NULL REFERENCES promises(id), user_id TEXT NOT NULL REFERENCES users(id),
 response TEXT NOT NULL CHECK(response IN ('pending','going','maybe','declined')), responded_at INTEGER,
 PRIMARY KEY(promise_id,user_id)
) STRICT;
CREATE TABLE IF NOT EXISTS approval_reviews (
 id TEXT PRIMARY KEY, promise_id TEXT NOT NULL REFERENCES promises(id), actor_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('change','cancel')), expected_version INTEGER NOT NULL,
 payload TEXT, expires_at INTEGER NOT NULL, used_at INTEGER
) STRICT;
CREATE TABLE IF NOT EXISTS history (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, room_id TEXT NOT NULL REFERENCES rooms(id),
 promise_id TEXT REFERENCES promises(id), actor_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
PRAGMA user_version = 1;
