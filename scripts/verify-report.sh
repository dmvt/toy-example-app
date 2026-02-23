#!/usr/bin/env bash
# Verify a retrospective report's structure and signature format.
#
# @spec docs/specs/toy-app-v3.md
# @implements Requirement 2 (offline report verification)
#
# Usage: ./scripts/verify-report.sh reports/2026-02-23.json
#
# Checks:
# 1. Valid JSON with required fields
# 2. HMAC signature is present and properly formatted
# 3. Report structure matches expected schema
#
# NOTE: Full cryptographic verification requires the enclave's signing key.
# This script validates structure; signature verification against the
# enclave's attestation is done by comparing the HMAC with the key
# from the attested enclave's /version endpoint.

set -euo pipefail

REPORT_FILE="${1:?Usage: verify-report.sh <report-file.json>}"

if [ ! -f "$REPORT_FILE" ]; then
  echo "ERROR: Report file not found: $REPORT_FILE"
  exit 1
fi

echo "Verifying report: $REPORT_FILE"
echo "---"

# Check valid JSON
if ! jq empty "$REPORT_FILE" 2>/dev/null; then
  echo "FAIL: Not valid JSON"
  exit 1
fi
echo "OK: Valid JSON"

# Check required fields
REQUIRED_FIELDS=("reportId" "generatedAt" "timeWindow" "enclaveVersion" "composeHash" "summary" "signature")
for field in "${REQUIRED_FIELDS[@]}"; do
  if ! jq -e ".$field" "$REPORT_FILE" > /dev/null 2>&1; then
    echo "FAIL: Missing required field: $field"
    exit 1
  fi
done
echo "OK: All required fields present"

# Check summary sub-fields
SUMMARY_FIELDS=("totalUsersProcessed" "totalSafeApiCalls" "totalSignups" "auditLogDigest")
for field in "${SUMMARY_FIELDS[@]}"; do
  if ! jq -e ".summary.$field" "$REPORT_FILE" > /dev/null 2>&1; then
    echo "FAIL: Missing summary field: $field"
    exit 1
  fi
done
echo "OK: Summary fields complete"

# Check signature format
SIG=$(jq -r '.signature' "$REPORT_FILE")
if [[ ! "$SIG" =~ ^hmac:[a-f0-9]{64}$ ]]; then
  echo "FAIL: Signature format invalid (expected hmac:<64-hex-chars>)"
  exit 1
fi
echo "OK: Signature format valid (hmac:sha256)"

# Check audit log digest format
DIGEST=$(jq -r '.summary.auditLogDigest' "$REPORT_FILE")
if [[ ! "$DIGEST" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  echo "FAIL: Audit log digest format invalid"
  exit 1
fi
echo "OK: Audit log digest format valid"

# Display report summary
echo "---"
echo "Report ID:    $(jq -r '.reportId' "$REPORT_FILE")"
echo "Generated:    $(jq -r '.generatedAt' "$REPORT_FILE")"
echo "Version:      $(jq -r '.enclaveVersion' "$REPORT_FILE")"
echo "Compose Hash: $(jq -r '.composeHash' "$REPORT_FILE")"
echo "Users:        $(jq -r '.summary.totalUsersProcessed' "$REPORT_FILE")"
echo "Signups:      $(jq -r '.summary.totalSignups' "$REPORT_FILE")"
echo "API Calls:    $(jq -r '.summary.totalSafeApiCalls' "$REPORT_FILE")"
echo "---"
echo "PASS: Report structure verified"
