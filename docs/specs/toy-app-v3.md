# Toy App v3: Retrospective Reporting, Shared State & Falsifiable Claims

**Status:** IMPLEMENTING
**Author:** LSDan
**Created:** 2026-02-17
**Last Updated:** 2026-02-17
**Supersedes:** `docs/specs/version-upgrade-multi-machine.md`
**Requested By:** Andrew Miller (@socrates1024_1), Feb 3 & Feb 9 dstack syncs

## Overview

The toy example app currently proves an enclave *can* be constrained to safe API endpoints — but Andrew Miller's feedback (Feb 3 dstack sync) identifies three gaps that prevent it from being a useful reference for production systems like Jordy:

1. **No falsifiable claim about user data.** The audit log tracks signups, but no user actually passes sensitive data through the enclave. An auditor can't verify "the enclave handled N users' data without leaking it."

2. **No retrospective report.** All evidence is behind live endpoints that disappear if the enclave goes down. Andrew wants a persistent report — delivered via GitHub or IPFS — that survives independent of the running enclave.

3. **No shared state across machines.** Each CVM (prod5/prod9) maintains independent counters and audit logs. For the Jordy dashboard pattern, accounts need to be unified across instances with a shared encrypted database.

This spec also carries forward the unimplemented version upgrade flow and multi-machine comparison work from the superseded spec, and adds the encrypted database with deletion attestations discussed in the Feb 9 Andrew/LSDan followup.

### Why This Matters

From Andrew (Feb 3 sync):
> "What I would mostly want is like a retrospective report... run it for a while, then generate the report."
> "It should have some more falsifiable claim that relates to user data."

From Andrew (Feb 3 sync, on modeling Jordy):
> "That is what the toy example should be modeling for [Jordy]."

From LSDan (Feb 3 action items):
> "I'll set up a daily report that posts to the GitHub repo and includes a shared database between two running instances."

From Andrew (Feb 9 followup):
> "We should be able to test the release process on the simpler Archive TEE before Ian handles the Jordy TEE migration."

## Requirements

### Must Have

#### 1. Falsifiable User-Data Claim

- [ ] Add a user data flow where the enclave receives sensitive-looking input (simulated user credentials or personal data)
- [ ] Enclave processes the data (e.g., extracts a safe derivative like a hash or aggregate) and discards the raw input
- [ ] Every data-handling event is recorded in a TEE-signed audit entry: `action:data_received|user_id:hash|safe_derivative:X|timestamp:T`
- [ ] An auditor can verify: "N users passed data through the enclave, and only safe derivatives were emitted"
- [ ] The raw user data must never appear in any endpoint response, log, or persisted state — only the derivative
- [ ] CI verification extended to ensure no raw user data patterns leak from enclave endpoints

#### 2. Retrospective Report Generation

- [ ] Enclave generates a periodic summary report (JSON + human-readable) covering: time window, users processed, safe API calls made, audit log digest
- [ ] Report is TEE-signed (HMAC with enclave-derived key) so it can be verified as originating from the attested enclave
- [ ] Report includes the compose hash and enclave version at generation time for traceability
- [ ] Report is pulled and posted to the GitHub repository automatically via a GitHub Actions cron workflow (enclave serves `/report`, GH Actions fetches and commits — preserves trust boundary by keeping GitHub tokens out of the enclave)
- [ ] Reports persist as files in `reports/` directory (or equivalent), independent of enclave uptime
- [ ] A report can be verified offline: given the report file and the enclave's public attestation, anyone can check the signature

#### 3. Shared Database via 3-CVM Architecture

Three separate Phala CVMs connected via VPN (WireGuard through dstack networking):

| CVM | Role | Machine | Description |
|-----|------|---------|-------------|
| CVM 1 | App Enclave | Phala machine 1 | Express app, serves all endpoints, connects to Postgres primary |
| CVM 2 | Postgres Primary | Phala machine 2 | Read/write database, LUKS-encrypted storage |
| CVM 3 | Postgres Replica | Phala machine 3 | Read-only streaming replica, LUKS-encrypted storage |

- [ ] Deploy Postgres primary as its own CVM with LUKS-encrypted `/data` volume (keys from KMS)
- [ ] Deploy Postgres replica as a separate CVM with streaming replication from primary
- [ ] Connect all three CVMs via dstack VPN (WireGuard) — database ports never exposed publicly
- [ ] App enclave connects to Postgres primary for writes, can fall back to replica for reads
- [ ] Replace in-memory signup counter with Postgres-backed persistence
- [ ] Unified account/signup tracking: all data visible from a single database regardless of which CVM served the request
- [ ] Each CVM independently attested — auditor can verify all three are running expected code
- [ ] Document the VPN topology, Postgres replication configuration, and failover behavior

#### 4. Version Upgrade Flow (carried from superseded spec)

- [ ] Semantic versioning exposed at runtime via `/version` endpoint (already partially implemented)
- [ ] `bump-version.sh` script updates version across all relevant files (already exists)
- [ ] Document the complete upgrade workflow from code change → deployed update
- [ ] Demonstrate compose hash change detection during upgrades
- [ ] Show on-chain transparency log entries for version transitions
- [ ] Version tags trigger automated production deployments (already configured in CI)

#### 5. Multi-CVM Attestation Comparison (updated from superseded spec)

- [ ] Deploy all three CVMs (app, pg-primary, pg-replica) across three Phala machines with the same app-id
- [ ] Extend `compare-instances.sh` to verify all three CVMs (not just app instances)
- [ ] Verify TDX quotes from all three machines (Intel root of trust)
- [ ] Compare MR_ENCLAVE values: app CVMs must match each other, Postgres CVMs must match each other
- [ ] Document the 3-CVM topology and what each attestation proves
- [ ] Document on-chain logging: all three deployments logged with same app-id

#### 6. On-Chain Deletion Attestations

- [ ] When user data is purged, a TEE-signed deletion attestation is posted to the Base KMS contract on-chain
- [ ] Deletion attestation includes: `user_id_hash`, `deletion_timestamp`, `TEE_signature`, `compose_hash`
- [ ] Anyone can verify on BaseScan that a specific user's data was provably deleted by the attested enclave
- [ ] Audit log records both the deletion event and the on-chain TX hash for cross-reference

### Should Have

- [ ] Report delivery to IPFS as alternative to GitHub (Andrew suggested "GitHub or IPFS")
- [ ] Automated changelog generation from conventional commits
- [ ] GitHub Release creation tied to version tags
- [ ] Auto-generated `DEPLOYMENTS.md` updated by CI on each deploy
- [ ] Dashboard page (static HTML or simple frontend) that renders the latest report for human consumption — models the "Jordy dashboard" Andrew described

### Must NOT Have

- Production-grade fleet management or orchestration
- Automated rollback mechanisms
- Load balancing between instances
- Real user authentication (simulated data only)
- Real TikTok API integration (mock API only)

## Non-Requirements

The following are explicitly out of scope:

- **Consensus protocol**: The shared database uses standard Postgres streaming replication, not blockchain consensus
- **Multi-writer replication**: Only the primary accepts writes; the replica is read-only
- **High availability**: This is a demonstration app; brief downtime during upgrades is acceptable
- **Real PII handling**: All "user data" is simulated/synthetic — no actual personal data enters the system
- **Cross-cloud deployment**: All CVMs remain on Phala Cloud (GCP interop is a separate workstream)
- **Automated failover**: Manual promotion of replica to primary is acceptable for the demo
- **Load balancing**: No traffic distribution between CVMs; single app endpoint

## Design

### Architecture

```
External (Untrusted)              Trust Boundary (TCB) — 3 CVMs on dstack VPN
                                  ┌─────────────────────────────────────────────────┐
┌─────────────────┐               │                                                 │
│ Mock TikTok API │               │  CVM 1: App Enclave (Phala Machine 1)           │
│ :3000           │◄──fetch───────│  ├── Express :8080                              │
│ ├─ /watch_hist  │               │  │   ├── /watch-history (safe API call)         │
│ └─ /direct_msgs │               │  │   ├── /submit-data (user data flow)          │
└─────────────────┘               │  │   ├── /report (generate retrospective)       │
                                  │  │   ├── /reports (list all reports)             │
┌─────────────────┐               │  │   ├── /signup, /signup-count                 │
│ GitHub Actions  │──cron pull────│  │   └── /version                               │
│ (daily cron)    │  GET /report  │  ├── Metadata :8090 (attestation)               │
│ ├─ Fetch report │               │  └── Connects to CVM 2 via VPN                  │
│ ├─ Commit to    │               │                                                 │
│ │  reports/     │               │         ┌──── WireGuard VPN ────┐               │
│ └─ Push to repo │               │         │   (dstack networking) │               │
└─────────────────┘               │         │                      │               │
                                  │  CVM 2: Postgres Primary (Phala Machine 2)      │
┌─────────────────┐               │  ├── Postgres :5432 (VPN-only, not public)      │
│ Base Blockchain │◄──on-chain────│  │   ├── signups, audit_log                     │
│ KMS Contract    │  (deploys +   │  │   ├── user_data_receipts                     │
│ 0x2f83...       │   deletions)  │  │   └── reports                                │
└─────────────────┘               │  ├── LUKS-encrypted /data (keys from KMS)       │
                                  │  ├── Metadata :8090 (attestation)               │
                                  │  └── Streams WAL to CVM 3 via VPN               │
                                  │                                                 │
                                  │  CVM 3: Postgres Replica (Phala Machine 3)      │
                                  │  ├── Postgres :5432 (read-only, VPN-only)       │
                                  │  ├── LUKS-encrypted /data (keys from KMS)       │
                                  │  └── Metadata :8090 (attestation)               │
                                  └─────────────────────────────────────────────────┘

┌─────────────────┐
│ Auditor         │  1. compare-instances.sh — verify TDX quotes for all 3 CVMs
│ (anyone)        │  2. Check reports/ on GitHub — offline signature verification
│                 │  3. BaseScan — verify deployment + deletion attestation TXs
└─────────────────┘
```

### Components

#### New: User Data Flow (`enclave/src/user-data.ts`)

Simulates the sensitive-data-in, safe-derivative-out pattern:

```typescript
// User submits simulated sensitive data (e.g., viewing preferences + fake PII)
// Enclave:
//   1. Hashes the raw input (SHA-256)
//   2. Extracts safe derivative (e.g., preference category, age bracket)
//   3. Records TEE-signed audit entry
//   4. Discards raw input (never persisted, never returned)
//   5. Returns only the safe derivative + audit receipt
```

New endpoint: `POST /submit-data`
- Input: `{ userId: string, sensitivePayload: string }`
- Output: `{ receiptId: string, safeDerivative: string, auditSignature: string }`
- The `sensitivePayload` is hashed and discarded within the request handler — never stored

#### New: Report Generator (`enclave/src/report-generator.ts`)

Generates retrospective reports:

```typescript
interface RetrospectiveReport {
  reportId: string;
  generatedAt: string;
  timeWindow: { start: string; end: string };
  enclaveVersion: string;
  composeHash: string;
  summary: {
    totalUsersProcessed: number;
    totalSafeApiCalls: number;
    totalSignups: number;
    auditLogDigest: string;    // SHA-256 of full audit log
  };
  signature: string;            // HMAC with TEE-derived key
}
```

New endpoint: `GET /report` — generates and returns the current report
New endpoint: `GET /reports` — lists all previously generated reports

#### New: Database Layer (`enclave/src/database.ts`)

Replaces in-memory signup counter with Postgres:

- Tables: `signups`, `audit_log`, `reports`, `user_data_receipts`
- Connection via `pg` library, `DATABASE_URL` from environment
- App enclave connects to Postgres primary over VPN (e.g., `postgresql://enclave:pass@10.0.0.2:5432/toyapp`)
- Read queries can optionally fall back to replica (`10.0.0.3:5432`)

#### New: Postgres CVM Docker Compose (`postgres/docker-compose.yml`)

Separate compose file for the Postgres CVM (deployed as its own dstack app):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"  # Accessible only on VPN network
    volumes:
      - /data/postgres:/var/lib/postgresql/data  # LUKS-encrypted volume
    environment:
      POSTGRES_DB: toyapp
      POSTGRES_USER: enclave
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    command: >
      postgres
        -c wal_level=replica
        -c max_wal_senders=3
        -c hot_standby=on
```

A second compose variant (`postgres/docker-compose.replica.yml`) configures the replica with `primary_conninfo` pointing to the primary's VPN address.

#### Modified: App Docker Compose (`enclave/docker-compose.yml`)

Remove any local database dependency; add VPN networking and `DATABASE_URL`:

```yaml
services:
  enclave:
    # ... existing config
    environment:
      DATABASE_URL: postgresql://enclave:${DB_PASSWORD}@${PG_PRIMARY_VPN_IP}:5432/toyapp
      DATABASE_REPLICA_URL: postgresql://enclave:${DB_PASSWORD}@${PG_REPLICA_VPN_IP}:5432/toyapp
```

#### Modified: CI/CD (`.github/workflows/build.yml`)

- Build and push Postgres CVM images
- Deploy three CVMs in sequence: pg-primary, pg-replica (wait for replication), then app enclave
- Extend security verification to check no raw user data patterns in responses
- Add database migration step (runs against primary before app deploy)

#### New: Report Pull Workflow (`.github/workflows/pull-report.yml`)

GitHub Actions cron job — the enclave never pushes, preserving trust boundary:

```yaml
name: Pull Retrospective Report
on:
  schedule:
    - cron: '0 6 * * *'  # Daily at 06:00 UTC
  workflow_dispatch: {}

jobs:
  pull-report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Fetch report from enclave
        run: |
          curl -sf "${{ secrets.ENCLAVE_URL }}/report" > "reports/$(date +%Y-%m-%d).json"
      - name: Verify report signature
        run: ./scripts/verify-report.sh "reports/$(date +%Y-%m-%d).json"
      - name: Commit and push
        run: |
          git add reports/
          git commit -m "chore: daily retrospective report $(date +%Y-%m-%d)"
          git push
```

#### New: Deletion Attestation On-Chain Poster (`enclave/src/deletion-attestation.ts`)

When user data is purged, posts a TEE-signed attestation to the Base KMS contract:

- Constructs attestation payload: `{ userIdHash, deletionTimestamp, composeHash, signature }`
- Calls Base contract method to log the deletion event
- Records the on-chain TX hash in the local audit_log table
- CI verification updated to use an allowlist for external calls: `tiktok-client.ts` (API) and `deletion-attestation.ts` (on-chain). Any other file containing `fetch()` or HTTP client usage fails the build.
- CLAUDE.md trust boundary directive updated accordingly

### Interfaces

#### New Endpoint: POST /submit-data

```json
// Request
{
  "userId": "user_abc123",
  "sensitivePayload": "simulated sensitive viewing data..."
}

// Response
{
  "receiptId": "receipt_deadbeef",
  "safeDerivative": "category:entertainment,bracket:18-25",
  "auditEntry": {
    "action": "data_received",
    "userIdHash": "sha256:a1b2c3...",
    "safeDerivative": "category:entertainment,bracket:18-25",
    "timestamp": "2026-02-17T12:00:00Z",
    "signature": "hmac:xyz..."
  }
}
```

#### New Endpoint: GET /report

```json
{
  "reportId": "report_20260217",
  "generatedAt": "2026-02-17T00:00:00Z",
  "timeWindow": {
    "start": "2026-02-16T00:00:00Z",
    "end": "2026-02-17T00:00:00Z"
  },
  "enclaveVersion": "3.0.0",
  "composeHash": "sha256:abc123...",
  "summary": {
    "totalUsersProcessed": 142,
    "totalSafeApiCalls": 567,
    "totalSignups": 42,
    "auditLogDigest": "sha256:def456..."
  },
  "signature": "hmac:report_signature_here"
}
```

#### New Endpoint: GET /reports

```json
{
  "reports": [
    { "reportId": "report_20260217", "generatedAt": "2026-02-17T00:00:00Z", "signature": "hmac:..." },
    { "reportId": "report_20260216", "generatedAt": "2026-02-16T00:00:00Z", "signature": "hmac:..." }
  ]
}
```

### Data Model

#### signups (replaces in-memory counter)

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| user_id_hash | TEXT | SHA-256 of submitted userId |
| created_at | TIMESTAMP | Signup time |
| source_cvm | TEXT | Which CVM processed the signup |

#### audit_log (replaces in-memory log)

| Column | Type | Description |
|--------|------|-------------|
| id | SERIAL | Primary key |
| action | TEXT | Event type (signup, data_received, data_deleted, report_generated) |
| details | JSONB | Event-specific data (safe derivatives only, never raw input) |
| signature | TEXT | HMAC signature with TEE-derived key |
| created_at | TIMESTAMP | Event time |

#### user_data_receipts

| Column | Type | Description |
|--------|------|-------------|
| receipt_id | TEXT | Unique receipt identifier |
| user_id_hash | TEXT | SHA-256 of userId |
| safe_derivative | TEXT | Extracted safe data |
| signature | TEXT | TEE-signed receipt |
| created_at | TIMESTAMP | Processing time |
| deleted_at | TIMESTAMP | When raw data was purged (immediate) |
| deletion_attestation | TEXT | TEE-signed proof of deletion |

#### reports

| Column | Type | Description |
|--------|------|-------------|
| report_id | TEXT | Unique report identifier |
| time_window_start | TIMESTAMP | Report period start |
| time_window_end | TIMESTAMP | Report period end |
| report_json | JSONB | Full report content |
| signature | TEXT | HMAC signature |
| posted_to_github | BOOLEAN | Whether report was pushed to repo |
| created_at | TIMESTAMP | Generation time |

## Open Questions

- [x] ~~**Database choice**~~ **DECIDED: Postgres 16.** Full-featured streaming replication, well-understood primary/replica setup, runs as its own CVM.
- [x] ~~**Report delivery mechanism**~~ **DECIDED: GitHub Actions cron pull.** A daily cron job fetches `/report` from the enclave and commits to the repo. This preserves the trust boundary — no GitHub tokens inside the enclave, no outbound calls besides the mock API and on-chain attestations. Enclave only needs to serve data it already has.
- [x] ~~**Deletion attestation scope**~~ **DECIDED: On-chain.** Deletion attestations posted to the Base KMS contract for maximum transparency. Cost is acceptable for a demo app with low deletion volume.
- [x] ~~**Replication topology**~~ **DECIDED: Primary/replica.** Postgres streaming replication with one writer (CVM 2) and one read-only replica (CVM 3). Simple, well-understood, avoids conflict resolution complexity.

### New Open Questions

- [x] ~~**VPN configuration**~~ **DECIDED: Use dstack's built-in WireGuard networking.** CVMs connect to each other via dstack gateway URLs. No custom VPN setup needed.
- [x] ~~**Trust boundary for on-chain calls**~~ **DECIDED: Allowlist approach.** CI check updated from "only `tiktok-client.ts`" to "only files in an explicit allowlist" (`tiktok-client.ts` for API calls, `deletion-attestation.ts` for on-chain attestation). The CLAUDE.md trust boundary directive will be updated to reflect: "Only allowlisted modules may make external calls. The allowlist is enforced by CI and must be explicitly expanded for each new outbound call site." This preserves the spirit of the rule (no unauthorized calls to sensitive endpoints) while permitting on-chain transparency logging.
- [x] ~~**Postgres CVM image**~~ **DECIDED: Stock `postgres:16-alpine`.** No custom image needed.

## Alternatives Considered

### Alternative 1: Keep state per-CVM, aggregate in reports only

**Pros:** No shared database complexity, each CVM fully independent
**Cons:** Doesn't model the Jordy pattern where users exist across instances. Andrew specifically asked for unified accounts.
**Decision:** Rejected — the shared database is a core requirement from Feb 3 sync.

### Alternative 2: Use blockchain for shared state instead of a database

**Pros:** Maximally transparent, no separate database service
**Cons:** Extremely slow for per-request writes, expensive, overkill for a demo app. On-chain logging is already handled by Base KMS for deployment events.
**Decision:** Rejected — use standard database with on-chain logging only for high-value events (deployments, deletion attestations).

### Alternative 3: Skip the falsifiable claim, keep current audit log

**Pros:** Less implementation work
**Cons:** Directly contradicts Andrew's primary feedback. The current audit log only proves the enclave *ran*, not that it *handled user data safely*.
**Decision:** Rejected — the falsifiable claim is the most important gap to close.

## Traceability

| Requirement | Implementation | Tests |
|-------------|----------------|-------|
| Falsifiable user-data claim | enclave/src/user-data.ts, index.ts:112 (POST /submit-data) | CI: no raw data in responses |
| Retrospective report generation | enclave/src/report-generator.ts, index.ts:140 (GET /report, /reports) | scripts/verify-report.sh |
| Report pull via GH Actions cron | .github/workflows/pull-report.yml | Manual: workflow_dispatch |
| 3-CVM deployment (app + pg-primary + pg-replica) | postgres/docker-compose.yml, postgres/docker-compose.replica.yml | Manual: deploy + health check |
| VPN networking between CVMs | postgres/ compose files (dstack VPN) | Manual: cross-CVM connectivity |
| Postgres primary/replica replication | postgres/docker-compose.replica.yml (streaming replication) | Manual: replica lag check |
| Database encryption (LUKS) | postgres/ compose files (LUKS-encrypted /data) | dstack KMS-managed |
| On-chain deletion attestations | enclave/src/deletion-attestation.ts, index.ts:127 (POST /delete-data) | CI: allowlist check |
| Version upgrade flow | Carried from v1 (already implemented) | CI: version tag deploy |
| Multi-CVM attestation comparison | Carried from v1 (scripts/compare-instances.sh) | Manual: TDX quote comparison |

## Changelog

| Date | Author | Changes |
|------|--------|---------|
| 2026-02-17 | LSDan | Initial draft — synthesized from Feb 3 dstack sync, Feb 9 Andrew/LSDan followup, and Telegram discussions. Supersedes version-upgrade-multi-machine.md |
| 2026-02-17 | LSDan | Resolved 4 open questions: Postgres 16, GH Actions cron pull for reports, on-chain deletion attestations, primary/replica topology. Expanded architecture to 3-CVM model (app + pg-primary + pg-replica) on VPN. Moved deletion attestations from Should Have to Must Have (requirement 6). |
| 2026-02-17 | LSDan | Resolved remaining 3 open questions: dstack built-in WireGuard via gateway URLs, allowlist approach for trust boundary (CI checks `tiktok-client.ts` + `deletion-attestation.ts`), stock `postgres:16-alpine`. All open questions now resolved. |
| 2026-02-23 | Claude | Implementation: wired up index.ts with all new endpoints, updated CI allowlist, created postgres compose files, pull-report workflow, verify-report script. Status → IMPLEMENTING. |
