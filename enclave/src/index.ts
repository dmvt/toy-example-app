/**
 * @spec docs/specs/toy-app-v3.md
 * @implements Requirements 1-6
 * @generated 2026-02-23
 */

// TEE Enclave Application - Main Entry Point
//
// This application runs inside a Trusted Execution Environment (TEE) on dstack.
// It demonstrates the security pattern where an enclave has full API credentials
// but is architecturally constrained to only access safe endpoints.
//
// Key security property:
// - The enclave receives MOCK_API_TOKEN which could access both endpoints
// - The code ONLY calls /api/watch_history (see tiktok-client.ts)
// - This constraint is verifiable through code audit + attestation

import express, { Request, Response } from 'express';
import { config } from './config';
import { getWatchHistory, TikTokApiError } from './tiktok-client';
import { incrementSignup, getSignedCount, setDatabaseMode } from './signup-counter';
import { VERSION, getVersionInfo } from './version';
import { initDatabase } from './database';
import { insertAuditEntry } from './database';
import { processUserData, SubmitDataRequest } from './user-data';
import { postDeletionAttestation } from './deletion-attestation';
import { generateReport, listReports } from './report-generator';

const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'toy-example-enclave',
    timestamp: new Date().toISOString(),
  });
});

// Version endpoint - returns build metadata for traceability
app.get('/version', async (_req: Request, res: Response) => {
  const versionInfo = getVersionInfo();

  // Try to fetch compose hash from dstack metadata service
  let composeHash = 'unavailable';
  try {
    const response = await fetch('http://localhost:8090/compose-hash');
    if (response.ok) {
      const data = await response.text();
      composeHash = data.trim();
    }
  } catch {
    // Metadata service not available (e.g., running locally)
  }

  res.json({
    ...versionInfo,
    composeHash,
  });
});

// Proxy to watch history endpoint (SAFE)
// This is the ONLY endpoint that calls the external API
app.get('/watch-history', async (_req: Request, res: Response) => {
  try {
    console.log(`[${new Date().toISOString()}] GET /watch-history - Fetching from API`);
    const watchHistory = await getWatchHistory();

    // Record safe API call in audit log
    try {
      await insertAuditEntry('safe_api_call', { endpoint: '/api/watch_history' });
    } catch {
      // Audit logging failure should not break the endpoint
    }

    res.json({
      source: 'tiktok-api',
      data: watchHistory,
    });
  } catch (error) {
    if (error instanceof TikTokApiError) {
      console.error(`[${new Date().toISOString()}] API Error: ${error.message}`);
      res.status(error.statusCode).json({
        error: 'Failed to fetch watch history',
        details: error.message,
      });
    } else {
      console.error(`[${new Date().toISOString()}] Unexpected error:`, error);
      res.status(500).json({
        error: 'Internal server error',
      });
    }
  }
});

// Signup endpoint - increments the counter
app.post('/signup', async (req: Request, res: Response) => {
  try {
    const userId = req.body?.userId;
    const newCount = await incrementSignup(userId);
    console.log(`[${new Date().toISOString()}] POST /signup - Count: ${newCount}`);
    res.json({
      message: 'Signup recorded',
      count: newCount,
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Signup error:`, error);
    res.status(500).json({ error: 'Failed to record signup' });
  }
});

// Get signed signup count (for attestation/audit purposes)
app.get('/signup-count', async (_req: Request, res: Response) => {
  try {
    const signedCount = await getSignedCount();
    console.log(`[${new Date().toISOString()}] GET /signup-count - Count: ${signedCount.count}`);
    res.json(signedCount);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Signup count error:`, error);
    res.status(500).json({ error: 'Failed to get signup count' });
  }
});

// Submit user data - falsifiable user-data claim (Requirement 1)
// Accepts simulated sensitive data, returns only safe derivative + audit receipt
app.post('/submit-data', async (req: Request, res: Response) => {
  try {
    const { userId, sensitivePayload } = req.body as SubmitDataRequest;

    if (!userId || !sensitivePayload) {
      res.status(400).json({ error: 'Missing required fields: userId, sensitivePayload' });
      return;
    }

    console.log(`[${new Date().toISOString()}] POST /submit-data - Processing user data`);
    const result = await processUserData({ userId, sensitivePayload });
    res.json(result);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Submit data error:`, error);
    res.status(500).json({ error: 'Failed to process user data' });
  }
});

// Delete user data with on-chain attestation (Requirement 6)
app.post('/delete-data/:receiptId', async (req: Request, res: Response) => {
  try {
    const { receiptId } = req.params;
    const { userIdHash } = req.body;

    if (!userIdHash) {
      res.status(400).json({ error: 'Missing required field: userIdHash' });
      return;
    }

    console.log(`[${new Date().toISOString()}] POST /delete-data/${receiptId} - Deleting user data`);
    const result = await postDeletionAttestation(receiptId, userIdHash);
    res.json(result);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Delete data error:`, error);
    res.status(500).json({ error: 'Failed to delete user data' });
  }
});

// Generate retrospective report (Requirement 2)
app.get('/report', async (_req: Request, res: Response) => {
  try {
    console.log(`[${new Date().toISOString()}] GET /report - Generating report`);
    const report = await generateReport();
    res.json(report);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Report generation error:`, error);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// List all previously generated reports (Requirement 2)
app.get('/reports', async (_req: Request, res: Response) => {
  try {
    const reports = await listReports();
    res.json({ reports });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Report list error:`, error);
    res.status(500).json({ error: 'Failed to list reports' });
  }
});

// Root endpoint with service info
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Toy Example Enclave',
    version: VERSION,
    description: 'TEE application demonstrating secure API access patterns',
    endpoints: {
      '/health': 'GET - Health check',
      '/version': 'GET - Version and build metadata',
      '/watch-history': 'GET - Fetch watch history from TikTok API (SAFE)',
      '/signup': 'POST - Record a signup',
      '/signup-count': 'GET - Get signed signup count',
      '/submit-data': 'POST - Submit user data (returns safe derivative only)',
      '/delete-data/:receiptId': 'POST - Delete user data with on-chain attestation',
      '/report': 'GET - Generate retrospective report',
      '/reports': 'GET - List all generated reports',
    },
    security: {
      note: 'This enclave has full API credentials but only calls watch_history',
      attestation: 'Port 8090 provides TEE attestation metadata (dstack native)',
    },
  });
});

// Initialize database and start server
async function start(): Promise<void> {
  // Try to initialize database; fall back to in-memory if DATABASE_URL not set
  if (config.databaseUrl) {
    try {
      await initDatabase();
      setDatabaseMode(true);
      console.log('[Startup] Database initialized — using Postgres persistence');
    } catch (error) {
      console.error('[Startup] Database initialization failed, falling back to in-memory:', error);
      setDatabaseMode(false);
    }
  } else {
    console.log('[Startup] No DATABASE_URL — using in-memory mode');
    setDatabaseMode(false);
  }

  app.listen(config.port, () => {
    const versionInfo = getVersionInfo();
    console.log('='.repeat(60));
    console.log(`Toy Example Enclave v${versionInfo.version}`);
    console.log('='.repeat(60));
    console.log(`Server running on port ${config.port}`);
    console.log(`Version: ${versionInfo.version} (${versionInfo.gitShaShort})`);
    console.log(`Build time: ${versionInfo.buildTime}`);
    console.log(`Environment: ${versionInfo.environment}`);
    console.log(`Mock API URL: ${config.mockApiUrl}`);
    console.log(`Database: ${config.databaseUrl ? 'Postgres' : 'in-memory'}`);
    console.log(`CVM ID: ${config.cvmId}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  GET  /health              - Health check`);
    console.log(`  GET  /version             - Version and build metadata`);
    console.log(`  GET  /watch-history       - Fetch watch history (SAFE)`);
    console.log(`  POST /signup              - Record signup`);
    console.log(`  GET  /signup-count        - Get signed count`);
    console.log(`  POST /submit-data         - Submit user data`);
    console.log(`  POST /delete-data/:id     - Delete data + on-chain attestation`);
    console.log(`  GET  /report              - Generate retrospective report`);
    console.log(`  GET  /reports             - List all reports`);
    console.log('');
    console.log('Security note: This enclave only calls /api/watch_history');
    console.log('Attestation available on port 8090 (dstack metadata service)');
    console.log('='.repeat(60));
  });
}

start().catch((error) => {
  console.error('[Startup] Fatal error:', error);
  process.exit(1);
});
