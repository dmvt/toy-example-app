# Toy Example App - Development Guide

## Claude Expertise Profile

Expert TEE/security engineer with deep knowledge of Intel TDX attestation, Phala Cloud dstack enclaves, Base KMS on-chain transparency logging, and secure release processes for privacy-preserving applications. Experienced with TypeScript/Node.js, Docker reproducible builds, and GitHub Actions CI/CD for enclave deployments.

---

## CRITICAL DIRECTIVES

**These rules must NEVER be violated:**

1. **No direct_messages API calls in enclave code.** The enclave must NEVER contain `direct_messages` API calls, fetch patterns, or non-comment references to DM endpoints. This is the core security invariant of the entire project. The CI build verifies this automatically.

2. **No secrets in source control.** API keys, tokens, signing keys, and private keys must only exist in GitHub Actions secrets or environment variables. Never commit `.env` files, credentials, or key material.

3. **No deployment without attestation verification.** Never deploy to production without the build pipeline's security verification passing. Manual deployments must also verify compose hash integrity.

4. **Trust boundary integrity.** Only `tiktok-client.ts` may make external API calls from the enclave. No other file in `enclave/src/` should contain `fetch()` calls or HTTP client usage. The CI build verifies this.

---

## Project Overview

**Toy Example App** - A simplified dstack TEE application demonstrating the complete release process for Phala Cloud enclaves. Proves that an enclave receiving full API credentials is architecturally constrained to only access safe endpoints (watch history), and cannot access sensitive endpoints (direct messages).

### Core Components

| Component | Description | Location |
|-----------|-------------|----------|
| Mock TikTok API | Express server with safe + sensitive endpoints | `mock-api/` |
| TEE Enclave | Node.js app running in Intel TDX, only calls safe endpoint | `enclave/` |
| CI/CD Pipeline | Build, verify, deploy to Phala Cloud | `.github/workflows/` |
| Specification | Approved feature spec | `docs/specs/toy-example-app.md` |
| Release Docs | Verification report, checklist, tweet content | `docs/` |

### Architecture

```
External (Untrusted)          Trust Boundary (TCB)
├── Mock TikTok API :3000     ├── dstack Enclave (Intel TDX)
│   ├── /api/watch_history    │   ├── Toy App :8080
│   └── /api/direct_messages  │   │   └── Only calls watch_history
└── Verifier / Auditor        │   └── Metadata :8090 (attestation)
                              └── Base Contract (on-chain audit log)
```

---

## Build Commands

```bash
# Enclave
cd enclave && npm run build    # TypeScript compile
cd enclave && npm run dev       # Dev mode (ts-node)

# Mock API
cd mock-api && npm run build    # TypeScript compile
cd mock-api && npm run dev      # Dev mode (ts-node)

# Docker
docker build -t toy-example-enclave enclave/
docker build -t toy-example-mock-api mock-api/
```

---

## Test Commands

```bash
# Security verification (same as CI)
grep -rE '(/api/direct_messages|getDirectMessages|fetchDirectMessages|\.direct_messages)' enclave/src/*.ts
# Should return NO results

# Verify only tiktok-client.ts makes fetch calls
grep -rl "fetch(" enclave/src/
# Should only show tiktok-client.ts
```

---

## GitHub Actions Secrets Required

| Secret | Purpose |
|--------|---------|
| `PHALA_CLOUD_API_KEY` | Phala Cloud API authentication |
| `TOY_MOCK_API_URL` | Mock API URL for enclave |
| `TOY_MOCK_API_TOKEN` | Mock API auth token |
| `TOY_SIGNING_KEY` | Enclave signing key |
| `GHCR_PAT` | GitHub Container Registry PAT (for private image pulls) |
| `TOY_DEPLOYER_PRIVATE_KEY` | Ethereum key for Base KMS on-chain logging |
| `TOY_NODE_ID_PROD5` | Phala node ID for prod5 (production only) |
| `TOY_NODE_ID_PROD9` | Phala node ID for prod9 (production only) |

---

## Slash Commands

| Command | Description |
|---------|-------------|
| `/warmup` | Initialize session context |
| `/spec` | Create and refine specifications |
| `/generate` | Generate code from specifications |
| `/doc` | Edit documents with collaborative refinement |
| `/reconcile` | Sync specs, code, and documentation |
| `/audit` | Project health check |

---

## Development Workflow

1. Create specification: `/spec create <feature>`
2. Refine until approved: `/spec refine docs/specs/<feature>.md`
3. Generate implementation: `/generate docs/specs/<feature>.md`
4. Document: `/doc README.md` or `/doc docs/<file>.md`
5. Verify consistency: `/reconcile all`
6. Health check: `/audit`
