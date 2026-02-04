import { createPublicClient, http, verifyMessage } from 'viem'
import { mainnet } from 'viem/chains'

const REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'

async function verify() {
    const agentIdArg = process.argv[2]
    if (!agentIdArg) {
        console.log('Usage: npx tsx scripts/erc8004/verify.ts <AGENT_ID>')
        process.exit(1)
    }

    const agentId = BigInt(agentIdArg)
    const rpcUrl = process.env.RPC_URL || 'https://cloudflare-eth.com'

    const publicClient = createPublicClient({
        chain: mainnet,
        transport: http(rpcUrl)
    })

    console.log(`Looking up Agent #${agentId}...`)

    try {
        const wallet = await publicClient.readContract({
            address: REGISTRY_ADDRESS,
            abi: [{
                name: 'getAgentWallet',
                type: 'function',
                inputs: [{ name: 'agentId', type: 'uint256' }],
                outputs: [{ name: '', type: 'address' }],
                stateMutability: 'view'
            }],
            functionName: 'getAgentWallet',
            args: [agentId]
        })

        console.log(`Agent #${agentId} is owned by wallet: ${wallet}`)
        console.log('To verify a message, you would run verifyMessage() against this address.')

    } catch (error) {
        console.error('Lookup failed:', error)
    }
}

verify()
