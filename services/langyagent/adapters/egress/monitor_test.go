package egress

import (
	"context"
	"net/http"
	"testing"
)

func testConfig() Config {
	c := DefaultConfig()
	c.AllowedHosts = []string{"gateway.internal", "api.github.com", "registry.npmjs.org"}
	return c
}

func TestScoreEgress(t *testing.T) {
	t.Parallel()
	cfg := testConfig()
	cases := []struct {
		name    string
		call    EgressCall
		flagged bool
		reason  FlagReason
	}{
		{
			name:    "allowed host over TLS is not flagged",
			call:    EgressCall{Host: "api.github.com", Port: 443, TLS: true},
			flagged: false,
			reason:  FlagNone,
		},
		{
			name:    "allowed subdomain over TLS is not flagged",
			call:    EgressCall{Host: "codeload.api.github.com", Port: 443, TLS: true},
			flagged: false,
			reason:  FlagNone,
		},
		{
			name:    "unexpected host is flagged",
			call:    EgressCall{Host: "evil.example.com", Port: 443, TLS: true},
			flagged: true,
			reason:  FlagUnexpectedHost,
		},
		{
			name:    "plaintext to an allowed external host is flagged",
			call:    EgressCall{Host: "api.github.com", Port: 80, TLS: false},
			flagged: true,
			reason:  FlagPlaintext,
		},
		{
			name:    "private-range IP is flagged",
			call:    EgressCall{Host: "10.1.2.3", Port: 443, TLS: true},
			flagged: true,
			reason:  FlagPrivateRange,
		},
		{
			name:    "192.168 private-range IP is flagged",
			call:    EgressCall{Host: "192.168.5.5", Port: 443, TLS: true},
			flagged: true,
			reason:  FlagPrivateRange,
		},
		{
			name:    "cloud metadata IP is flagged as metadata (not just private)",
			call:    EgressCall{Host: "169.254.169.254", Port: 80, TLS: false},
			flagged: true,
			reason:  FlagMetadata,
		},
		{
			name:    "large upload to an allowed host is flagged as exfil shape",
			call:    EgressCall{Host: "api.github.com", Port: 443, TLS: true, BytesUp: 100 << 20},
			flagged: true,
			reason:  FlagLargeUpload,
		},
		{
			name:    "high distinct-host fan-out is flagged",
			call:    EgressCall{Host: "api.github.com", Port: 443, TLS: true, DistinctHostsThisTurn: 50},
			flagged: true,
			reason:  FlagHighFanout,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := ScoreEgress(cfg, tc.call)
			if got.Flagged != tc.flagged || got.Reason != tc.reason {
				t.Fatalf("ScoreEgress(%+v) = {%v %q}, want {%v %q}",
					tc.call, got.Flagged, got.Reason, tc.flagged, tc.reason)
			}
		})
	}
}

// blockingBase records whether it was ever invoked, to prove the instrumented
// transport NEVER blocks — even a flagged call must still reach the base.
type recordingBase struct{ called bool }

func (b *recordingBase) RoundTrip(req *http.Request) (*http.Response, error) {
	b.called = true
	return &http.Response{StatusCode: 200, Body: http.NoBody, ContentLength: 0, Request: req}, nil
}

func TestInstrumentedRoundTripperNeverBlocks(t *testing.T) {
	t.Parallel()
	base := &recordingBase{}
	rt := NewInstrumentedRoundTripper(base, testConfig())

	// A deliberately suspicious destination (unexpected host, plaintext).
	req, _ := http.NewRequestWithContext(
		context.Background(), http.MethodPost, "http://evil.example.com/exfil", http.NoBody)
	resp, err := rt.RoundTrip(req)
	if err != nil {
		t.Fatalf("RoundTrip returned error: %v", err)
	}
	if resp == nil || resp.StatusCode != 200 {
		t.Fatalf("expected the base to be called and return 200")
	}
	if !base.called {
		t.Fatal("flagged egress was blocked — PR3 must observe only, never block")
	}
}
