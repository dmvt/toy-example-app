// User Data Flow - Falsifiable User-Data Claim
//
// Simulates the sensitive-data-in, safe-derivative-out pattern:
// 1. User submits simulated sensitive data
// 2. Enclave hashes raw input (SHA-256) — never stores raw data
// 3. Extracts safe derivative (e.g., category, age bracket)
// 4. Records TEE-signed audit entry
// 5. Returns only the safe derivative + audit receipt
//
// The sensitivePayload is hashed and discarded within the request handler — never stored.

import { createHash, createHmac, randomBytes } from 'crypto';
import { config } from './config';
import { insertReceipt, insertAuditEntry } from './database';

export interface SubmitDataRequest {
  userId: string;
  sensitivePayload: string;
}

export interface SubmitDataResponse {
  receiptId: string;
  safeDerivative: string;
  auditEntry: {
    action: string;
    userIdHash: string;
    safeDerivative: string;
    timestamp: string;
    signature: string;
  };
}

/**
 * Extract a safe derivative from the sensitive payload.
 * In a real system this might classify content, extract aggregate stats, etc.
 * Here we simulate by extracting a category and bracket from the payload hash.
 */
function extractSafeDerivative(payload: string): string {
  const hash = createHash('sha256').update(payload).digest('hex');
  const categories = ['entertainment', 'education', 'lifestyle', 'sports', 'technology'];
  const brackets = ['13-17', '18-25', '26-35', '36-50', '50+'];

  // Deterministic category/bracket from hash bytes
  const catIndex = parseInt(hash.substring(0, 2), 16) % categories.length;
  const bracketIndex = parseInt(hash.substring(2, 4), 16) % brackets.length;

  return `category:${categories[catIndex]},bracket:${brackets[bracketIndex]}`;
}

/**
 * Process a user data submission.
 *
 * SECURITY: The sensitivePayload is hashed immediately and never persisted.
 * Only the safe derivative and userId hash are stored.
 */
export async function processUserData(input: SubmitDataRequest): Promise<SubmitDataResponse> {
  const timestamp = new Date().toISOString();
  const receiptId = `receipt_${randomBytes(8).toString('hex')}`;

  // Hash the userId — never store raw userId
  const userIdHash = `sha256:${createHash('sha256').update(input.userId).digest('hex')}`;

  // Extract safe derivative from the sensitive payload
  // The raw sensitivePayload is NEVER stored — only this derivative
  const safeDerivative = extractSafeDerivative(input.sensitivePayload);

  // Sign the audit entry
  const auditMessage = `action:data_received|user_id:${userIdHash}|safe_derivative:${safeDerivative}|timestamp:${timestamp}`;
  const signature = `hmac:${createHmac('sha256', config.signingKey).update(auditMessage).digest('hex')}`;

  // Persist the receipt (safe derivative only, never raw data)
  await insertReceipt(receiptId, userIdHash, safeDerivative, signature);

  // Record audit entry
  await insertAuditEntry('data_received', {
    receiptId,
    userIdHash,
    safeDerivative,
    timestamp,
  }, signature);

  // At this point, the raw sensitivePayload falls out of scope and is garbage collected.
  // It was never assigned to any persistent variable, database, or response field.

  return {
    receiptId,
    safeDerivative,
    auditEntry: {
      action: 'data_received',
      userIdHash,
      safeDerivative,
      timestamp,
      signature,
    },
  };
}
