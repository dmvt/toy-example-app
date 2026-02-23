// Retrospective Report Generator
//
// Generates periodic summary reports covering:
// - Time window, users processed, safe API calls made, audit log digest
// - TEE-signed (HMAC with enclave-derived key) for offline verification
// - Includes compose hash and enclave version for traceability
//
// Reports are served via GET /report (current) and GET /reports (list).
// A GitHub Actions cron workflow pulls and commits them daily.

import { createHash, createHmac } from 'crypto';
import { config } from './config';
import { VERSION } from './version';
import {
  getSignupCount,
  getReceiptCount,
  getAuditLog,
  insertReport,
  insertAuditEntry,
  getReports as getReportsFromDb,
} from './database';

export interface RetrospectiveReport {
  reportId: string;
  generatedAt: string;
  timeWindow: { start: string; end: string };
  enclaveVersion: string;
  composeHash: string;
  summary: {
    totalUsersProcessed: number;
    totalSafeApiCalls: number;
    totalSignups: number;
    auditLogDigest: string;
  };
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
 * Generate a retrospective report for the last 24 hours (or since the last report).
 */
export async function generateReport(): Promise<RetrospectiveReport> {
  const now = new Date();
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24h ago

  const reportId = `report_${now.toISOString().slice(0, 10).replace(/-/g, '')}`;

  // Gather summary data
  const totalSignups = await getSignupCount();
  const totalUsersProcessed = await getReceiptCount();

  // Count safe API calls from audit log
  const auditEntries = await getAuditLog(windowStart);
  const totalSafeApiCalls = auditEntries.filter(e => e.action === 'safe_api_call').length;

  // Compute audit log digest
  const auditContent = JSON.stringify(auditEntries);
  const auditLogDigest = `sha256:${createHash('sha256').update(auditContent).digest('hex')}`;

  const composeHash = await fetchComposeHash();

  const report: Omit<RetrospectiveReport, 'signature'> = {
    reportId,
    generatedAt: now.toISOString(),
    timeWindow: {
      start: windowStart.toISOString(),
      end: windowEnd.toISOString(),
    },
    enclaveVersion: VERSION,
    composeHash,
    summary: {
      totalUsersProcessed,
      totalSafeApiCalls,
      totalSignups,
      auditLogDigest,
    },
  };

  // Sign the report
  const reportMessage = JSON.stringify(report);
  const signature = `hmac:${createHmac('sha256', config.signingKey).update(reportMessage).digest('hex')}`;

  const signedReport: RetrospectiveReport = { ...report, signature };

  // Persist report
  await insertReport(
    reportId,
    windowStart,
    windowEnd,
    signedReport as unknown as Record<string, unknown>,
    signature
  );

  // Audit entry for report generation
  await insertAuditEntry('report_generated', { reportId }, signature);

  console.log(`[Report] Generated ${reportId}: ${totalUsersProcessed} users, ${totalSignups} signups`);

  return signedReport;
}

/**
 * List all previously generated reports (summary view).
 */
export async function listReports(): Promise<Array<{
  reportId: string;
  generatedAt: string;
  signature: string;
}>> {
  const rows = await getReportsFromDb();
  return rows.map(r => ({
    reportId: r.report_id,
    generatedAt: r.created_at.toISOString(),
    signature: r.signature,
  }));
}
