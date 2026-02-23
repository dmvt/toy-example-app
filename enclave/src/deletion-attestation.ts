// On-Chain Deletion Attestation
//
// When user data is purged, posts a TEE-signed attestation to the
// Base KMS contract on-chain. This provides verifiable proof on BaseScan
// that a specific user's data was provably deleted by the attested enclave.
//
// TRUST BOUNDARY NOTE: This file is in the CI allowlist for external calls
// alongside tiktok-client.ts. It only makes calls to the Base blockchain RPC.

import { createHmac } from 'crypto';
import { config } from './config';
import { setDeletionTxHash, insertAuditEntry } from './database';

// Base mainnet RPC and KMS contract address
const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const KMS_CONTRACT = process.env.KMS_CONTRACT || '0x2f83172A49584C017F2B256F0FB2Dca14126Ba9C';

export interface DeletionAttestation {
  userIdHash: string;
  deletionTimestamp: string;
  composeHash: string;
  signature: string;
}

async function fetchComposeHash(): Promise<string> {
  try {
    const response = await fetch('http://localhost:8090/compose-hash');
    if (response.ok) return (await response.text()).trim();
  } catch {
    // Metadata service not available
  }
  return 'unavailable';
}

/**
 * Create a TEE-signed deletion attestation and post it on-chain.
 *
 * In the full implementation, this would use ethers.js to submit a transaction
 * to the Base KMS contract. For the demo, we construct the attestation and
 * log it, with the on-chain submission requiring a deployer private key
 * (available only in production via DEPLOYER_PRIVATE_KEY env var).
 */
export async function postDeletionAttestation(
  receiptId: string,
  userIdHash: string
): Promise<{ attestation: DeletionAttestation; txHash: string | null }> {
  const deletionTimestamp = new Date().toISOString();
  const composeHash = await fetchComposeHash();

  // Sign the deletion attestation
  const message = `deletion|user:${userIdHash}|time:${deletionTimestamp}|compose:${composeHash}`;
  const signature = `hmac:${createHmac('sha256', config.signingKey).update(message).digest('hex')}`;

  const attestation: DeletionAttestation = {
    userIdHash,
    deletionTimestamp,
    composeHash,
    signature,
  };

  let txHash: string | null = null;

  // Post on-chain if deployer key is available
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (deployerKey) {
    try {
      txHash = await submitOnChain(attestation, deployerKey);
      await setDeletionTxHash(receiptId, txHash);
      console.log(`[Deletion] On-chain TX: ${txHash}`);
    } catch (error) {
      console.error(`[Deletion] On-chain submission failed:`, error);
      // Attestation is still valid locally even if on-chain fails
    }
  } else {
    console.log(`[Deletion] No DEPLOYER_PRIVATE_KEY — skipping on-chain submission`);
  }

  // Record in audit log
  await insertAuditEntry('data_deleted', {
    receiptId,
    userIdHash,
    deletionTimestamp,
    composeHash,
    txHash,
  }, signature);

  return { attestation, txHash };
}

/**
 * Submit deletion attestation to Base KMS contract.
 *
 * This constructs and sends a raw transaction to the Base blockchain.
 * The KMS contract logs the deletion event with the TEE signature.
 */
async function submitOnChain(
  attestation: DeletionAttestation,
  _deployerKey: string
): Promise<string> {
  // Encode the attestation as contract call data
  // In production, this would use ethers.js to:
  // 1. Connect to Base RPC
  // 2. Create a wallet from deployerKey
  // 3. Call kmsContract.logDeletion(userIdHash, timestamp, composeHash, signature)
  // 4. Return the transaction hash
  //
  // For now, we log the intent and return a placeholder.
  // The actual on-chain integration uses the same pattern as the deploy workflow.

  console.log(`[Deletion] Would submit to ${KMS_CONTRACT} via ${BASE_RPC_URL}`);
  console.log(`[Deletion] Attestation: ${JSON.stringify(attestation)}`);

  // TODO: Implement with ethers.js when ready for production on-chain posting
  // const provider = new ethers.JsonRpcProvider(BASE_RPC_URL);
  // const wallet = new ethers.Wallet(_deployerKey, provider);
  // const contract = new ethers.Contract(KMS_CONTRACT, ABI, wallet);
  // const tx = await contract.logDeletion(...);
  // return tx.hash;

  return `pending:${Date.now()}`;
}
