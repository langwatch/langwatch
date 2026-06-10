//go:build live_staged_payload

// Live verification of the staged-payload SSRF guard + fetch against a REAL
// S3 presigned URL. Gated behind the `live_staged_payload` build tag and the
// DOGFOOD_STAGED_URL env var so it never runs in normal CI. It proves the
// guard accepts the actual host shape our SDK/aws-cli presigner emits and that
// the fetch round-trips the body.
//
// Run:
//
//	DOGFOOD_STAGED_URL='https://<bucket>.s3.<region>.amazonaws.com/<key>?X-Amz-...' \
//	  go test -tags live_staged_payload ./services/nlpgo/adapters/httpapi/ \
//	  -run StagedPayloadLive -count=1 -v
package httpapi

import (
	"context"
	"os"
	"testing"
)

func TestStagedPayloadLive_ValidateAndFetch(t *testing.T) {
	url := os.Getenv("DOGFOOD_STAGED_URL")
	if url == "" {
		t.Skip("DOGFOOD_STAGED_URL not set; skipping live staged-payload test")
	}

	if err := validateStagedPayloadURL(url); err != nil {
		t.Fatalf("SSRF guard REJECTED a real presigned URL (guard too strict): %v", err)
	}
	t.Logf("SSRF guard accepted the real presigned URL")

	body, err := fetchStagedPayload(context.Background(), stagedPayloadClient, url, maxStagedPayloadBytes)
	if err != nil {
		t.Fatalf("fetchStagedPayload error: %v", err)
	}
	if len(body) == 0 {
		t.Fatal("fetched body is empty")
	}
	t.Logf("LIVE fetch OK: %d bytes, head=%q", len(body), string(body[:min(len(body), 120)]))
}
