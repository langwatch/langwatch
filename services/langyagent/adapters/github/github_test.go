package github

import (
	"strings"
	"testing"
)

// A token-bearing capability injects GH_TOKEN + GITHUB_LOGIN; an empty token
// makes it inert (nil), which is how "this turn has no GitHub access" is carried.
func TestCapability_Contribute(t *testing.T) {
	t.Run("when a token is present", func(t *testing.T) {
		env := New("ghp_real", "alice").Contribute()
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
		if env := New("", "alice").Contribute(); env != nil {
			t.Errorf("an empty token must contribute nothing, got %v", env)
		}
	})
}

func TestCapability_Name(t *testing.T) {
	if New("t", "l").Name() != "github" {
		t.Errorf("Name = %q, want github", New("t", "l").Name())
	}
}
