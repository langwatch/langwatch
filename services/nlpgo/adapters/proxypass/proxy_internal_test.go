package proxypass

import (
	"net/url"
	"testing"
)

// TestProbeAddress_ResolvesSchemeDefaultPort pins the CR fix for cold-
// start probes against bare-hostname upstream URLs. url.URL.Host omits
// the default port (http://example.com → "example.com" with no ":80"),
// and net.DialTimeout requires "host:port" — so before this helper,
// every probe against such a URL failed with "missing port in address"
// and the cold-start preamble silently 503'd through the full
// ColdStartWait window. Production currently always passes
// http://127.0.0.1:5561 (explicit port), but configuration drift or a
// future caller could trip this; the helper keeps the contract honest.
func TestProbeAddress_ResolvesSchemeDefaultPort(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"explicit ipv4 port preserved", "http://127.0.0.1:5561", "127.0.0.1:5561"},
		{"explicit hostname port preserved", "http://upstream.local:8080", "upstream.local:8080"},
		{"bare hostname http defaults to 80", "http://example.com", "example.com:80"},
		{"bare hostname https defaults to 443", "https://example.com", "example.com:443"},
		{"http path component does not leak into host", "http://example.com/studio/execute", "example.com:80"},
		{"ipv6 with explicit port preserved", "http://[::1]:5561", "[::1]:5561"},
		{"ipv6 bare http defaults to 80", "http://[2001:db8::1]/", "[2001:db8::1]:80"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u, err := url.Parse(tc.raw)
			if err != nil {
				t.Fatalf("url.Parse(%q): %v", tc.raw, err)
			}
			got, err := probeAddress(u)
			if err != nil {
				t.Fatalf("probeAddress(%q): unexpected error %v", tc.raw, err)
			}
			if got != tc.want {
				t.Errorf("probeAddress(%q) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

// TestProbeAddress_RejectsUnknownSchemeWithoutPort pins the surfaced
// startup error for misconfigured URLs. A bare hostname under an
// unrecognised scheme has no obvious default port to fill in, so we
// fail loud at New() rather than silently failing every probe at
// runtime — the latter mode is exactly what hid the bug CR flagged.
func TestProbeAddress_RejectsUnknownSchemeWithoutPort(t *testing.T) {
	cases := []string{
		"ftp://example.com",
		"gopher://upstream.local",
		"://example.com", // missing scheme
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			u, err := url.Parse(raw)
			if err != nil {
				// url.Parse may itself reject some shapes; that's still
				// a valid loud-fail outcome from the caller's POV.
				return
			}
			if _, err := probeAddress(u); err == nil {
				t.Errorf("probeAddress(%q) returned no error; expected an unsupported-scheme rejection", raw)
			}
		})
	}
}
