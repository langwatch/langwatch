package domain

import (
	"strings"
	"testing"
)

func TestIsValidConversationID(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		{"abc", true},
		{"conv-1", true},
		{"conv_1", true},
		{"A1B2c3", true},
		{strings.Repeat("a", 128), true},

		{"", false},
		{strings.Repeat("a", 129), false},
		{"../etc", false},
		{"a/b", false},
		{"a b", false},
		{"a.b", false},
		{"a;b", false},
		{"a\nb", false},
	}
	for _, c := range cases {
		if got := IsValidConversationID(c.in); got != c.want {
			t.Errorf("IsValidConversationID(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestSignatureOf_DetectsModelAndGithubChanges(t *testing.T) {
	base := Credentials{Model: "openai/gpt-5-mini"}
	sigBase := SignatureOf(base)

	// Same model + no GH → same signature.
	if SignatureOf(Credentials{Model: "openai/gpt-5-mini"}) != sigBase {
		t.Errorf("identical credentials should produce identical signatures")
	}
	// Model swap → different signature (worker must be recycled so the new
	// model is honored).
	if SignatureOf(Credentials{Model: "anthropic/claude-opus"}) == sigBase {
		t.Errorf("model change must alter the signature")
	}
	// GH token added → different signature (or worker keeps a stale token across
	// a PR-cap-denied turn).
	if SignatureOf(Credentials{Model: "openai/gpt-5-mini", GithubToken: "tok"}) == sigBase {
		t.Errorf("adding a GH token must alter the signature")
	}
	// GH login alone is a label, not a capability — login changes without a
	// token must NOT force a recycle. Assert explicitly so a future edit can't
	// silently widen the signature.
	withLogin := Credentials{Model: "openai/gpt-5-mini", GithubLogin: "alice"}
	if SignatureOf(withLogin) != sigBase {
		t.Errorf("GithubLogin alone must NOT alter the signature")
	}
}

// A per-project egress allow-list change (ADR-043) must recycle the worker so a
// live worker never runs a stale egress policy; a semantically-equal list must
// NOT, or a benign re-save would needlessly kill the conversation's worker.
func TestSignatureOf_EgressAllowlistChangeRecyclesWorker(t *testing.T) {
	a := SignatureOf(Credentials{EgressAllowlist: []string{"a.example.com"}})
	b := SignatureOf(Credentials{EgressAllowlist: []string{"b.example.com"}})
	if a == b {
		t.Fatalf("changing the allow-list must change the signature (a=%+v b=%+v)", a, b)
	}

	// Reordering / case / trailing dot are the SAME policy — must NOT recycle.
	x := SignatureOf(Credentials{EgressAllowlist: []string{"a.example.com", "B.example.com"}})
	y := SignatureOf(Credentials{EgressAllowlist: []string{"b.example.com.", "a.example.com"}})
	if x != y {
		t.Fatalf("semantically-equal lists must share a signature (x=%+v y=%+v)", x, y)
	}

	// Setting a list where there was none is a change.
	none := SignatureOf(Credentials{})
	some := SignatureOf(Credentials{EgressAllowlist: []string{"a.example.com"}})
	if none == some {
		t.Fatalf("adding an allow-list must change the signature")
	}
}

// A drifted/hostile envelope must not fold junk (a URL, an authority with a
// port/path/userinfo, or a "../../" traversal) into the egress fingerprint — it
// is dropped, so the signature is computed as if the junk were absent.
func TestSignatureOf_EgressAllowlistDropsMalformedEntries(t *testing.T) {
	none := SignatureOf(Credentials{})

	// A list of only junk fingerprints identically to no list at all.
	junkOnly := SignatureOf(Credentials{EgressAllowlist: []string{
		"../../etc/passwd",
		"https://evil.example.com/steal",
		"evil.example.com/steal",
		"evil.example.com:443",
		"user@evil.example.com",
		"has space.example",
		"under_score.example",
		"..",
	}})
	if junkOnly != none {
		t.Fatalf("malformed-only allow-list must fingerprint as unset (got %+v want %+v)", junkOnly, none)
	}

	// A junk entry beside a valid one contributes nothing — same fingerprint as
	// the valid one alone.
	withJunk := SignatureOf(Credentials{EgressAllowlist: []string{"../../etc", "registry.npmjs.org"}})
	clean := SignatureOf(Credentials{EgressAllowlist: []string{"registry.npmjs.org"}})
	if withJunk != clean {
		t.Fatalf("a dropped junk entry must not change the fingerprint (got %+v want %+v)", withJunk, clean)
	}

	// A legitimate wildcard pattern survives validation.
	wild := SignatureOf(Credentials{EgressAllowlist: []string{"*.internal.acme.com"}})
	if wild == none {
		t.Fatalf("a valid wildcard pattern must be kept in the fingerprint")
	}
}

func TestCredentials_Complete(t *testing.T) {
	full := Credentials{
		LangwatchAPIKey:   "k",
		LLMVirtualKey:     "vk",
		GatewayBaseURL:    "https://gw",
		LangwatchEndpoint: "https://app",
	}
	if !full.Complete() {
		t.Fatalf("fully-populated credentials should be Complete")
	}
	missing := []Credentials{
		{LLMVirtualKey: "vk", GatewayBaseURL: "g", LangwatchEndpoint: "e"},
		{LangwatchAPIKey: "k", GatewayBaseURL: "g", LangwatchEndpoint: "e"},
		{LangwatchAPIKey: "k", LLMVirtualKey: "vk", LangwatchEndpoint: "e"},
		{LangwatchAPIKey: "k", LLMVirtualKey: "vk", GatewayBaseURL: "g"},
		{},
	}
	for i, c := range missing {
		if c.Complete() {
			t.Errorf("case %d: credentials missing a required field should not be Complete", i)
		}
	}
}
