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

func TestSignatureOf_DetectsModelAndCapabilityChanges(t *testing.T) {
	sigBase := SignatureOf("project-1", "user-1", "openai/gpt-5-mini", nil, nil, "")

	// Same inputs → same signature.
	if SignatureOf("project-1", "user-1", "openai/gpt-5-mini", nil, nil, "") != sigBase {
		t.Errorf("identical inputs should produce identical signatures")
	}
	// Model swap → different signature (worker must be recycled so the new model
	// is honored).
	if SignatureOf("project-1", "user-1", "anthropic/claude-opus", nil, nil, "") == sigBase {
		t.Errorf("model change must alter the signature")
	}
	// A capability becoming active → different signature (else a worker keeps a
	// stale capability's secret across a turn that no longer grants it). Capability
	// presence (not the secret, not a display label like GitHub login) is what folds
	// in — that mapping lives in each capability's SignatureKey, tested there.
	if SignatureOf("project-1", "user-1", "openai/gpt-5-mini", nil, []string{"github"}, "") == sigBase {
		t.Errorf("adding an active capability must alter the signature")
	}
	// The capability fingerprint is canonical — key order is irrelevant.
	if SignatureOf("project-1", "user-1", "m", nil, []string{"a", "b"}, "") != SignatureOf("project-1", "user-1", "m", nil, []string{"b", "a"}, "") {
		t.Errorf("capability key order must not affect the signature")
	}
}

func TestSignatureOf_BindsWorkerToProjectAndActor(t *testing.T) {
	base := SignatureOf("project-1", "user-a", "model", nil, nil, "")
	if SignatureOf("project-2", "user-a", "model", nil, nil, "") == base {
		t.Fatal("a worker must never be reusable by another project")
	}
	if SignatureOf("project-1", "user-b", "model", nil, nil, "") == base {
		t.Fatal("a worker must never be reusable by another actor")
	}
}

// A per-project egress allow-list change (ADR-043) must recycle the worker so a
// live worker never runs a stale egress policy; a semantically-equal list must
// NOT, or a benign re-save would needlessly kill the conversation's worker.
func TestSignatureOf_EgressAllowlistChangeRecyclesWorker(t *testing.T) {
	a := SignatureOf("project-1", "user-1", "", []string{"a.example.com"}, nil, "")
	b := SignatureOf("project-1", "user-1", "", []string{"b.example.com"}, nil, "")
	if a == b {
		t.Fatalf("changing the allow-list must change the signature (a=%+v b=%+v)", a, b)
	}

	// Reordering / case / trailing dot are the SAME policy — must NOT recycle.
	x := SignatureOf("project-1", "user-1", "", []string{"a.example.com", "B.example.com"}, nil, "")
	y := SignatureOf("project-1", "user-1", "", []string{"b.example.com.", "a.example.com"}, nil, "")
	if x != y {
		t.Fatalf("semantically-equal lists must share a signature (x=%+v y=%+v)", x, y)
	}

	// Setting a list where there was none is a change.
	none := SignatureOf("project-1", "user-1", "", nil, nil, "")
	some := SignatureOf("project-1", "user-1", "", []string{"a.example.com"}, nil, "")
	if none == some {
		t.Fatalf("adding an allow-list must change the signature")
	}
}

// A drifted/hostile envelope must not fold junk (a URL, an authority with a
// port/path/userinfo, or a "../../" traversal) into the egress fingerprint — it
// is dropped, so the signature is computed as if the junk were absent.
func TestSignatureOf_EgressAllowlistDropsMalformedEntries(t *testing.T) {
	none := SignatureOf("project-1", "user-1", "", nil, nil, "")

	// A list of only junk fingerprints identically to no list at all.
	junkOnly := SignatureOf("project-1", "user-1", "", []string{
		"../../etc/passwd",
		"https://evil.example.com/steal",
		"evil.example.com/steal",
		"evil.example.com:443",
		"user@evil.example.com",
		"has space.example",
		"under_score.example",
		"..",
	}, nil, "")
	if junkOnly != none {
		t.Fatalf("malformed-only allow-list must fingerprint as unset (got %+v want %+v)", junkOnly, none)
	}

	// A junk entry beside a valid one contributes nothing — same fingerprint as
	// the valid one alone.
	withJunk := SignatureOf("project-1", "user-1", "", []string{"../../etc", "registry.npmjs.org"}, nil, "")
	clean := SignatureOf("project-1", "user-1", "", []string{"registry.npmjs.org"}, nil, "")
	if withJunk != clean {
		t.Fatalf("a dropped junk entry must not change the fingerprint (got %+v want %+v)", withJunk, clean)
	}

	// A legitimate wildcard pattern survives validation.
	wild := SignatureOf("project-1", "user-1", "", []string{"*.internal.acme.com"}, nil, "")
	if wild == none {
		t.Fatalf("a valid wildcard pattern must be kept in the fingerprint")
	}
}

// The ADR-061 mirror tier rides the signature (the EgressAllowlist precedent): a
// tier change must recycle the worker so the relay re-registers with the new
// tier, while the empty envelope and an explicit "skip" — which mean the same
// thing, no mirror — must share a signature so a version skew never needlessly
// recycles a live worker.
func TestSignatureOf_MirrorTierChangeRecyclesWorker(t *testing.T) {
	content := SignatureOf("project-1", "user-1", "m", nil, nil, "content")
	structural := SignatureOf("project-1", "user-1", "m", nil, nil, "structural")
	skip := SignatureOf("project-1", "user-1", "m", nil, nil, "skip")

	if content == structural || content == skip || structural == skip {
		t.Fatalf("each mirror tier must produce a distinct signature (content=%+v structural=%+v skip=%+v)",
			content, structural, skip)
	}

	// Empty (no tier sent) and explicit "skip" both mean "no mirror" — same
	// signature, so an old control plane that sends nothing does not recycle a
	// worker a new one would have marked skip.
	empty := SignatureOf("project-1", "user-1", "m", nil, nil, "")
	if empty != skip {
		t.Fatalf("an empty tier must fingerprint as skip (empty=%+v skip=%+v)", empty, skip)
	}

	// An unrecognised tier is fail-safe: it normalises to skip, never to a
	// content-bearing tier.
	garbage := SignatureOf("project-1", "user-1", "m", nil, nil, "wide-open")
	if garbage != skip {
		t.Fatalf("an unrecognised tier must fingerprint as skip (garbage=%+v skip=%+v)", garbage, skip)
	}
}
