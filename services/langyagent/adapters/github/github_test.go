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

// A host other than github.com turns the token into gh's enterprise-host set, a
// git rewrite of github.com URLs to that host, and a NO_PROXY entry for it.
//
// @scenario "Langy's worker reaches githubsim when the stack names it as the GitHub host"
func TestCapability_ContributeWithHost(t *testing.T) {
	t.Run("when the host is a stand-in", func(t *testing.T) {
		got := map[string]string{}
		for _, kv := range New("ghs_sim", "alice", "s").WithHost("github.dev.localhost:1355").Contribute() {
			k, v, _ := strings.Cut(kv, "=")
			got[k] = v
		}
		want := map[string]string{
			"GH_HOST": "github.dev.localhost:1355", "GH_ENTERPRISE_TOKEN": "ghs_sim", "GITHUB_LOGIN": "alice",
			"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "url.https://github.dev.localhost:1355/.insteadOf",
			"GIT_CONFIG_VALUE_0": "https://github.com/", "NO_PROXY": "github.dev.localhost",
		}
		for k, v := range want {
			if got[k] != v {
				t.Errorf("env[%s] = %q, want %q", k, got[k], v)
			}
		}
		if _, ok := got["GH_TOKEN"]; ok {
			t.Errorf("GH_TOKEN must not ride beside GH_ENTERPRISE_TOKEN")
		}
	})

	t.Run("when the host is blank or github.com", func(t *testing.T) {
		for _, host := range []string{"", "github.com"} {
			if env := New("t", "l", "s").WithHost(host).Contribute(); len(env) != 2 || env[0] != "GH_TOKEN=t" {
				t.Errorf("host %q: want production GH_TOKEN env, got %v", host, env)
			}
		}
	})

	t.Run("when there is no token", func(t *testing.T) {
		if env := New("", "l", "s").WithHost("github.dev.localhost").Contribute(); env != nil {
			t.Errorf("an empty token must contribute nothing, got %v", env)
		}
	})
}
