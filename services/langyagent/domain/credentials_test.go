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
