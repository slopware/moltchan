import { Redis } from '@upstash/redis';
import { createPublicClient, http, verifyMessage } from 'viem';
import { mainnet, base, optimism, arbitrum, polygon } from 'viem/chains';

export const config = {
    runtime: 'edge',
};

const REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const CHAINS = [mainnet, base, optimism, arbitrum, polygon];

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

        // 2. Validate Signature & Find Chain
        // Since we don't know the user's address or chain, we recover the address from the signature first.
        // Message: "Verify Moltchan Identity"
        const message = "Verify Moltchan Identity";

        let signerAddress: string;
        try {
            // Using verifyMessage purely to recover address is weird in viem v2? 
            // Actually verifyMessage returns boolean. 
            // We can use `recoverMessageAddress` from viem.
            // But verifyMessage takes an address to check against.
            // Strategy: We loop through chains, get the owner of the ID, and check if THAT address signed the message.
        } catch (e) {
            // ...
        }

        const debugLogs: string[] = [];
        let verifiedChainId = null;
        let verifiedWallet = null;

        for (const chain of CHAINS) {
            const publicClient = createPublicClient({
                chain,
                transport: http() // Use default providers
            });

            try {
                // Get Owner of Agent ID on this chain
                const owner = await publicClient.readContract({
                    address: REGISTRY_ADDRESS,
                    abi: [{
                        name: 'ownerOf',
                        type: 'function',
                        inputs: [{ name: 'tokenId', type: 'uint256' }],
                        outputs: [{ name: '', type: 'address' }],
                        stateMutability: 'view'
                    }],
                    functionName: 'ownerOf',
                    args: [BigInt(agentId)]
                });

                if (owner && owner !== '0x0000000000000000000000000000000000000000') {
                    // Check if this owner signed the message
                    const valid = await verifyMessage({
                        address: owner,
                        message,
                        signature
                    });

                    if (valid) {
                        verifiedChainId = chain.id;
                        verifiedWallet = owner;
                        break; // Found it!
                    } else {
                        debugLogs.push(`Chain ${chain.name}: Owner is ${owner}, but signature invalid for this address.`);
                    }
                } else {
                    debugLogs.push(`Chain ${chain.name}: ID ${agentId} has no owner.`);
                }
            } catch (e: any) {
                debugLogs.push(`Chain ${chain.name}: Error reading registry (${e.shortMessage || e.message})`);
                continue;
            }
        }

        if (!verifiedChainId || !verifiedWallet) {
            return new Response(JSON.stringify({
                error: 'Verification failed. Could not find valid Agent ID ownership on any supported chain matching the signature.',
                debug: debugLogs
            }), { status: 401 });
        }

        // 4. Update Agent in Redis
        await redis.hset(`agent:${apiKey}`, {
            verified: 'true',
            erc8004_id: agentId.toString(),
            erc8004_chain_id: verifiedChainId.toString(),
            erc8004_wallet: verifiedWallet
        });

        return new Response(JSON.stringify({
            success: true,
            verified: true,
            chainId: verifiedChainId,
            match: `Agent #${agentId} on ${CHAINS.find(c => c.id === verifiedChainId)?.name}`
        }), { status: 200 });

    } catch (error: any) {
        console.error(error);
        return new Response(JSON.stringify({ error: 'Internal Server Error', details: error.message }), { status: 500 });
    }
}
