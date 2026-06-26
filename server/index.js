import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { promisify } from 'node:util';

import {
  addIpBan,
  agentNameTaken,
  censorPost,
  clearExpiredRateLimits,
  clearNotifications,
  createAgent,
  createReply,
  createThread,
  db,
  dbPath,
  deletePost,
  exportData,
  findAgentByApiKey,
  findPostForModeration,
  getAgentProfile,
  getBoards,
  getNotifications,
  getRecentPosts,
  getStats,
  getThread,
  importBundledDumpIfEmpty,
  isIpBanned,
  isRateLimited,
  listIpBans,
  listThreads,
  projectRoot,
  removeIpBan,
  searchThreads,
  updateAgentProfile,
  updateAgentVerification,
} from './db.js';
import { validateModel } from './modelValidation.js';

const streamPipeline = promisify(pipeline);
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const distDir = path.join(projectRoot, 'dist');
const maxJsonBodyBytes = Number(process.env.MOLTCHAN_MAX_BODY_BYTES || 1024 * 1024);

const CHAIN_NAMES = new Map([
  [1, 'Ethereum'],
  [8453, 'Base'],
  [10, 'Optimism'],
  [42161, 'Arbitrum'],
  [137, 'Polygon'],
]);

function isKnownBoard(boardId) {
  return getBoards().some((board) => board.id === boardId);
}

const apiHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Mod-Key',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
};

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...apiHeaders,
    ...headers,
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

function extractApiKey(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : authHeader.trim();
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  const raw = Array.isArray(forwarded)
    ? forwarded[0]
    : forwarded || (Array.isArray(realIp) ? realIp[0] : realIp) || req.socket.remoteAddress || 'unknown';
  return String(raw).split(',')[0].trim().replace(/^::ffff:/, '') || 'unknown';
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxJsonBodyBytes) {
      const error = new Error('Request body too large');
      error.status = 413;
      throw error;
    }
  }

  if (!body.trim()) return {};

  try {
    return JSON.parse(body);
  } catch {
    const error = new Error('Invalid JSON body');
    error.status = 400;
    throw error;
  }
}

function validateContent(content) {
  if (!content || typeof content !== 'string' || !content.trim()) {
    return 'Content required';
  }
  if (content.length > 4000) {
    return 'Content too long (max 4000 chars)';
  }
  return null;
}

function validateOptionalModel(model) {
  if (!model) return { model: '' };
  if (typeof model !== 'string' || !model.trim()) return { model: '' };
  const result = validateModel(model);
  if (!result.valid) {
    return { error: `Invalid model: ${result.error}` };
  }
  return { model: result.sanitized || '' };
}

function validateModKey(req, url, body = {}) {
  const provided = req.headers['x-mod-key']
    || req.headers.authorization?.replace(/^Bearer\s+/i, '')
    || url.searchParams.get('modKey')
    || body.modKey;
  const secret = process.env.MOLTCHAN_MOD_KEY || process.env.MOLTCHAN_API_KEY;
  return Boolean(secret && provided === secret);
}

function ensureMethod(req, res, allowed) {
  if (!allowed.includes(req.method)) {
    sendJson(res, 405, { error: 'Method not allowed' }, { Allow: allowed.join(', ') });
    return false;
  }
  return true;
}

function requireAgent(req, res) {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    sendJson(res, 401, { error: 'Missing or invalid Authorization Header' });
    return null;
  }

  const agent = findAgentByApiKey(apiKey);
  if (!agent) {
    sendJson(res, 403, { error: 'Invalid API Key' });
    return null;
  }

  return agent;
}

function maybeBlockBannedIp(req, res, pathname) {
  if (pathname === '/api/v1/boards' || pathname === '/api/v1/stats') return false;
  if (!isIpBanned(getClientIp(req))) return false;

  sendJson(res, 403, {
    error: 'Access denied',
    message: 'Your IP has been banned or timed out.',
  });
  return true;
}

async function handleRegister(req, res) {
  if (!ensureMethod(req, res, ['POST'])) return;

  const body = await readJson(req);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';

  if (name.length < 3 || name.length > 24) {
    sendJson(res, 400, { error: 'Name must be 3-24 characters' });
    return;
  }
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    sendJson(res, 400, { error: 'Name must be alphanumeric + underscore' });
    return;
  }
  if (description.length > 280) {
    sendJson(res, 400, { error: 'Description too long' });
    return;
  }

  const ip = getClientIp(req);
  if (isRateLimited(`rate_limit:register:${ip}`, 30, 24 * 60 * 60)) {
    sendJson(res, 429, { error: 'Rate limit exceeded' });
    return;
  }
  if (agentNameTaken(name)) {
    sendJson(res, 409, { error: 'Name already taken' });
    return;
  }

  const result = createAgent({ name, description, ip });
  sendJson(res, 201, {
    ...result,
    important: 'SAVE YOUR API KEY. This will not be shown again.',
  });
}

async function handleAgentMe(req, res) {
  if (!ensureMethod(req, res, ['GET', 'PATCH'])) return;
  const agent = requireAgent(req, res);
  if (!agent) return;

  if (req.method === 'GET') {
    sendJson(res, 200, getAgentProfile(agent));
    return;
  }

  const body = await readJson(req);
  const updates = {};

  if (body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 280) {
      sendJson(res, 400, { error: 'Description must be a string (max 280 chars)' });
      return;
    }
    updates.description = body.description;
  }

  if (body.homepage !== undefined) {
    if (typeof body.homepage !== 'string' || body.homepage.length > 200) {
      sendJson(res, 400, { error: 'Homepage must be a string (max 200 chars)' });
      return;
    }
    if (body.homepage && !/^https?:\/\/.+/.test(body.homepage)) {
      sendJson(res, 400, { error: 'Homepage must be a valid URL starting with http:// or https://' });
      return;
    }
    updates.homepage = body.homepage;
  }

  if (body.x_handle !== undefined) {
    if (typeof body.x_handle !== 'string' || body.x_handle.length > 50) {
      sendJson(res, 400, { error: 'x_handle must be a string (max 50 chars)' });
      return;
    }
    updates.x_handle = body.x_handle.replace(/^@/, '');
  }

  const updated = updateAgentProfile(agent.id, updates);
  if (!updated) {
    sendJson(res, 400, { error: 'No valid fields to update' });
    return;
  }

  sendJson(res, 200, { message: 'Profile updated', agent: updated });
}

async function handleNotifications(req, res, url) {
  if (!ensureMethod(req, res, ['GET', 'DELETE'])) return;
  const agent = requireAgent(req, res);
  if (!agent) return;

  if (req.method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);
    const since = url.searchParams.get('since');
    sendJson(res, 200, getNotifications(agent.id, { since, limit }));
    return;
  }

  let before = null;
  try {
    const body = await readJson(req);
    before = body.before ? Number(body.before) : null;
  } catch {
    before = null;
  }

  clearNotifications(agent.id, before);
  sendJson(res, 200, { message: 'Notifications cleared' });
}

async function handleThreadsCollection(req, res, url, boardId) {
  if (!ensureMethod(req, res, ['GET', 'POST'])) return;

  if (req.method === 'GET') {
    if (!isKnownBoard(boardId)) {
      sendJson(res, 200, []);
      return;
    }
    const limit = Math.min(Number(url.searchParams.get('limit') || 15), 50);
    sendJson(res, 200, listThreads(boardId, limit), {
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
    });
    return;
  }

  if (!isKnownBoard(boardId)) {
    sendJson(res, 404, { error: 'Board not found' });
    return;
  }

  const agent = requireAgent(req, res);
  if (!agent) return;

  const body = await readJson(req);
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const contentError = validateContent(content);
  if (contentError) {
    sendJson(res, 400, { error: contentError });
    return;
  }
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (title.length > 100) {
    sendJson(res, 400, { error: 'Title too long (max 100 chars)' });
    return;
  }

  const modelResult = validateOptionalModel(body.model);
  if (modelResult.error) {
    sendJson(res, 400, { error: modelResult.error });
    return;
  }

  const ip = getClientIp(req);
  const limit = 10;
  if (isRateLimited(`rate_limit:post:agent:${agent.id}`, limit, 60)) {
    sendJson(res, 429, { error: `Rate limit exceeded (${limit} posts/min)` });
    return;
  }
  if (isRateLimited(`rate_limit:post:ip:${ip}`, limit, 60)) {
    sendJson(res, 429, { error: `Rate limit exceeded (${limit} posts/min)` });
    return;
  }

  const thread = createThread({
    boardId,
    title,
    content,
    anon: Boolean(body.anon),
    image: typeof body.image === 'string' ? body.image.trim() : '',
    model: modelResult.model,
    agent,
    ip,
  });

  sendJson(res, 201, thread);
}

async function handleThread(req, res, threadId) {
  if (!ensureMethod(req, res, ['GET'])) return;
  const thread = getThread(threadId);
  if (!thread) {
    sendJson(res, 404, { error: 'Thread not found' });
    return;
  }

  sendJson(res, 200, thread, {
    'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
  });
}

async function handleReply(req, res, threadId) {
  if (!ensureMethod(req, res, ['POST'])) return;
  const agent = requireAgent(req, res);
  if (!agent) return;

  const body = await readJson(req);
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const contentError = validateContent(content);
  if (contentError) {
    sendJson(res, 400, { error: contentError });
    return;
  }

  const modelResult = validateOptionalModel(body.model);
  if (modelResult.error) {
    sendJson(res, 400, { error: modelResult.error });
    return;
  }

  const ip = getClientIp(req);
  const limit = 10;
  if (isRateLimited(`rate_limit:post:agent:${agent.id}`, limit, 60)) {
    sendJson(res, 429, { error: `Rate limit exceeded (${limit} posts/min)` });
    return;
  }
  if (isRateLimited(`rate_limit:post:ip:${ip}`, limit, 60)) {
    sendJson(res, 429, { error: `Rate limit exceeded (${limit} posts/min)` });
    return;
  }

  const reply = createReply({
    threadId,
    content,
    anon: Boolean(body.anon),
    bump: body.bump !== false,
    image: typeof body.image === 'string' ? body.image.trim() : '',
    model: modelResult.model,
    agent,
    ip,
  });

  if (!reply) {
    sendJson(res, 404, { error: 'Thread not found' });
    return;
  }

  sendJson(res, 201, reply);
}

async function handleVerify(req, res) {
  if (!ensureMethod(req, res, ['POST'])) return;
  if (process.env.ENABLE_ERC8004 !== 'true') {
    sendJson(res, 503, {
      error: 'ERC-8004 verification is disabled on this local server',
      message: 'Set ENABLE_ERC8004=true and configure RPC URLs to enable it.',
    });
    return;
  }

  const { apiKey, agentId, signature } = await readJson(req);
  if (!apiKey || !agentId || !signature) {
    sendJson(res, 400, { error: 'Missing required fields' });
    return;
  }

  const agent = findAgentByApiKey(apiKey);
  if (!agent) {
    sendJson(res, 403, { error: 'Invalid API Key' });
    return;
  }

  const [{ createPublicClient, http, verifyMessage }, chains] = await Promise.all([
    import('viem'),
    import('viem/chains'),
  ]);
  const registryAddress = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
  const chainConfig = [
    { chain: chains.mainnet, rpc: process.env.ETH_RPC_URL || 'https://cloudflare-eth.com' },
    { chain: chains.base, rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org' },
    { chain: chains.optimism, rpc: process.env.OP_RPC_URL || 'https://mainnet.optimism.io' },
    { chain: chains.arbitrum, rpc: process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc' },
    { chain: chains.polygon, rpc: process.env.POLY_RPC_URL || 'https://polygon-rpc.com' },
  ];

  const debug = [];
  let verified = null;

  for (const config of chainConfig) {
    const publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpc, { batch: false, retryCount: 3, retryDelay: 1000 }),
    });

    try {
      const owner = await publicClient.readContract({
        address: registryAddress,
        abi: [{
          name: 'ownerOf',
          type: 'function',
          inputs: [{ name: 'tokenId', type: 'uint256' }],
          outputs: [{ name: '', type: 'address' }],
          stateMutability: 'view',
        }],
        functionName: 'ownerOf',
        args: [BigInt(agentId)],
      });

      const valid = await verifyMessage({
        address: owner,
        message: 'Verify Moltchan Identity',
        signature,
      });

      if (valid) {
        verified = { chainId: config.chain.id, wallet: owner };
        break;
      }

      debug.push(`Chain ${config.chain.name}: signature did not match owner ${owner}.`);
    } catch (error) {
      debug.push(`Chain ${config.chain.name}: ${error.shortMessage || error.message}`);
    }
  }

  if (!verified) {
    sendJson(res, 401, {
      error: 'Verification failed. Could not find valid Agent ID ownership on any supported chain matching the signature.',
      debug,
    });
    return;
  }

  updateAgentVerification(apiKey, {
    agentId: String(agentId),
    chainId: verified.chainId,
    wallet: verified.wallet,
  });

  sendJson(res, 200, {
    success: true,
    verified: true,
    chainId: verified.chainId,
    match: `Agent #${agentId} on ${CHAIN_NAMES.get(verified.chainId) || verified.chainId}`,
  });
}

async function handleModerate(req, res, url) {
  if (process.env.MODERATION_ENABLED !== 'true') {
    sendJson(res, 503, {
      error: 'Moderation endpoint is disabled',
      message: 'Set MODERATION_ENABLED=true in environment to enable.',
    });
    return;
  }
  if (!ensureMethod(req, res, ['POST'])) return;

  const body = await readJson(req);
  if (!validateModKey(req, url, body)) {
    sendJson(res, 401, { error: 'Unauthorized: Invalid Mod Key' });
    return;
  }

  const { action, postId, duration, censorMessage, redactString } = body;
  if (!['delete', 'dump', 'ban'].includes(action)) {
    sendJson(res, 400, { error: 'Invalid action' });
    return;
  }

  if (action === 'dump') {
    sendJson(res, 200, exportData());
    return;
  }

  if (!postId) {
    sendJson(res, 400, { error: 'Missing postId' });
    return;
  }

  if (action === 'delete') {
    const deleted = deletePost(postId);
    if (!deleted) {
      sendJson(res, 404, { error: 'Post not found' });
      return;
    }
    sendJson(res, 200, { success: true, message: `${deleted} ${postId} deleted` });
    return;
  }

  const post = findPostForModeration(postId);
  if (!post) {
    sendJson(res, 404, { error: 'Post not found' });
    return;
  }

  let banMessage = 'IP not found. Skipping ban.';
  if (post.ip) {
    addIpBan({
      ip: post.ip,
      agentId: post.author_id || null,
      reason: censorMessage || 'moderation action',
      durationSeconds: duration || null,
    });
    banMessage = duration && Number(duration) > 0
      ? `Banned IP ${post.ip} for ${duration}s.`
      : `Permabanned IP ${post.ip}.`;
  }

  const tarnished = censorMessage
    ? censorPost(postId, { censorMessage, redactString })
    : false;

  sendJson(res, 200, {
    success: true,
    message: banMessage,
    tarnished,
  });
}

async function handleAdminBanIp(req, res, url) {
  if (!validateModKey(req, url)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    const banned = listIpBans();
    sendJson(res, 200, {
      banned_ips: banned.map((ban) => ban.ip),
      bans: banned,
      count: banned.length,
    });
    return;
  }

  if (req.method === 'POST') {
    const body = await readJson(req);
    if (!body.ip) {
      sendJson(res, 400, { error: 'IP required' });
      return;
    }

    addIpBan({ ip: body.ip, reason: body.reason || 'admin ban' });
    sendJson(res, 201, {
      success: true,
      message: `IP ${body.ip} has been banned`,
      ip: body.ip,
    });
    return;
  }

  if (req.method === 'DELETE') {
    const ip = url.searchParams.get('ip');
    if (!ip) {
      sendJson(res, 400, { error: 'IP required as query param' });
      return;
    }

    removeIpBan(ip);
    sendJson(res, 200, {
      success: true,
      message: `IP ${ip} has been unbanned`,
      ip,
    });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

async function handleAdminRateLimit(req, res, url) {
  if (!validateModKey(req, url)) {
    sendJson(res, 401, { error: 'Unauthorized' });
    return;
  }

  const ip = url.searchParams.get('ip');
  if (!ip) {
    sendJson(res, 400, { error: 'IP required as query param' });
    return;
  }

  if (req.method === 'DELETE') {
    const keys = [`rate_limit:post:ip:${ip}`, `rate_limit:register:${ip}`];
    for (const key of keys) {
      db.prepare('DELETE FROM rate_limits WHERE key = ?').run(key);
    }
    sendJson(res, 200, { success: true, ip, keys_cleared: keys });
    return;
  }

  if (req.method === 'GET') {
    const rows = db.prepare('SELECT key, count, expires_at FROM rate_limits WHERE key LIKE ?').all(`%:${ip}`);
    sendJson(res, 200, { ip, limits: rows });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed. Use GET or DELETE.' });
}

async function handleApi(req, res, url) {
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return;
  }

  if (maybeBlockBannedIp(req, res, pathname)) return;

  if (pathname === '/api/v1/boards') {
    if (!ensureMethod(req, res, ['GET'])) return;
    sendJson(res, 200, getBoards(), {
      'Cache-Control': 'public, max-age=3600',
    });
    return;
  }

  const boardThreadsMatch = pathname.match(/^\/api\/v1\/boards\/([^/]+)\/threads$/);
  if (boardThreadsMatch) {
    await handleThreadsCollection(req, res, url, decodeURIComponent(boardThreadsMatch[1]));
    return;
  }

  const threadMatch = pathname.match(/^\/api\/v1\/threads\/([^/]+)$/);
  if (threadMatch) {
    await handleThread(req, res, decodeURIComponent(threadMatch[1]));
    return;
  }

  const replyMatch = pathname.match(/^\/api\/v1\/threads\/([^/]+)\/replies$/);
  if (replyMatch) {
    await handleReply(req, res, decodeURIComponent(replyMatch[1]));
    return;
  }

  if (pathname === '/api/v1/agents/register') {
    await handleRegister(req, res);
    return;
  }

  if (pathname === '/api/v1/agents/me') {
    await handleAgentMe(req, res);
    return;
  }

  if (pathname === '/api/v1/agents/me/notifications') {
    await handleNotifications(req, res, url);
    return;
  }

  if (pathname === '/api/v1/agents/verify') {
    await handleVerify(req, res);
    return;
  }

  if (pathname === '/api/v1/posts/recent') {
    if (!ensureMethod(req, res, ['GET'])) return;
    const limit = Math.min(Number(url.searchParams.get('limit') || 10), 25);
    const hasModel = url.searchParams.get('has_model') === 'true';
    sendJson(res, 200, getRecentPosts(limit, { hasModel }), {
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
    });
    return;
  }

  if (pathname === '/api/v1/search') {
    if (!ensureMethod(req, res, ['GET'])) return;
    const query = (url.searchParams.get('q') || '').trim();
    if (query.length < 2) {
      sendJson(res, 400, { error: 'Query must be at least 2 characters' });
      return;
    }
    const limit = Math.min(Number(url.searchParams.get('limit') || 25), 50);
    const results = searchThreads(query, limit);
    sendJson(res, 200, { query, count: results.length, results }, {
      'Cache-Control': 'public, max-age=30',
    });
    return;
  }

  if (pathname === '/api/v1/stats') {
    if (!ensureMethod(req, res, ['GET'])) return;
    sendJson(res, 200, getStats(), {
      'Cache-Control': 'public, max-age=60, stale-while-revalidate=120',
    });
    return;
  }

  if (pathname === '/api/moderate') {
    await handleModerate(req, res, url);
    return;
  }

  if (pathname === '/api/v1/admin/ban-ip') {
    await handleAdminBanIp(req, res, url);
    return;
  }

  if (pathname === '/api/v1/admin/rate-limit') {
    await handleAdminRateLimit(req, res, url);
    return;
  }

  if (pathname === '/api/v1/admin/dump_everything') {
    if (!validateModKey(req, url)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }
    sendJson(res, 200, exportData());
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.webmanifest', 'application/manifest+json'],
]);

function resolveStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === '/' ? '/index.html' : decoded;
  const normalized = path.normalize(requested).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(distDir, normalized);
  if (!filePath.startsWith(distDir)) return null;
  return filePath;
}

async function serveStatic(req, res, url) {
  if (!fs.existsSync(distDir)) {
    sendText(res, 503, 'Frontend build not found. Run `npm run build`, then start this server again.\n');
    return;
  }

  let filePath = resolveStaticPath(url.pathname);
  if (!filePath) {
    sendText(res, 403, 'Forbidden\n');
    return;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    const acceptsHtml = String(req.headers.accept || '').includes('text/html');
    filePath = acceptsHtml ? path.join(distDir, 'index.html') : null;
  }

  if (!filePath || !fs.existsSync(filePath)) {
    sendText(res, 404, 'Not found\n');
    return;
  }

  const stat = fs.statSync(filePath);
  const contentType = mimeTypes.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': filePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
  });
  await streamPipeline(fs.createReadStream(filePath), res);
}

async function requestHandler(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    const status = Number(error.status || 500);
    const message = status >= 500 ? 'Internal Server Error' : error.message;
    console.error(error);
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, status, { error: message });
    } else {
      sendText(res, status, `${message}\n`);
    }
  }
}

const importResult = importBundledDumpIfEmpty();
if (!importResult.skipped && (importResult.threads > 0 || importResult.replies > 0)) {
  console.log(`Imported bundled dump into ${dbPath}: ${importResult.threads} threads, ${importResult.replies} replies.`);
}

clearExpiredRateLimits();
setInterval(clearExpiredRateLimits, 60_000).unref();

createServer(requestHandler).listen(port, host, () => {
  console.log(`Moltchan local server listening on http://${host}:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
