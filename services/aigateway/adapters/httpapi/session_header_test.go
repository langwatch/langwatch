package httpapi

import (
	"net/http"
	"testing"
)

// Verifies the gateway lifts each CLI's session id from the right request
// header (the values are the real ones captured on the Path A wire), and that
// gemini's stable device id is NOT mistaken for a session id.
func TestClientSessionIDFromHeaders(t *testing.T) {
	cases := []struct {
		name    string
		headers map[string]string
		want    string
	}{
		{"claude-code", map[string]string{"X-Claude-Code-Session-Id": "c5923cc7-b7b8-4909-b7e6-52d645acb035"}, "c5923cc7-b7b8-4909-b7e6-52d645acb035"},
		{"codex", map[string]string{"Session-Id": "019e9bc8-251b-7960-89d6-f9aa6332874a"}, "019e9bc8-251b-7960-89d6-f9aa6332874a"},
		{"opencode", map[string]string{"X-Session-Affinity": "ses_16435e991ffeYybVvoI3A6F8HB"}, "ses_16435e991ffeYybVvoI3A6F8HB"},
		{"gemini device id is not a session", map[string]string{"X-Gemini-Api-Privileged-User-Id": "0ac63097-3073-4880-b45f-75a06b203456"}, ""},
		{"none", map[string]string{}, ""},
		{"claude wins over a generic session-id", map[string]string{
			"X-Claude-Code-Session-Id": "claude-1",
			"Session-Id":               "generic-2",
		}, "claude-1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := http.Header{}
			for k, v := range tc.headers {
				h.Set(k, v)
			}
			if got := clientSessionIDFromHeaders(h); got != tc.want {
				t.Fatalf("clientSessionIDFromHeaders = %q, want %q", got, tc.want)
			}
		})
	}
}
