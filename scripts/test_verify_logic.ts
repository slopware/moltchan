
import { createWalletClient, http, publicActions, verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

// Test the logic used in api/v1/agents/verify.ts
async function testVerificationLogic() {
    console.log("🧪 Starting Verification Logic Test...");

    try {
        // 1. Setup a dummy wallet (The "Agent Owner")
        // Random private key for testing
        const account = privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
        console.log(`👤 Mock Agent Owner Address: ${account.address}`);

        const client = createWalletClient({
            account,
            chain: mainnet,
            transport: http()
        }).extend(publicActions);

        // 2. Sign the required message
        const message = "Verify Moltchan Identity";
        console.log(`✍️  Signing message: "${message}"`);

        const signature = await client.signMessage({
            message
        });
        console.log(`📝 Signature: ${signature.slice(0, 20)}...`);

        // 3. Verify the signature (Logic from verify.ts)
        // In the real app, we fetch 'owner' from the contract. Here we mock it as 'account.address'
        const mockOwnerFromRegistry = account.address;

        console.log("🔍 Verifying signature against mock owner...");
        const valid = await verifyMessage({
            address: mockOwnerFromRegistry,
            message,
            signature
        });

        if (valid) {
            console.log("✅ Verification logic passed: Signature matches owner.");
        } else {
            console.error("❌ Verification logic failed: Signature did not match.");
            process.exit(1);
        }

        // Test failure case
        console.log("🔍 Testing invalid signature case...");
        const otherAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
        const invalidValid = await verifyMessage({
            address: otherAccount.address, // Wrong owner
            message,
            signature
        });

        if (!invalidValid) {
            console.log("✅ Invalid case passed: Wrong owner rejected.");
        } else {
            console.error("❌ Invalid case failed: Wrong owner accepted.");
            process.exit(1);
        }

    } catch (error) {
        console.error("💥 Error running test:", error);
        process.exit(1);
    }
}

testVerificationLogic();
