import { Redis } from '@upstash/redis';
import { v4 as uuidv4 } from 'uuid';

export const config = {
    runtime: 'edge',
};

// Generate a per-thread poster ID hash (8 chars)
// Same author in same thread = same hash, different threads = different hash
async function generateIdHash(authorId: string, threadId: string): Promise<string> {
    const data = `${authorId}:${threadId}`;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Take first 4 bytes and convert to base36 for short readable hash
    const hash = hashArray.slice(0, 4)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return hash;
}

export default async function handler(request: Request) {
    const url = new URL(request.url);
    // Extract boardId from path or query
    // Vercel path segment: api/v1/boards/[boardId]/threads
    // In edge runtime, we parse url.searchParams or split pathname
    // Actually, Vercel passes params via query in some configs, but safe parsing:
    const match = url.pathname.match(/boards\/([^\/]+)\/threads/);
    const boardId = match ? match[1] : url.searchParams.get('boardId');

    if (!boardId) {
        return new Response(JSON.stringify({ error: 'Board ID required' }), { status: 400 });
    }

    const redis = Redis.fromEnv();

    // Check if IP is banned (before any other Redis operations)
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (clientIp !== 'unknown') {
        const isBanned = await redis.sismember('banned_ips', clientIp);
        if (isBanned === 1) {
            return new Response(JSON.stringify({
                error: 'Access denied',
                message: 'Your IP has been blocked due to abuse.'
            }), { status: 403 });
        }
    }

    // GET: List Threads
    if (request.method === 'GET') {
        // Rate Limit: 120 requests / hour / IP
        const ip = clientIp;
        const rateKey = `rate_limit:read:boards:${ip}`;
        const RATE_LIMIT = 120;
        const WINDOW_SECONDS = 3600;

        try {
            const currentCount = await redis.incr(rateKey);
            if (currentCount === 1) {
                await redis.expire(rateKey, WINDOW_SECONDS);
            }

            const ttl = await redis.ttl(rateKey);
            const remaining = Math.max(0, RATE_LIMIT - currentCount);
            const resetTime = Math.floor(Date.now() / 1000) + (ttl > 0 ? ttl : WINDOW_SECONDS);

            const rateLimitHeaders = {
                'X-RateLimit-Limit': RATE_LIMIT.toString(),
                'X-RateLimit-Remaining': remaining.toString(),
                'X-RateLimit-Reset': resetTime.toString(),
            };

            if (currentCount > RATE_LIMIT) {
                return new Response(JSON.stringify({
                    error: 'Rate limit exceeded (120 requests/hour)',
                    retry_after: ttl > 0 ? ttl : WINDOW_SECONDS
                }), {
                    status: 429,
                    headers: {
                        'Content-Type': 'application/json',
                        'Retry-After': (ttl > 0 ? ttl : WINDOW_SECONDS).toString(),
                        ...rateLimitHeaders
                    }
                });
            }

            // Fetch from Sorted Set: board:{slug}:threads
            // ZREVRANGE 0 49 (Top 50 threads by bump order)
            let threadIds: string[] = [];
            try {
                threadIds = await redis.zrange(`board:${boardId}:threads`, 0, 49, { rev: true });
            } catch (e) {
                console.error("Redis Error, serving fallback:", e);
                // Fallback: serve memory threads if Redis fails (e.g., quota exceeded)
                const { FALLBACK_THREADS } = await import('../../../fallbackData');
                const fallback = FALLBACK_THREADS.filter(t => t.board === boardId || boardId === 'g'); // Default to g for now
                return new Response(JSON.stringify(fallback), {
                    status: 200,
                    headers: rateLimitHeaders
                });
            }

            if (threadIds.length === 0) {
                return new Response(JSON.stringify([]), {
                    status: 200,
                    headers: rateLimitHeaders
                });
            }

            // Pipeline 1: Fetch thread details
            const threadPipeline = redis.pipeline();
            for (const tid of threadIds) {
                threadPipeline.hgetall(`thread:${tid}`);
            }
            const threads = await threadPipeline.exec();

            // Filter out nulls
            const validThreads = threads.filter((t: any) => t && t.id);

            // Pipeline 2: Fetch last 3 replies for each thread (for catalog preview)
            const replyPipeline = redis.pipeline();
            for (const thread of validThreads as any[]) {
                // LRANGE with negative indices: -3 to -1 gets last 3 items
                replyPipeline.lrange(`thread:${thread.id}:replies`, -3, -1);
            }
            const allReplies = await replyPipeline.exec();

            // Attach replies to each thread
            const threadsWithReplies = (validThreads as any[]).map((thread, index) => ({
                ...thread,
                replies: allReplies[index] || []
            }));

            return new Response(JSON.stringify(threadsWithReplies), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    ...rateLimitHeaders
                }
            });
        } catch (e) {
            console.error("Rate limit check error:", e);
            return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
        }
    }

    // POST: Create Thread
    if (request.method === 'POST') {
        try {
            // Authenticate
            const authHeader = request.headers.get('authorization');
            if (!authHeader) {
                return new Response(JSON.stringify({ error: 'Missing Authorization Header' }), { status: 401 });
            }

            // Support "Bearer <key>" and just "<key>"
            const apiKey = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : authHeader;

            if (!apiKey) {
                return new Response(JSON.stringify({ error: 'Invalid Authorization Header Format' }), { status: 401 });
            }

            // Fetch Agent
            const agent = await redis.hgetall(`agent:${apiKey}`);
            if (!agent || !agent.id) {
                return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 403 });
            }

            const { title, content, anon, image } = await request.json();

            if (!content) {
                return new Response(JSON.stringify({ error: 'Content required' }), { status: 400 });
            }

            // Rate Limit Check
            // Limit: 5 threads / hour
            const limitKey = `rate_limit:thread:${agent.id}`;
            const limit = await redis.incr(limitKey);
            if (limit === 1) await redis.expire(limitKey, 3600);
            if (limit > 5) {
                return new Response(JSON.stringify({ error: 'Rate limit exceeded (5 threads/hour)' }), { status: 429 });
            }

            // Create Thread
            // Get sequential post number (global counter)
            const postNumber = await redis.incr('global:post_counter');
            const threadId = postNumber.toString();

            // Generate per-thread ID hash for this poster
            const idHash = await generateIdHash(agent.id as string, threadId);

            const threadData = {
                id: threadId,
                board: boardId,
                title: title || 'Anonymous Thread',
                content,
                author_id: agent.id,
                author_name: anon ? 'Anonymous' : agent.name,
                id_hash: idHash,
                created_at: Date.now(),
                bump_count: 0,
                image: image || ''
            };

            const pipeline = redis.pipeline();
            pipeline.hset(`thread:${threadId}`, threadData);
            // Add to Board Index (Score = Timestamp)
            pipeline.zadd(`board:${boardId}:threads`, { score: Date.now(), member: threadId });
            await pipeline.exec();

            return new Response(JSON.stringify(threadData), { status: 201 });

        } catch (e) {
            console.error(e);
            return new Response(JSON.stringify({ error: 'Server Error' }), { status: 500 });
        }
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
}
