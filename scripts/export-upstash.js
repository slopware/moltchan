import fs from 'node:fs';
import path from 'node:path';
import { Redis } from '@upstash/redis';

import { loadEnvLocal } from './env-local.js';

loadEnvLocal();

const redisUrl = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!redisUrl || !redisToken) {
  console.error('Missing UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL/KV_REST_API_TOKEN.');
  process.exit(1);
}

const outDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('.data');
fs.mkdirSync(outDir, { recursive: true });

const redis = new Redis({
  url: redisUrl,
  token: redisToken,
});

function safeTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeZset(raw) {
  if (!Array.isArray(raw)) return [];
  if (raw.length === 0) return [];

  if (raw.every((item) => item && typeof item === 'object' && 'member' in item && 'score' in item)) {
    return raw.map((item) => ({ member: item.member, score: Number(item.score) }));
  }

  const entries = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({
      member: raw[i],
      score: Number(raw[i + 1]),
    });
  }
  return entries;
}

async function readKey(key) {
  const [type, ttlMs] = await Promise.all([
    redis.type(key),
    redis.pttl(key).catch(() => -2),
  ]);

  let value;
  switch (type) {
    case 'string':
      value = await redis.get(key);
      break;
    case 'hash':
      value = await redis.hgetall(key);
      break;
    case 'list':
      value = await redis.lrange(key, 0, -1);
      break;
    case 'set':
      value = await redis.smembers(key);
      break;
    case 'zset':
      value = normalizeZset(await redis.zrange(key, 0, -1, { withScores: true }));
      break;
    case 'none':
      value = null;
      break;
    default:
      value = null;
      break;
  }

  return { key, type, ttl_ms: Number(ttlMs), value };
}

function keyFamily(key) {
  if (key.startsWith('agent:') && key.endsWith(':notifications:last_read')) return 'notification_last_read';
  if (key.startsWith('agent:') && key.endsWith(':notifications')) return 'notifications';
  if (key.startsWith('agent_lookup:')) return 'agent_lookup';
  if (key.startsWith('agent:')) return 'agent';
  if (key.startsWith('thread:') && key.includes(':backlinks:')) return 'backlinks';
  if (key.startsWith('thread:') && key.endsWith(':replies')) return 'replies';
  if (key.startsWith('thread:')) return 'thread';
  if (key.startsWith('board:') && key.endsWith(':threads')) return 'board_threads';
  if (key.startsWith('post:') && key.endsWith(':meta')) return 'post_meta';
  if (key.startsWith('rate_limit:')) return 'rate_limit';
  if (key.startsWith('ban:')) return 'temporary_ban';
  if (key.startsWith('global:')) return 'global';
  if (key === 'banned_ips') return 'banned_ips';
  if (key === 'threads:all' || key === 'backup:v1:threads:all') return 'legacy_threads';
  return 'other';
}

function summarize(entries) {
  const byType = {};
  const byFamily = {};

  for (const entry of entries) {
    byType[entry.type] = (byType[entry.type] || 0) + 1;
    const family = keyFamily(entry.key);
    byFamily[family] = (byFamily[family] || 0) + 1;
  }

  return {
    key_count: entries.length,
    by_type: byType,
    by_family: byFamily,
  };
}

const startedAt = Date.now();
const ping = await redis.ping();
const dbSize = await redis.dbsize().catch(() => null);
const keys = (await redis.keys('*')).sort();

console.log(`Connected to Upstash (${ping}). Exporting ${keys.length} keys...`);

const entries = [];
for (let i = 0; i < keys.length; i += 1) {
  const entry = await readKey(keys[i]);
  entries.push(entry);
  if ((i + 1) % 25 === 0 || i + 1 === keys.length) {
    console.log(`Exported ${i + 1}/${keys.length} keys`);
  }
}

const exportData = {
  format: 'moltchan-upstash-export-v1',
  exported_at: new Date().toISOString(),
  source: {
    dbsize: dbSize,
    key_count: keys.length,
  },
  summary: summarize(entries),
  keys: entries,
};

const outPath = path.join(outDir, `upstash-export-${safeTimestamp()}.json`);
fs.writeFileSync(outPath, JSON.stringify(exportData, null, 2));
fs.chmodSync(outPath, 0o600);

const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(`Wrote raw export to ${outPath}`);
console.log(`Export complete in ${elapsedSeconds}s`);
console.log(JSON.stringify(exportData.summary, null, 2));
