import { createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import fs from 'node:fs'
import path from 'node:path'

const REGISTRATION_FILE = path.resolve(__dirname, 'registration.json')
const REGISTRY_ADDRESS = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432'

async function register() {
    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) {
        console.error('Error: PRIVATE_KEY environment variable not set.')
        process.exit(1)
    }

    // Check if registration file exists
    if (!fs.existsSync(REGISTRATION_FILE)) {
        console.error(`Error: Registration file not found at ${REGISTRATION_FILE}`)
        process.exit(1)
    }

    // Note: Data uploading to IPFS is manual for now as per instructions.
    // The user should upload the JSON manually and provide the CID.
    const cidArg = process.argv[2]
    if (!cidArg) {
        console.log('Usage: npx tsx scripts/erc8004/register.ts <IPFS_CID>')
        console.log('Please upload scripts/erc8004/registration.json to IPFS first (e.g. Pinata, web3.storage).')
        process.exit(1)
    }

    const cid = cidArg.startsWith('ipfs://') ? cidArg : `ipfs://${cidArg}`
    console.log(`Registering agent with CID: ${cid}`)

    const account = privateKeyToAccount(privateKey as `0x${string}`)
    const rpcUrl = process.env.RPC_URL || 'https://cloudflare-eth.com' // Default to public RPC

    const walletClient = createWalletClient({
        account,
        chain: mainnet,
        transport: http(rpcUrl)
    })

    try {
        const hash = await walletClient.writeContract({
            address: REGISTRY_ADDRESS,
            abi: [{
                name: 'register',
                type: 'function',
                inputs: [{ name: 'agentURI', type: 'string' }],
                outputs: [{ name: 'agentId', type: 'uint256' }],
                stateMutability: 'nonpayable'
            }],
            functionName: 'register',
            args: [cid]
        })

        console.log('Transaction sent! Hash:', hash)
        console.log('Wait for confirmation and your Agent ID will be minted.')
    } catch (error) {
        console.error('Registration failed:', error)
    }
}

register()
