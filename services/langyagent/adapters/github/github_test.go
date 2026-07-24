package github

import (
	"strings"
	"testing"
)

// A token-bearing capability injects GH_TOKEN + GITHUB_LOGIN; an empty token
// makes it inert (nil), which is how "this turn has no GitHub access" is carried.
func TestCapability_Contribute(t *testing.T) {
	t.Run("when a token is present", func(t *testing.T) {
		env := New("ghp_real", "alice", "scope1").Contribute()
		want := map[string]string{"GH_TOKEN": "ghp_real", "GITHUB_LOGIN": "alice"}
		got := map[string]string{}
		for _, kv := range env {
			if k, v, ok := strings.Cut(kv, "="); ok {
				got[k] = v
			}
		}
		for k, v := range want {
			if got[k] != v {
				t.Errorf("env[%s] = %q, want %q", k, got[k], v)
			}
		}
		if len(env) != 2 {
			t.Errorf("expected exactly GH_TOKEN + GITHUB_LOGIN, got %v", env)
		}
	})

	t.Run("when there is no token", func(t *testing.T) {
		if env := New("", "alice", "scope1").Contribute(); env != nil {
			t.Errorf("an empty token must contribute nothing, got %v", env)
		}
	})
}

func TestCapability_Name(t *testing.T) {
	if New("t", "l", "s").Name() != "github" {
		t.Errorf("Name = %q, want github", New("t", "l", "s").Name())
	}
}

// SignatureKey encodes GitHub PRESENCE + repository scope (never the token), and
// must be in lockstep with Contribute: active exactly when Contribute is non-nil,
// independent of the token value + login label, but SENSITIVE to the repo scope
// key so a scope change recycles the worker.
func TestCapability_SignatureKey(t *testing.T) {
	if got := New("ghp_real", "alice", "").SignatureKey(); got != "github" {
		t.Errorf("SignatureKey with a token, no scope = %q, want github", got)
	}
	if got := New("ghp_real", "alice", "scope1").SignatureKey(); got != "github:scope1" {
		t.Errorf("SignatureKey with a scope = %q, want github:scope1", got)
	}
	if got := New("", "alice", "scope1").SignatureKey(); got != "" {
		t.Errorf("SignatureKey without a token = %q, want empty", got)
	}
	// Presence-only for the secret: a different token or login yields the SAME
	// key when the scope matches.
	if New("ghp_one", "alice", "s").SignatureKey() != New("ghp_two", "bob", "s").SignatureKey() {
		t.Errorf("SignatureKey must not depend on the token value or login")
	}
	// But a different scope MUST yield a different key so the worker re-warms.
	if New("ghp_one", "alice", "s1").SignatureKey() == New("ghp_one", "alice", "s2").SignatureKey() {
		t.Errorf("SignatureKey must change when the repo scope changes")
	}
}
