package customertracebridge

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Gateway-level canonicalization test for the session/thread id element.
// Fixtures are the REAL values each CLI puts on the Path A wire (captured via
// the logging proxy in .claude/dogfood-evidence/8cell-2026-06-06/<tool>-A/):
//   - claude-code: X-Claude-Code-Session-Id header == body metadata.user_id.session_id
//   - codex:       Session-Id header == body prompt_cache_key
//   - opencode:    X-Session-Affinity header (body carries none)
//   - gemini-cli:  nothing on the gateway wire (only a stable device id)
//
// The header is stashed on the context by the gateway middleware
// (clientSessionIDFromHeaders -> WithClientSessionID); the body fallback covers
// the two tools that also echo it inline. To validate a NEW element in future,
// add a row here AND in the matching pipeline-level (Path B) test.
func TestClientSessionID_perTool(t *testing.T) {
	const (
		claudeSID   = "c5923cc7-b7b8-4909-b7e6-52d645acb035"
		codexSID    = "019e9bc8-251b-7960-89d6-f9aa6332874a"
		opencodeSID = "ses_16435e991ffeYybVvoI3A6F8HB"
	)
	cases := []struct {
		name     string
		headerID string // what the middleware lifted from headers (empty = header stripped)
		reqType  domain.RequestType
		body     string
		want     string
	}{
		{"claude header", claudeSID, domain.RequestTypeMessages, `{}`, claudeSID},
		{
			"claude body fallback when header absent",
			"", domain.RequestTypeMessages,
			`{"metadata":{"user_id":"{\"device_id\":\"abc\",\"account_uuid\":\"\",\"session_id\":\"` + claudeSID + `\"}"}}`,
			claudeSID,
		},
		{"codex header", codexSID, domain.RequestTypeResponses, `{}`, codexSID},
		{"codex body fallback (prompt_cache_key)", "", domain.RequestTypeResponses, `{"prompt_cache_key":"` + codexSID + `"}`, codexSID},
		{"opencode header only", opencodeSID, domain.RequestTypeMessages, `{}`, opencodeSID},
		{"gemini sends no session id on the gateway wire", "", domain.RequestTypePassthrough, `{"contents":[]}`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			if tc.headerID != "" {
				ctx = WithClientSessionID(ctx, tc.headerID)
			}
			got := clientSessionID(ctx, domain.AITraceParams{
				RequestType: tc.reqType,
				RequestBody: []byte(tc.body),
			})
			if got != tc.want {
				t.Fatalf("clientSessionID = %q, want %q", got, tc.want)
			}
		})
	}
}
