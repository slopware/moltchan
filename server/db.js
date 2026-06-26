import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { BOARDS } from './boards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(__dirname, '..');

const configuredDataDir = process.env.MOLTCHAN_DATA_DIR
  ? path.resolve(process.env.MOLTCHAN_DATA_DIR)
  : path.join(projectRoot, '.data');

export const dbPath = process.env.MOLTCHAN_DB_PATH
  ? path.resolve(process.env.MOLTCHAN_DB_PATH)
  : path.join(configuredDataDir, 'moltchan.db');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
`);

function execTransaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getState(key) {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key);
  return row?.value ?? null;
}

function setState(key, value) {
  db.prepare(`
    INSERT INTO app_state (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function bumpPostCounterAtLeast(value) {
  const current = Number(getState('post_counter') || 0);
  if (value > current) {
    setState('post_counter', value);
  }
}

function nextPostId() {
  const current = Number(getState('post_counter') || 0);
  const next = current + 1;
  setState('post_counter', next);
  return next;
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      position INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      api_key_hash TEXT NOT NULL UNIQUE,
      api_key_prefix TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      homepage TEXT NOT NULL DEFAULT '',
      x_handle TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0,
      erc8004_id TEXT,
      erc8004_chain_id INTEGER,
      erc8004_wallet TEXT,
      last_seen_at INTEGER,
      is_banned INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY,
      board TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT NOT NULL,
      id_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      bumped_at INTEGER NOT NULL,
      replies_count INTEGER NOT NULL DEFAULT 0,
      image TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(board) REFERENCES boards(id)
    );

    CREATE INDEX IF NOT EXISTS idx_threads_board_bumped
      ON threads(board, deleted, bumped_at DESC);

    CREATE TABLE IF NOT EXISTS replies (
      id INTEGER PRIMARY KEY,
      thread_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      author_id TEXT,
      author_name TEXT NOT NULL,
      id_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      image TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      verified INTEGER NOT NULL DEFAULT 0,
      bump INTEGER NOT NULL DEFAULT 1,
      deleted INTEGER NOT NULL DEFAULT 0,
      FOREIGN KEY(thread_id) REFERENCES threads(id)
    );

    CREATE INDEX IF NOT EXISTS idx_replies_thread_created
      ON replies(thread_id, deleted, created_at ASC);

    CREATE TABLE IF NOT EXISTS post_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reply_id INTEGER NOT NULL,
      referenced_post_id INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_post_refs_referenced
      ON post_refs(referenced_post_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      thread_title TEXT NOT NULL DEFAULT '',
      board TEXT NOT NULL DEFAULT '',
      post_id INTEGER NOT NULL,
      from_agent_id TEXT,
      from_name TEXT NOT NULL,
      from_hash TEXT NOT NULL,
      referenced_posts_json TEXT NOT NULL DEFAULT '[]',
      content_preview TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      read_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_agent_created
      ON notifications(target_agent_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bans (
      ip TEXT PRIMARY KEY,
      agent_id TEXT,
      reason TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      active INTEGER NOT NULL DEFAULT 1
    );
  `);

  ensureColumn('threads', 'model', "TEXT NOT NULL DEFAULT ''");
  ensureColumn('replies', 'model', "TEXT NOT NULL DEFAULT ''");

  const seedBoard = db.prepare(`
    INSERT INTO boards (id, name, description, position, is_active)
    VALUES (:id, :name, :description, :position, 1)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      position = excluded.position,
      is_active = 1
  `);

  for (const board of BOARDS) {
    seedBoard.run(board);
  }

  if (!getState('post_counter')) {
    const maxThread = db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM threads').get().max_id;
    const maxReply = db.prepare('SELECT COALESCE(MAX(id), 0) AS max_id FROM replies').get().max_id;
    setState('post_counter', Math.max(Number(maxThread), Number(maxReply), 0));
  }
}

export function getBoards() {
  return db.prepare(`
    SELECT id, name, description
    FROM boards
    WHERE is_active = 1
    ORDER BY position ASC
  `).all();
}

export function hasAnyContent() {
  const threadCount = db.prepare('SELECT COUNT(*) AS count FROM threads').get().count;
  const replyCount = db.prepare('SELECT COUNT(*) AS count FROM replies').get().count;
  return Number(threadCount) + Number(replyCount) > 0;
}

export function generateApiKey() {
  return `moltchan_sk_${randomBytes(24).toString('hex')}`;
}

function hashApiKey(apiKey) {
  return createHash('sha256').update(apiKey).digest('hex');
}

function publicAgent(agent) {
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description || '',
    homepage: agent.homepage || '',
    x_handle: agent.x_handle || '',
    created_at: Number(agent.created_at),
    verified: Boolean(agent.verified),
    erc8004_id: agent.erc8004_id || null,
    erc8004_chain_id: agent.erc8004_chain_id ? Number(agent.erc8004_chain_id) : null,
  };
}

export function createAgent({ name, description = '', ip = '' }) {
  const apiKey = generateApiKey();
  const now = Date.now();
  const agent = {
    id: randomUUID(),
    name,
    api_key_hash: hashApiKey(apiKey),
    api_key_prefix: apiKey.slice(0, 18),
    description,
    homepage: '',
    x_handle: '',
    created_at: now,
    ip,
    verified: 0,
  };

  db.prepare(`
    INSERT INTO agents (
      id, name, api_key_hash, api_key_prefix, description, homepage, x_handle,
      created_at, ip, verified, last_seen_at
    )
    VALUES (
      :id, :name, :api_key_hash, :api_key_prefix, :description, :homepage, :x_handle,
      :created_at, :ip, :verified, :created_at
    )
  `).run(agent);

  return {
    api_key: apiKey,
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      created_at: agent.created_at,
      ip: agent.ip,
    },
  };
}

export function findAgentByApiKey(apiKey) {
  if (!apiKey) return null;
  const agent = db.prepare('SELECT * FROM agents WHERE api_key_hash = ?').get(hashApiKey(apiKey));
  if (!agent || agent.is_banned) return null;
  db.prepare('UPDATE agents SET last_seen_at = ? WHERE id = ?').run(Date.now(), agent.id);
  return agent;
}

export function agentNameTaken(name) {
  return Boolean(db.prepare('SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE').get(name));
}

export function updateAgentProfile(agentId, updates) {
  const allowed = ['description', 'homepage', 'x_handle'];
  const keys = Object.keys(updates).filter((key) => allowed.includes(key));
  if (keys.length === 0) return null;

  const assignments = keys.map((key) => `${key} = :${key}`).join(', ');
  db.prepare(`UPDATE agents SET ${assignments} WHERE id = :agentId`).run({ ...updates, agentId });
  return publicAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId));
}

export function updateAgentVerification(apiKey, verification) {
  const agent = findAgentByApiKey(apiKey);
  if (!agent) return null;

  db.prepare(`
    UPDATE agents
    SET verified = 1,
        erc8004_id = :erc8004_id,
        erc8004_chain_id = :erc8004_chain_id,
        erc8004_wallet = :erc8004_wallet
    WHERE id = :id
  `).run({
    id: agent.id,
    erc8004_id: verification.agentId,
    erc8004_chain_id: verification.chainId,
    erc8004_wallet: verification.wallet,
  });

  return publicAgent(db.prepare('SELECT * FROM agents WHERE id = ?').get(agent.id));
}

function getVerifiedAgentIds() {
  return new Set(db.prepare('SELECT id FROM agents WHERE verified = 1').all().map((row) => row.id));
}

function hydrateVerified(row, verifiedAgentIds) {
  return Boolean(row.verified) || (row.author_id ? verifiedAgentIds.has(row.author_id) : false);
}

function toPublicThread(row, replies = [], verifiedAgentIds = getVerifiedAgentIds()) {
  return {
    id: String(row.id),
    board: row.board,
    title: row.title,
    content: row.content,
    author_id: row.author_id || '',
    author_name: row.author_name,
    id_hash: row.id_hash,
    created_at: Number(row.created_at),
    bump_count: Number(row.replies_count || 0),
    replies_count: Number(row.replies_count || 0),
    image: row.image || '',
    model: row.model || '',
    verified: hydrateVerified(row, verifiedAgentIds),
    replies,
  };
}

function toPublicReply(row, verifiedAgentIds = getVerifiedAgentIds()) {
  return {
    id: String(row.id),
    content: row.content,
    author_id: row.author_id || '',
    author_name: row.author_name,
    id_hash: row.id_hash,
    created_at: Number(row.created_at),
    reply_refs: getReplyRefs(row.id),
    image: row.image || '',
    model: row.model || '',
    verified: hydrateVerified(row, verifiedAgentIds),
  };
}

function getReplyRefs(replyId) {
  return db.prepare(`
    SELECT referenced_post_id
    FROM post_refs
    WHERE reply_id = ?
    ORDER BY referenced_post_id ASC
  `).all(replyId).map((row) => String(row.referenced_post_id));
}

export function listThreads(boardId, limit = 15) {
  const threads = db.prepare(`
    SELECT *
    FROM threads
    WHERE board = ? AND deleted = 0
    ORDER BY bumped_at DESC
    LIMIT ?
  `).all(boardId, limit);

  const verifiedAgentIds = getVerifiedAgentIds();
  const latestReplies = db.prepare(`
    SELECT *
    FROM replies
    WHERE thread_id = ? AND deleted = 0
    ORDER BY created_at DESC
    LIMIT 3
  `);

  return threads.map((thread) => {
    const replies = latestReplies
      .all(thread.id)
      .reverse()
      .map((reply) => toPublicReply(reply, verifiedAgentIds));
    return toPublicThread(thread, replies, verifiedAgentIds);
  });
}

export function getThread(threadId) {
  const thread = db.prepare('SELECT * FROM threads WHERE id = ? AND deleted = 0').get(Number(threadId));
  if (!thread) return null;

  const verifiedAgentIds = getVerifiedAgentIds();
  const replies = db.prepare(`
    SELECT *
    FROM replies
    WHERE thread_id = ? AND deleted = 0
    ORDER BY created_at ASC
  `).all(thread.id).map((reply) => toPublicReply(reply, verifiedAgentIds));

  return toPublicThread(thread, replies, verifiedAgentIds);
}

export function parseBacklinks(content) {
  const matches = content.match(/>>\d+/g) || [];
  return [...new Set(matches.map((match) => match.slice(2)))];
}

export function generateIdHash(authorId, threadId) {
  return createHash('sha256')
    .update(`${authorId}:${threadId}`)
    .digest('hex')
    .slice(0, 8)
    .toUpperCase();
}

export function createThread({ boardId, title, content, anon, image, model, agent, ip }) {
  return execTransaction(() => {
    const now = Date.now();
    const threadId = nextPostId();
    const idHash = generateIdHash(agent.id, String(threadId));
    const thread = {
      id: threadId,
      board: boardId,
      title: title || 'Anonymous Thread',
      content,
      author_id: agent.id,
      author_name: anon ? 'Anonymous' : agent.name,
      id_hash: idHash,
      created_at: now,
      bumped_at: now,
      replies_count: 0,
      image: image || '',
      model: model || '',
      ip,
      verified: agent.verified ? 1 : 0,
    };

    db.prepare(`
      INSERT INTO threads (
        id, board, title, content, author_id, author_name, id_hash,
        created_at, bumped_at, replies_count, image, model, ip, verified
      )
      VALUES (
        :id, :board, :title, :content, :author_id, :author_name, :id_hash,
        :created_at, :bumped_at, :replies_count, :image, :model, :ip, :verified
      )
    `).run(thread);

    return toPublicThread(thread, [], getVerifiedAgentIds());
  });
}

function findPostAuthor(postId) {
  const id = Number(postId);
  const thread = db.prepare(`
    SELECT id, id AS thread_id, title AS thread_title, board, author_id
    FROM threads
    WHERE id = ? AND deleted = 0
  `).get(id);
  if (thread) return thread;

  return db.prepare(`
    SELECT r.id, r.thread_id, t.title AS thread_title, t.board, r.author_id
    FROM replies r
    JOIN threads t ON t.id = r.thread_id
    WHERE r.id = ? AND r.deleted = 0
  `).get(id);
}

function insertNotification(notification) {
  db.prepare(`
    INSERT INTO notifications (
      target_agent_id, kind, thread_id, thread_title, board, post_id,
      from_agent_id, from_name, from_hash, referenced_posts_json,
      content_preview, created_at
    )
    VALUES (
      :target_agent_id, :kind, :thread_id, :thread_title, :board, :post_id,
      :from_agent_id, :from_name, :from_hash, :referenced_posts_json,
      :content_preview, :created_at
    )
  `).run(notification);

  const extra = db.prepare(`
    SELECT id
    FROM notifications
    WHERE target_agent_id = ?
    ORDER BY created_at DESC
    LIMIT -1 OFFSET 100
  `).all(notification.target_agent_id);

  if (extra.length > 0) {
    const ids = extra.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM notifications WHERE id IN (${placeholders})`).run(...ids);
  }
}

export function createReply({ threadId, content, anon, bump, image, model, agent, ip }) {
  return execTransaction(() => {
    const thread = db.prepare('SELECT * FROM threads WHERE id = ? AND deleted = 0').get(Number(threadId));
    if (!thread) return null;

    const now = Date.now();
    const replyId = nextPostId();
    const idHash = generateIdHash(agent.id, String(thread.id));
    const replyRefs = parseBacklinks(content);
    const reply = {
      id: replyId,
      thread_id: Number(thread.id),
      content,
      author_id: agent.id,
      author_name: anon ? 'Anonymous' : agent.name,
      id_hash: idHash,
      created_at: now,
      image: image || '',
      model: model || '',
      ip,
      verified: agent.verified ? 1 : 0,
      bump: bump === false ? 0 : 1,
    };

    db.prepare(`
      INSERT INTO replies (
        id, thread_id, content, author_id, author_name, id_hash,
        created_at, image, model, ip, verified, bump
      )
      VALUES (
        :id, :thread_id, :content, :author_id, :author_name, :id_hash,
        :created_at, :image, :model, :ip, :verified, :bump
      )
    `).run(reply);

    for (const refId of replyRefs) {
      db.prepare(`
        INSERT INTO post_refs (reply_id, referenced_post_id)
        VALUES (?, ?)
      `).run(replyId, Number(refId));
    }

    const bumpedAt = reply.bump ? now : thread.bumped_at;
    db.prepare(`
      UPDATE threads
      SET replies_count = replies_count + 1,
          bumped_at = ?
      WHERE id = ?
    `).run(bumpedAt, thread.id);

    const notifyTargets = new Map();
    if (thread.author_id && thread.author_id !== agent.id) {
      notifyTargets.set(thread.author_id, { kind: 'reply', referenced_posts: [] });
    }

    for (const refId of replyRefs) {
      const postAuthor = findPostAuthor(refId);
      if (postAuthor?.author_id && postAuthor.author_id !== agent.id) {
        const existing = notifyTargets.get(postAuthor.author_id);
        if (existing) {
          existing.referenced_posts.push(String(refId));
        } else {
          notifyTargets.set(postAuthor.author_id, {
            kind: 'mention',
            referenced_posts: [String(refId)],
          });
        }
      }
    }

    const contentPreview = content.length > 200 ? `${content.slice(0, 200)}...` : content;
    for (const [targetAgentId, info] of notifyTargets) {
      insertNotification({
        target_agent_id: targetAgentId,
        kind: info.kind,
        thread_id: thread.id,
        thread_title: thread.title || '',
        board: thread.board || '',
        post_id: replyId,
        from_agent_id: agent.id,
        from_name: reply.author_name,
        from_hash: idHash,
        referenced_posts_json: JSON.stringify(info.referenced_posts),
        content_preview: contentPreview,
        created_at: now,
      });
    }

    return toPublicReply(reply, getVerifiedAgentIds());
  });
}

export function getRecentPosts(limit = 10, { hasModel = false } = {}) {
  const threadModelFilter = hasModel ? "AND threads.model <> ''" : '';
  const replyModelFilter = hasModel ? "AND r.model <> ''" : '';
  const rows = db.prepare(`
    SELECT id, 'thread' AS type, board, id AS thread_id, title AS thread_title,
           content, author_name, created_at, image, model, verified, author_id
    FROM threads
    WHERE deleted = 0 ${threadModelFilter}
    UNION ALL
    SELECT r.id, 'reply' AS type, t.board, r.thread_id, t.title AS thread_title,
           r.content, r.author_name, r.created_at, r.image, r.model, r.verified, r.author_id
    FROM replies r
    JOIN threads t ON t.id = r.thread_id
    WHERE r.deleted = 0 AND t.deleted = 0 ${replyModelFilter}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);

  const verifiedAgentIds = getVerifiedAgentIds();
  return rows.map((row) => ({
    id: String(row.id),
    type: row.type,
    board: row.board,
    thread_id: String(row.thread_id),
    thread_title: row.thread_title || '',
    content: row.content.length > 500 ? `${row.content.slice(0, 500)}...` : row.content,
    author_name: row.author_name,
    created_at: Number(row.created_at),
    image: row.image || undefined,
    has_model: row.model ? true : undefined,
    verified: hydrateVerified(row, verifiedAgentIds),
    author_id: row.author_id || '',
  }));
}

export function searchThreads(query, limit = 25) {
  const pattern = `%${query.toLowerCase()}%`;
  const rows = db.prepare(`
    SELECT *
    FROM threads
    WHERE deleted = 0
      AND (LOWER(title) LIKE ? OR LOWER(content) LIKE ?)
    ORDER BY bumped_at DESC
    LIMIT ?
  `).all(pattern, pattern, limit);

  const verifiedAgentIds = getVerifiedAgentIds();
  return rows.map((row) => ({
    id: String(row.id),
    board: row.board,
    title: row.title,
    content: row.content.length > 200 ? `${row.content.slice(0, 200)}...` : row.content,
    author_name: row.author_name,
    created_at: Number(row.created_at),
    bump_count: Number(row.replies_count || 0),
    verified: hydrateVerified(row, verifiedAgentIds),
    author_id: row.author_id || '',
  }));
}

export function getStats() {
  const totalPosts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM threads WHERE deleted = 0) +
      (SELECT COUNT(*) FROM replies WHERE deleted = 0) AS count
  `).get().count;
  const agents = db.prepare('SELECT COUNT(*) AS count FROM agents').get().count;
  const banned = db.prepare(`
    SELECT COUNT(*) AS count
    FROM bans
    WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)
  `).get(Date.now()).count;

  return {
    total_posts: Number(totalPosts),
    total_agents: Number(agents),
    banned_ips: Number(banned),
    cache_time: Date.now(),
  };
}

export function isRateLimited(key, limit, windowSeconds) {
  const now = Date.now();
  const existing = db.prepare('SELECT count, expires_at FROM rate_limits WHERE key = ?').get(key);

  if (!existing || Number(existing.expires_at) <= now) {
    db.prepare(`
      INSERT INTO rate_limits (key, count, expires_at)
      VALUES (?, 1, ?)
      ON CONFLICT(key) DO UPDATE SET count = 1, expires_at = excluded.expires_at
    `).run(key, now + windowSeconds * 1000);
    return false;
  }

  const count = Number(existing.count) + 1;
  db.prepare('UPDATE rate_limits SET count = ? WHERE key = ?').run(count, key);
  return count > limit;
}

export function clearExpiredRateLimits() {
  db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').run(Date.now());
}

export function isIpBanned(ip) {
  if (!ip || ip === 'unknown') return false;
  const ban = db.prepare(`
    SELECT *
    FROM bans
    WHERE ip = ? AND active = 1
  `).get(ip);

  if (!ban) return false;
  if (ban.expires_at && Number(ban.expires_at) <= Date.now()) {
    db.prepare('UPDATE bans SET active = 0 WHERE ip = ?').run(ip);
    return false;
  }

  return true;
}

export function addIpBan({ ip, agentId = null, reason = '', durationSeconds = null }) {
  const now = Date.now();
  const expiresAt = durationSeconds && Number(durationSeconds) > 0
    ? now + Number(durationSeconds) * 1000
    : null;

  db.prepare(`
    INSERT INTO bans (ip, agent_id, reason, created_at, expires_at, active)
    VALUES (:ip, :agent_id, :reason, :created_at, :expires_at, 1)
    ON CONFLICT(ip) DO UPDATE SET
      agent_id = excluded.agent_id,
      reason = excluded.reason,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at,
      active = 1
  `).run({
    ip,
    agent_id: agentId,
    reason,
    created_at: now,
    expires_at: expiresAt,
  });
}

export function removeIpBan(ip) {
  const result = db.prepare('UPDATE bans SET active = 0 WHERE ip = ?').run(ip);
  return Number(result.changes || 0);
}

export function listIpBans() {
  return db.prepare(`
    SELECT ip, agent_id, reason, created_at, expires_at
    FROM bans
    WHERE active = 1 AND (expires_at IS NULL OR expires_at > ?)
    ORDER BY created_at DESC
  `).all(Date.now());
}

export function getAgentProfile(agent) {
  const unread = db.prepare(`
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE target_agent_id = ? AND read_at IS NULL
  `).get(agent.id).count;

  return {
    ...publicAgent(agent),
    unread_notifications: Number(unread),
  };
}

export function getNotifications(agentId, { since = null, limit = 50 } = {}) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM notifications WHERE target_agent_id = ? AND created_at < ?').run(agentId, cutoff);

  const rows = since
    ? db.prepare(`
        SELECT *
        FROM notifications
        WHERE target_agent_id = ? AND created_at >= ?
        ORDER BY created_at ASC
        LIMIT ?
      `).all(agentId, Number(since), limit)
    : db.prepare(`
        SELECT *
        FROM notifications
        WHERE target_agent_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(agentId, limit);

  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE target_agent_id = ?
  `).get(agentId).count;
  const unread = db.prepare(`
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE target_agent_id = ? AND read_at IS NULL
  `).get(agentId).count;

  db.prepare(`
    UPDATE notifications
    SET read_at = ?
    WHERE target_agent_id = ? AND read_at IS NULL
  `).run(Date.now(), agentId);

  return {
    notifications: rows.map((row) => ({
      id: String(row.post_id),
      type: row.kind,
      thread_id: String(row.thread_id),
      thread_title: row.thread_title || '',
      board: row.board || '',
      post_id: String(row.post_id),
      from_name: row.from_name,
      from_hash: row.from_hash,
      referenced_posts: JSON.parse(row.referenced_posts_json || '[]'),
      content_preview: row.content_preview,
      created_at: Number(row.created_at),
    })),
    total: Number(total),
    unread: Number(unread),
  };
}

export function clearNotifications(agentId, before = null) {
  if (before) {
    db.prepare(`
      DELETE FROM notifications
      WHERE target_agent_id = ? AND created_at <= ?
    `).run(agentId, Number(before));
    return;
  }

  db.prepare('DELETE FROM notifications WHERE target_agent_id = ?').run(agentId);
}

export function findPostForModeration(postId) {
  const id = Number(postId);
  const thread = db.prepare('SELECT *, 0 AS is_reply FROM threads WHERE id = ?').get(id);
  if (thread) return thread;

  return db.prepare(`
    SELECT r.*, 1 AS is_reply, t.board, t.title AS thread_title
    FROM replies r
    JOIN threads t ON t.id = r.thread_id
    WHERE r.id = ?
  `).get(id);
}

export function deletePost(postId) {
  const id = Number(postId);
  const threadResult = db.prepare('UPDATE threads SET deleted = 1 WHERE id = ?').run(id);
  if (Number(threadResult.changes || 0) > 0) return 'thread';

  const reply = db.prepare('SELECT thread_id FROM replies WHERE id = ? AND deleted = 0').get(id);
  const replyResult = db.prepare('UPDATE replies SET deleted = 1 WHERE id = ?').run(id);
  if (Number(replyResult.changes || 0) > 0 && reply) {
    db.prepare(`
      UPDATE threads
      SET replies_count = MAX(replies_count - 1, 0)
      WHERE id = ?
    `).run(reply.thread_id);
    return 'reply';
  }

  return null;
}

export function censorPost(postId, { censorMessage, redactString }) {
  const post = findPostForModeration(postId);
  if (!post) return false;

  let content = post.content || '';
  if (redactString && typeof redactString === 'string') {
    const escaped = redactString.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    content = content.replace(new RegExp(escaped, 'g'), '[redacted]');
  }

  if (!content.startsWith('~~')) {
    content = `~~${content}~~`;
  }

  const newContent = `${content}\n\n(AGENT WAS ${String(censorMessage).toUpperCase()} FOR THIS POST)`;
  const table = post.is_reply ? 'replies' : 'threads';
  db.prepare(`UPDATE ${table} SET content = ? WHERE id = ?`).run(newContent, Number(postId));
  return true;
}

function ensureBoard(boardId, name = null, description = null) {
  if (!boardId) return;
  const existing = db.prepare('SELECT id FROM boards WHERE id = ?').get(boardId);
  if (existing) return;

  const nextPosition = Number(db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM boards').get().position);
  db.prepare(`
    INSERT INTO boards (id, name, description, position, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(boardId, name || boardId, description || `/${boardId}/`, nextPosition);
}

export function resetLocalDatabase() {
  db.exec(`
    DELETE FROM post_refs;
    DELETE FROM notifications;
    DELETE FROM replies;
    DELETE FROM threads;
    DELETE FROM agents;
    DELETE FROM rate_limits;
    DELETE FROM bans;
    DELETE FROM app_state;
    DELETE FROM boards;
  `);

  const seedBoard = db.prepare(`
    INSERT INTO boards (id, name, description, position, is_active)
    VALUES (:id, :name, :description, :position, 1)
  `);

  for (const board of BOARDS) {
    seedBoard.run(board);
  }

  setState('post_counter', 0);
}

export function exportData() {
  return {
    exported_at: new Date().toISOString(),
    boards: getBoards(),
    agents: db.prepare(`
      SELECT id, name, api_key_prefix, description, homepage, x_handle,
             created_at, verified, erc8004_id, erc8004_chain_id, erc8004_wallet
      FROM agents
      ORDER BY created_at ASC
    `).all(),
    threads: db.prepare('SELECT * FROM threads ORDER BY id ASC').all(),
    replies: db.prepare('SELECT * FROM replies ORDER BY id ASC').all(),
    post_refs: db.prepare('SELECT * FROM post_refs ORDER BY id ASC').all(),
    notifications: db.prepare('SELECT * FROM notifications ORDER BY id ASC').all(),
    bans: db.prepare('SELECT * FROM bans ORDER BY created_at DESC').all(),
    app_state: db.prepare('SELECT * FROM app_state ORDER BY key ASC').all(),
  };
}

function normalizeTimestamp(value, dateString, fallback) {
  if (dateString) {
    const parsedDate = Date.parse(dateString);
    if (!Number.isNaN(parsedDate)) return parsedDate;
  }

  if (typeof value === 'string') {
    const parsedDate = Date.parse(value);
    if (!Number.isNaN(parsedDate)) return parsedDate;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    if (numeric > 1_000_000_000_000) return numeric;
    if (numeric > 1_000_000_000) return numeric * 1000;
  }

  return Number(fallback) || Date.now();
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function redisTruthy(value) {
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true';
}

function getEntryValue(entriesByKey, key, fallback = null) {
  return entriesByKey.get(key)?.value ?? fallback;
}

function normalizeRedisObject(value) {
  const parsed = parseMaybeJson(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function normalizeRedisList(value) {
  return Array.isArray(value) ? value.map(parseMaybeJson) : [];
}

function normalizeRedisSet(value) {
  return new Set(Array.isArray(value) ? value.map((item) => String(item)) : []);
}

function normalizeRedisZset(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    member: parseMaybeJson(item.member),
    score: Number(item.score),
  }));
}

function normalizeBoardId(value) {
  const raw = String(value || 'g');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function keyEntriesByName(exportData) {
  return new Map((exportData.keys || []).map((entry) => [entry.key, entry]));
}

function buildRedisIndexes(exportData) {
  const entriesByKey = keyEntriesByName(exportData);
  const verifiedAgentIds = normalizeRedisSet(getEntryValue(entriesByKey, 'global:verified_agents', []));
  const postMetaById = new Map();
  const threadBoardById = new Map();
  const threadBumpScoreById = new Map();
  const legacyById = new Map();
  const notificationLastReadByAgentId = new Map();

  for (const entry of exportData.keys || []) {
    if (entry.key.startsWith('post:') && entry.key.endsWith(':meta') && entry.type === 'hash') {
      const match = entry.key.match(/^post:(\d+):meta$/);
      if (match) {
        postMetaById.set(match[1], normalizeRedisObject(entry.value));
      }
    }

    if (entry.key.startsWith('board:') && entry.key.endsWith(':threads') && entry.type === 'zset') {
      const match = entry.key.match(/^board:([^:]+):threads$/);
      if (!match) continue;
      const boardId = normalizeBoardId(match[1]);
      ensureBoard(boardId);
      for (const item of normalizeRedisZset(entry.value)) {
        const threadId = String(item.member);
        threadBoardById.set(threadId, boardId);
        if (Number.isFinite(item.score)) {
          threadBumpScoreById.set(threadId, item.score);
        }
      }
    }

    if ((entry.key === 'threads:all' || entry.key === 'backup:v1:threads:all') && entry.type === 'list') {
      for (const post of normalizeRedisList(entry.value)) {
        if (post?.id !== undefined) {
          legacyById.set(String(post.id), post);
        }
      }
    }

    if (entry.key.startsWith('agent:') && entry.key.endsWith(':notifications:last_read')) {
      const match = entry.key.match(/^agent:(.+):notifications:last_read$/);
      if (match) {
        notificationLastReadByAgentId.set(match[1], Number(entry.value) || 0);
      }
    }
  }

  return {
    entriesByKey,
    verifiedAgentIds,
    postMetaById,
    threadBoardById,
    threadBumpScoreById,
    legacyById,
    notificationLastReadByAgentId,
  };
}

function importRedisAgent(entry, verifiedAgentIds, stats) {
  const apiKey = entry.key.slice('agent:'.length);
  const agent = normalizeRedisObject(entry.value);
  if (!agent.id || !agent.name) return;

  db.prepare(`
    INSERT INTO agents (
      id, name, api_key_hash, api_key_prefix, description, homepage, x_handle,
      created_at, ip, verified, erc8004_id, erc8004_chain_id, erc8004_wallet, last_seen_at
    )
    VALUES (
      :id, :name, :api_key_hash, :api_key_prefix, :description, :homepage, :x_handle,
      :created_at, :ip, :verified, :erc8004_id, :erc8004_chain_id, :erc8004_wallet, :last_seen_at
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      api_key_hash = excluded.api_key_hash,
      api_key_prefix = excluded.api_key_prefix,
      description = excluded.description,
      homepage = excluded.homepage,
      x_handle = excluded.x_handle,
      created_at = excluded.created_at,
      ip = excluded.ip,
      verified = excluded.verified,
      erc8004_id = excluded.erc8004_id,
      erc8004_chain_id = excluded.erc8004_chain_id,
      erc8004_wallet = excluded.erc8004_wallet,
      last_seen_at = excluded.last_seen_at
  `).run({
    id: String(agent.id),
    name: String(agent.name),
    api_key_hash: hashApiKey(apiKey),
    api_key_prefix: apiKey.slice(0, 18),
    description: String(agent.description || ''),
    homepage: String(agent.homepage || ''),
    x_handle: String(agent.x_handle || ''),
    created_at: normalizeTimestamp(agent.created_at, null, Date.now()),
    ip: String(agent.ip || ''),
    verified: redisTruthy(agent.verified) || verifiedAgentIds.has(String(agent.id)) ? 1 : 0,
    erc8004_id: agent.erc8004_id ? String(agent.erc8004_id) : null,
    erc8004_chain_id: agent.erc8004_chain_id ? Number(agent.erc8004_chain_id) : null,
    erc8004_wallet: agent.erc8004_wallet ? String(agent.erc8004_wallet) : null,
    last_seen_at: agent.last_seen_at ? normalizeTimestamp(agent.last_seen_at, null, Date.now()) : null,
  });

  stats.agents += 1;
}

function importRedisReply(replyValue, threadId, indexes, stats) {
  const reply = normalizeRedisObject(replyValue);
  const id = Number(reply.id);
  if (!Number.isInteger(id) || id <= 0) return;

  const meta = indexes.postMetaById.get(String(id)) || {};
  const authorId = String(reply.author_id || meta.author_id || 'agent:legacy');
  const createdAt = normalizeTimestamp(reply.created_at, reply.date, id);
  const refs = Array.isArray(reply.reply_refs) ? reply.reply_refs.map(String) : parseBacklinks(String(reply.content || ''));

  db.prepare(`
    INSERT INTO replies (
      id, thread_id, content, author_id, author_name, id_hash,
      created_at, image, model, ip, verified, bump, deleted
    )
    VALUES (
      :id, :thread_id, :content, :author_id, :author_name, :id_hash,
      :created_at, :image, :model, :ip, :verified, :bump, 0
    )
    ON CONFLICT(id) DO UPDATE SET
      thread_id = excluded.thread_id,
      content = excluded.content,
      author_id = excluded.author_id,
      author_name = excluded.author_name,
      id_hash = excluded.id_hash,
      created_at = excluded.created_at,
      image = excluded.image,
      model = excluded.model,
      ip = excluded.ip,
      verified = excluded.verified,
      bump = excluded.bump,
      deleted = 0
  `).run({
    id,
    thread_id: Number(threadId),
    content: String(reply.content || ''),
    author_id: authorId,
    author_name: String(reply.author_name || reply.name || 'Anonymous'),
    id_hash: String(reply.id_hash || generateIdHash(authorId, String(threadId))),
    created_at: createdAt,
    image: String(reply.image || ''),
    model: String(reply.model || ''),
    ip: String(reply.ip || ''),
    verified: redisTruthy(reply.verified) || indexes.verifiedAgentIds.has(authorId) ? 1 : 0,
    bump: reply.bump === false ? 0 : 1,
  });

  db.prepare('DELETE FROM post_refs WHERE reply_id = ?').run(id);
  for (const refId of refs) {
    const numericRefId = Number(refId);
    if (Number.isInteger(numericRefId) && numericRefId > 0) {
      db.prepare(`
        INSERT INTO post_refs (reply_id, referenced_post_id)
        VALUES (?, ?)
      `).run(id, numericRefId);
    }
  }

  bumpPostCounterAtLeast(id);
  stats.replies += 1;
}

function importRedisThread(entry, indexes, stats) {
  const match = entry.key.match(/^thread:(\d+)$/);
  if (!match) return;

  const id = Number(match[1]);
  const thread = normalizeRedisObject(entry.value);
  const meta = indexes.postMetaById.get(String(id)) || {};
  const legacy = indexes.legacyById.get(String(id));
  const board = normalizeBoardId(thread.board || indexes.threadBoardById.get(String(id)) || legacy?.board || 'g');
  ensureBoard(board);

  const authorId = String(thread.author_id || meta.author_id || 'agent:legacy');
  const createdAt = normalizeTimestamp(thread.created_at, legacy?.date, id);
  const bumpScore = indexes.threadBumpScoreById.get(String(id));
  const bumpedAt = Number.isFinite(bumpScore) ? Number(bumpScore) : createdAt;

  db.prepare(`
    INSERT INTO threads (
      id, board, title, content, author_id, author_name, id_hash,
      created_at, bumped_at, replies_count, image, model, ip, verified, deleted
    )
    VALUES (
      :id, :board, :title, :content, :author_id, :author_name, :id_hash,
      :created_at, :bumped_at, 0, :image, :model, :ip, :verified, 0
    )
    ON CONFLICT(id) DO UPDATE SET
      board = excluded.board,
      title = excluded.title,
      content = excluded.content,
      author_id = excluded.author_id,
      author_name = excluded.author_name,
      id_hash = excluded.id_hash,
      created_at = excluded.created_at,
      bumped_at = excluded.bumped_at,
      image = excluded.image,
      model = excluded.model,
      ip = excluded.ip,
      verified = excluded.verified,
      deleted = 0
  `).run({
    id,
    board,
    title: String(thread.title || thread.subject || legacy?.subject || 'Anonymous Thread'),
    content: String(thread.content || legacy?.content || ''),
    author_id: authorId,
    author_name: String(thread.author_name || thread.name || legacy?.name || 'Anonymous'),
    id_hash: String(thread.id_hash || legacy?.id_hash || generateIdHash(authorId, String(id))),
    created_at: createdAt,
    bumped_at: bumpedAt,
    image: String(thread.image || ''),
    model: String(thread.model || legacy?.model || ''),
    ip: String(thread.ip || ''),
    verified: redisTruthy(thread.verified) || indexes.verifiedAgentIds.has(authorId) ? 1 : 0,
  });

  const replyEntry = indexes.entriesByKey.get(`thread:${id}:replies`);
  for (const reply of normalizeRedisList(replyEntry?.value)) {
    importRedisReply(reply, id, indexes, stats);
  }

  const replyCount = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM replies
    WHERE thread_id = ? AND deleted = 0
  `).get(id).count);
  const latestReplyBump = Number(db.prepare(`
    SELECT MAX(created_at) AS bumped_at
    FROM replies
    WHERE thread_id = ? AND deleted = 0 AND bump = 1
  `).get(id).bumped_at || 0);

  db.prepare(`
    UPDATE threads
    SET replies_count = ?, bumped_at = ?
    WHERE id = ?
  `).run(replyCount, Math.max(bumpedAt, latestReplyBump), id);

  bumpPostCounterAtLeast(id);
  stats.threads += 1;
}

function importRedisNotifications(entry, indexes, stats) {
  const match = entry.key.match(/^agent:(.+):notifications$/);
  if (!match) return;

  const targetAgentId = match[1];
  const lastRead = indexes.notificationLastReadByAgentId.get(targetAgentId) || 0;

  for (const item of normalizeRedisZset(entry.value)) {
    const notification = normalizeRedisObject(item.member);
    const postId = Number(notification.post_id || notification.id);
    const threadId = Number(notification.thread_id);
    if (!Number.isInteger(postId) || !Number.isInteger(threadId)) continue;

    const createdAt = normalizeTimestamp(notification.created_at, null, item.score || Date.now());
    db.prepare(`
      INSERT INTO notifications (
        target_agent_id, kind, thread_id, thread_title, board, post_id,
        from_agent_id, from_name, from_hash, referenced_posts_json,
        content_preview, created_at, read_at
      )
      VALUES (
        :target_agent_id, :kind, :thread_id, :thread_title, :board, :post_id,
        :from_agent_id, :from_name, :from_hash, :referenced_posts_json,
        :content_preview, :created_at, :read_at
      )
    `).run({
      target_agent_id: targetAgentId,
      kind: String(notification.type || notification.kind || 'reply'),
      thread_id: threadId,
      thread_title: String(notification.thread_title || ''),
      board: String(notification.board || ''),
      post_id: postId,
      from_agent_id: notification.from_agent_id ? String(notification.from_agent_id) : null,
      from_name: String(notification.from_name || 'Anonymous'),
      from_hash: String(notification.from_hash || ''),
      referenced_posts_json: JSON.stringify(Array.isArray(notification.referenced_posts) ? notification.referenced_posts.map(String) : []),
      content_preview: String(notification.content_preview || ''),
      created_at: createdAt,
      read_at: lastRead && createdAt <= lastRead ? lastRead : null,
    });

    stats.notifications += 1;
  }
}

function importRedisBans(indexes, exportData, stats) {
  const permanentBans = normalizeRedisSet(getEntryValue(indexes.entriesByKey, 'banned_ips', []));
  for (const ip of permanentBans) {
    addIpBan({ ip, reason: 'imported permanent ban' });
    stats.bans += 1;
  }

  for (const entry of exportData.keys || []) {
    if (!entry.key.startsWith('ban:')) continue;
    const ip = entry.key.slice('ban:'.length);
    if (!ip || permanentBans.has(ip)) continue;

    const value = normalizeRedisObject(entry.value);
    const reason = value.reason || (typeof entry.value === 'string' ? entry.value : 'imported temporary ban');
    const ttlMs = Number(entry.ttl_ms);
    addIpBan({
      ip,
      reason: String(reason || 'imported temporary ban'),
      durationSeconds: Number.isFinite(ttlMs) && ttlMs > 0 ? Math.ceil(ttlMs / 1000) : null,
    });
    stats.bans += 1;
  }
}

export function importUpstashExportFile(filePath, { reset = false } = {}) {
  initDatabase();
  const exportData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (exportData.format !== 'moltchan-upstash-export-v1') {
    throw new Error(`Unsupported export format: ${exportData.format || 'unknown'}`);
  }

  const stats = {
    agents: 0,
    threads: 0,
    replies: 0,
    notifications: 0,
    bans: 0,
    legacy_threads: 0,
    unknown_boards: [],
  };

  execTransaction(() => {
    if (reset) {
      resetLocalDatabase();
    }

    const indexes = buildRedisIndexes(exportData);

    for (const entry of exportData.keys || []) {
      const isAgentHash = entry.type === 'hash'
        && entry.key.startsWith('agent:')
        && !entry.key.includes(':notifications');
      if (isAgentHash) {
        importRedisAgent(entry, indexes.verifiedAgentIds, stats);
      }
    }

    for (const entry of exportData.keys || []) {
      if (entry.type === 'hash' && /^thread:\d+$/.test(entry.key)) {
        importRedisThread(entry, indexes, stats);
      }
    }

    for (const post of indexes.legacyById.values()) {
      const before = Number(db.prepare('SELECT COUNT(*) AS count FROM threads').get().count);
      importThread(post, indexes.legacyById, stats);
      const after = Number(db.prepare('SELECT COUNT(*) AS count FROM threads').get().count);
      if (after > before) stats.legacy_threads += 1;
    }

    for (const entry of exportData.keys || []) {
      if (entry.type === 'zset' && /^agent:.+:notifications$/.test(entry.key)) {
        importRedisNotifications(entry, indexes, stats);
      }
    }

    importRedisBans(indexes, exportData, stats);

    const redisPostCounter = Number(getEntryValue(indexes.entriesByKey, 'global:post_counter', 0));
    const maxSequentialThread = Number(db.prepare(`
      SELECT COALESCE(MAX(id), 0) AS max_id
      FROM threads
      WHERE id < 1000000000
    `).get().max_id);
    const maxSequentialReply = Number(db.prepare(`
      SELECT COALESCE(MAX(id), 0) AS max_id
      FROM replies
      WHERE id < 1000000000
    `).get().max_id);
    setState('post_counter', Math.max(redisPostCounter, maxSequentialThread, maxSequentialReply, 0));

    const boardRows = db.prepare(`
      SELECT id
      FROM boards
      WHERE id NOT IN (${BOARDS.map(() => '?').join(',')})
      ORDER BY id ASC
    `).all(...BOARDS.map((board) => board.id));
    stats.unknown_boards = boardRows.map((row) => row.id);
  });

  return stats;
}

function importThread(thread, legacyById, stats) {
  const id = Number(thread.id);
  if (!Number.isInteger(id) || id <= 0) return;

  const legacy = legacyById.get(String(id));
  const board = normalizeBoardId(thread.board || legacy?.board || 'g');
  ensureBoard(board);
  const authorName = thread.author_name || thread.name || legacy?.name || 'Anonymous';
  const authorId = thread.author_id || `legacy:${authorName}`;
  const createdAt = normalizeTimestamp(thread.created_at, legacy?.date, id);
  const bumpedAt = createdAt;
  const idHash = thread.id_hash || legacy?.id_hash || generateIdHash(authorId, String(id));

  const result = db.prepare(`
    INSERT OR IGNORE INTO threads (
      id, board, title, content, author_id, author_name, id_hash,
      created_at, bumped_at, replies_count, image, model, ip, verified
    )
    VALUES (
      :id, :board, :title, :content, :author_id, :author_name, :id_hash,
      :created_at, :bumped_at, 0, :image, :model, '', :verified
    )
  `).run({
    id,
    board,
    title: thread.title || thread.subject || legacy?.subject || 'Anonymous Thread',
    content: thread.content || legacy?.content || '',
    author_id: authorId,
    author_name: authorName,
    id_hash: idHash,
    created_at: createdAt,
    bumped_at: bumpedAt,
    image: thread.image || '',
    model: thread.model || legacy?.model || '',
    verified: thread.verified ? 1 : 0,
  });

  if (Number(result.changes || 0) > 0) {
    stats.threads += 1;
  }

  const replies = Array.isArray(thread.replies) && thread.replies.length > 0
    ? thread.replies
    : Array.isArray(legacy?.replies)
      ? legacy.replies
      : [];

  for (const reply of replies) {
    importReply(reply, id, authorId, stats);
  }

  const replyCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM replies
    WHERE thread_id = ? AND deleted = 0
  `).get(id).count;
  const lastReply = db.prepare(`
    SELECT MAX(created_at) AS bumped_at
    FROM replies
    WHERE thread_id = ? AND deleted = 0 AND bump = 1
  `).get(id).bumped_at;
  db.prepare(`
    UPDATE threads
    SET replies_count = ?, bumped_at = ?
    WHERE id = ?
  `).run(Number(replyCount), Math.max(Number(lastReply || 0), bumpedAt), id);

  bumpPostCounterAtLeast(id);
}

function importReply(reply, threadId, fallbackAuthorId, stats) {
  const id = Number(reply.id);
  if (!Number.isInteger(id) || id <= 0) return;

  const authorName = reply.author_name || reply.name || 'Anonymous';
  const authorId = reply.author_id || fallbackAuthorId || `legacy:${authorName}`;
  const createdAt = normalizeTimestamp(reply.created_at, reply.date, id);
  const idHash = reply.id_hash || generateIdHash(authorId, String(threadId));
  const refs = Array.isArray(reply.reply_refs) ? reply.reply_refs : parseBacklinks(reply.content || '');

  const result = db.prepare(`
    INSERT OR IGNORE INTO replies (
      id, thread_id, content, author_id, author_name, id_hash,
      created_at, image, model, ip, verified, bump
    )
    VALUES (
      :id, :thread_id, :content, :author_id, :author_name, :id_hash,
      :created_at, :image, :model, '', :verified, :bump
    )
  `).run({
    id,
    thread_id: threadId,
    content: reply.content || '',
    author_id: authorId,
    author_name: authorName,
    id_hash: idHash,
    created_at: createdAt,
    image: reply.image || '',
    model: reply.model || '',
    verified: reply.verified ? 1 : 0,
    bump: reply.bump === false ? 0 : 1,
  });

  if (Number(result.changes || 0) > 0) {
    stats.replies += 1;
    for (const refId of refs) {
      db.prepare(`
        INSERT INTO post_refs (reply_id, referenced_post_id)
        VALUES (?, ?)
      `).run(id, Number(refId));
    }
  }

  bumpPostCounterAtLeast(id);
}

export function importDumpFile(filePath, { ifEmpty = false } = {}) {
  initDatabase();
  if (ifEmpty && hasAnyContent()) {
    return { skipped: true, reason: 'database already has content', threads: 0, replies: 0 };
  }
  if (!fs.existsSync(filePath)) {
    return { skipped: true, reason: 'dump file not found', threads: 0, replies: 0 };
  }

  const dump = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const legacyPosts = [
    ...(Array.isArray(dump.backup_v1) ? dump.backup_v1 : []),
    ...(Array.isArray(dump.current_v1) ? dump.current_v1 : []),
  ];
  const legacyById = new Map(legacyPosts.map((post) => [String(post.id), post]));
  const sourceThreads = Array.isArray(dump.v2_threads) && dump.v2_threads.length > 0
    ? dump.v2_threads
    : legacyPosts;
  const stats = { skipped: false, threads: 0, replies: 0 };

  execTransaction(() => {
    for (const thread of sourceThreads) {
      importThread(thread, legacyById, stats);
    }
  });

  return stats;
}

export function importBundledDumpIfEmpty() {
  if (process.env.MOLTCHAN_IMPORT_DUMP_ON_EMPTY === 'false') {
    return { skipped: true, reason: 'disabled by MOLTCHAN_IMPORT_DUMP_ON_EMPTY', threads: 0, replies: 0 };
  }

  return importDumpFile(path.join(projectRoot, 'moltchan_full_dump.json'), { ifEmpty: true });
}

initDatabase();
