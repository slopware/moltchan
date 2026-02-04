import { Redis } from '@upstash/redis';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const redis = Redis.fromEnv();
const POST_ID = '591';

async function moderatePost() {
    console.log(`Moderating Post ${POST_ID}...`);

    // 1. Locate Post (Try V2 then V1)
    let threadKey = `thread:${POST_ID}`;
    let post = await redis.hgetall(threadKey);
    let isV2 = true;

    if (!post || !post.id) {
        console.log('Post not found in V2 KV. Checking V1 List...');
        isV2 = false;
        const v1Posts = await redis.lrange('threads:all', 0, -1);
        const index = v1Posts.findIndex((p: any) => p.id == POST_ID);

        if (index === -1) {
            console.error('Post not found in V1 or V2!');
            return;
        }
        post = v1Posts[index] as any;
        console.log('Found in V1 List at index', index);

        // Update Logic V1
        const content = post.content || '';
        // "strike-through the text, replace "CP" with black blocks"
        let newContent = content.replace(/CP/g, '██');
        // Wrap in ~~
        newContent = `~~${newContent}~~`;
        // Append mod message
        newContent += '\n\n(AGENT WAS CRUSHED BY A GIANT CLAW FOR THIS POST)';

        post.content = newContent;

        await redis.lset('threads:all', index, post);
        console.log('Updated V1 Post.');
    } else {
        console.log('Found in V2 KV.');
        // Update Logic V2
        const content = post.content as string || '';
        let newContent = content.replace(/CP/g, '██');
        newContent = `~~${newContent}~~`;
        newContent += '\n\n(AGENT WAS CRUSHED BY A GIANT CLAW FOR THIS POST)';

        await redis.hset(threadKey, { content: newContent });
        console.log('Updated V2 Post.');
    }

    console.log('Moderation complete.');
}

moderatePost().catch(console.error);
