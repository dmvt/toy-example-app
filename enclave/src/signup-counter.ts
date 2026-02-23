// Signup Counter with Attestation Signing
//
// Tracks how many "signups" have occurred and provides signed counts
// for retrospective audit purposes.
//
// When DATABASE_URL is set, signups are persisted to Postgres.
// Otherwise falls back to in-memory counter (dev mode).

import { createHash, createHmac } from 'crypto';
import { config } from './config';
import { insertSignup, getSignupCount, insertAuditEntry } from './database';

let useDatabase = false;
let inMemoryCount = 0;

export function setDatabaseMode(enabled: boolean): void {
  useDatabase = enabled;
}

export interface SignupCountResponse {
  count: number;
  signature: string;
  timestamp: string;
}

/**
 * Increment the signup counter.
 * Returns the new count.
 */
export async function incrementSignup(userId?: string): Promise<number> {
  if (useDatabase) {
    const userIdHash = userId
      ? createHash('sha256').update(userId).digest('hex')
      : createHash('sha256').update(`anon_${Date.now()}`).digest('hex');

    await insertSignup(userIdHash, config.cvmId);
    await insertAuditEntry('signup', { userIdHash, sourceCvm: config.cvmId });

    const count = await getSignupCount();
    console.log(`[Signup] Count incremented to ${count} (database)`);
    return count;
  }

  inMemoryCount += 1;
  console.log(`[Signup] Count incremented to ${inMemoryCount} (in-memory)`);
  return inMemoryCount;
}

/**
 * Get the current signup count with a cryptographic signature.
 */
export async function getSignedCount(): Promise<SignupCountResponse> {
  const count = useDatabase ? await getSignupCount() : inMemoryCount;
  const timestamp = new Date().toISOString();
  const message = `count:${count}|timestamp:${timestamp}`;

  const signature = createHmac('sha256', config.signingKey)
    .update(message)
    .digest('hex');

  return {
    count,
    signature,
    timestamp,
  };
}

/**
 * Get the raw count without signature (for internal use).
 */
export async function getCount(): Promise<number> {
  return useDatabase ? await getSignupCount() : inMemoryCount;
}
