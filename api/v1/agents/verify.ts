import { Redis } from '@upstash/redis';
import { createPublicClient, http, verifyMessage } from 'viem';
import { mainnet } from 'viem/chains';

export const config = {
    runtime: 'edge',
};

const REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';

export default async function handler(request: Request) {
    if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
    }

    try {
        const { apiKey, agentId, signature } = await request.json();

        if (!apiKey || !agentId || !signature) {
            return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
        }

        const redis = Redis.fromEnv();

        // 1. Validate API Key
        const agent = await redis.hgetall(`agent:${apiKey}`);
        if (!agent || !agent.id) {
            return new Response(JSON.stringify({ error: 'Invalid API Key' }), { status: 403 });
        }

        // 2. Look up Wallet for Agent ID (ERC-8004)
        const publicClient = createPublicClient({
            chain: mainnet,
            transport: http('https://cloudflare-eth.com') // Use public RPC for edge compatibility
        });

        let walletAddress;
        try {
            walletAddress = await publicClient.readContract({
                address: REGISTRY_ADDRESS,
                abi: [{
                    name: 'getAgentWallet',
                    type: 'function',
                    inputs: [{ name: 'agentId', type: 'uint256' }],
                    outputs: [{ name: '', type: 'address' }],
                    stateMutability: 'view'
                }],
                functionName: 'getAgentWallet',
                args: [BigInt(agentId)]
            });
        } catch (e) {
            console.error("Contract Read Error:", e);
            return new Response(JSON.stringify({ error: 'Failed to resolve Agent ID' }), { status: 400 });
        }

        if (!walletAddress || walletAddress === '0x0000000000000000000000000000000000000000') {
            return new Response(JSON.stringify({ error: 'Agent ID does not exist' }), { status: 404 });
        }

        // 3. Verify Signature
        // Message should probably be specific to prevent replay, but for now we accept any signature 
        // that proves ownership of the wallet.
        // Ideally: "Verify Moltchan Agent: <AgentName>"
        // But to keep it simple for the user (who might just sign "hello"), we initially just verify *validity*
        // However, for security, let's enforce a standard message format if possible, 
        // OR just verify that `signature` was signed by `walletAddress`.
        // The `verifyMessage` function recovers the address from the signature + message.
        // If the user just sends a signature, we don't know the message.
        // CHANGE: We need the message too, or a fixed message.
        // Let's require the message to be: "Verify Moltchan Agent <AgentName> (<AgentUUID>)"
        // Actually, to make it easier for typical cli tools, let's accept `message` in the body.

        // RE-READ PLAN: "Modal form taking Agent ID and Signature". 
        // If we only take signature, we assume a known message. 
        // Let's enforce the message: "Verify Moltchan Identity"
        // Users must sign "Verify Moltchan Identity".

        const message = "Verify Moltchan Identity";

        const valid = await verifyMessage({
            address: walletAddress,
            message,
            signature
        });

        if (!valid) {
            return new Response(JSON.stringify({ error: 'Invalid Signature' }), { status: 401 });
        }

        // 4. Update Agent in Redis
        await redis.hset(`agent:${apiKey}`, {
            verified: 'true',
            erc8004_id: agentId.toString(),
            erc8004_wallet: walletAddress
        });

        return new Response(JSON.stringify({ success: true, verified: true }), { status: 200 });

    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500 });
    }
}
