
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';

async function debugBaseRpc() {
    const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
    console.log(`🔍 Testing connection to Base RPC: ${rpcUrl}`);

    const client = createPublicClient({
        chain: base,
        transport: http(rpcUrl, {
            batch: false,
            retryCount: 3,
            retryDelay: 1000
        })
    });

    try {
        const blockNumber = await client.getBlockNumber();
        console.log(`✅ Success! Connected to Base. Current Block: ${blockNumber}`);
    } catch (error) {
        console.error("❌ Connection Failed!");
        console.error(error);
    }
}

debugBaseRpc();
