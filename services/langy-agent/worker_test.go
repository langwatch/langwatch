package langyagent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFilterSensitiveEnv_RemovesManagerSecrets(t *testing.T) {
	// Snapshot original env so we can restore after the test.
	for k, v := range map[string]string{
		"LANGY_INTERNAL_SECRET":    "must-not-leak",
		"GITHUB_LANGY_APP_ID":      "must-not-leak",
		"CREDENTIALS_SECRET":       "must-not-leak",
		"NEXTAUTH_URL":             "must-not-leak",
		"NEXTAUTH_SECRET":          "must-not-leak",
		"DATABASE_URL":             "must-not-leak",
		"AWS_SECRET_ACCESS_KEY":    "must-not-leak",
		"LANGY_MAX_WORKERS":        "keep-me", // LANGY_ prefix but not the secret one
		"OPENCODE_AGENT_URL":       "keep-me",
		"OPENCODE_OTLP_ENDPOINT":   "keep-me",
		"HOME":                     "keep-me",
		"LANGWATCH_API_KEY_OUTER":  "keep-me", // worker injects its own LANGWATCH_API_KEY after
	} {
		t.Setenv(k, v)
	}

	env := filterSensitiveEnv()

	mustBeAbsent := []string{
		"LANGY_INTERNAL_SECRET=",
		"GITHUB_LANGY_APP_ID=",
		"CREDENTIALS_SECRET=",
		"NEXTAUTH_URL=",
		"NEXTAUTH_SECRET=",
		"DATABASE_URL=",
		"AWS_SECRET_ACCESS_KEY=",
	}
	for _, prefix := range mustBeAbsent {
		for _, kv := range env {
			if strings.HasPrefix(kv, prefix) {
				t.Errorf("env still contains %s (full: %q)", prefix, kv)
			}
		}
	}

	mustBePresent := []string{
		"LANGY_MAX_WORKERS=keep-me",
		"OPENCODE_AGENT_URL=keep-me",
		"OPENCODE_OTLP_ENDPOINT=keep-me",
		"LANGWATCH_API_KEY_OUTER=keep-me",
	}
	for _, want := range mustBePresent {
		found := false
		for _, kv := range env {
			if kv == want {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("env missing expected entry %q", want)
		}
	}

	// Sanity: filterSensitiveEnv must never return an empty slice in
	// realistic envs — PATH at minimum is always set.
	if len(env) == 0 {
		t.Fatalf("filterSensitiveEnv returned empty slice; PATH was %q", os.Getenv("PATH"))
	}
}

func TestOpenCodeSkillsDir_UnderOpenCodeConfig(t *testing.T) {
	// opencode only discovers global skills under $HOME/.config/opencode/skills.
	// If the spawn path ever links them anywhere else (the original bug linked
	// $HOME/skills), opencode shows an empty skill menu. Lock the location.
	home := "/home/worker-123"
	got := openCodeSkillsDir(home)
	want := filepath.Join(home, ".config", "opencode", "skills")
	if got != want {
		t.Fatalf("openCodeSkillsDir = %q, want %q", got, want)
	}
}

func TestSkillsSymlink_PointsAtSharedTemplateDir(t *testing.T) {
	// Replicates the symlink setupWorkerHome creates, minus the root-only
	// chowns: the link at opencode's skills dir must resolve to the shared,
	// root-owned /workspace/skills tree so every worker reads the same skills.
	home := t.TempDir()
	if err := os.MkdirAll(filepath.Join(home, ".config", "opencode"), 0o755); err != nil {
		t.Fatalf("mkdir config: %v", err)
	}
	link := openCodeSkillsDir(home)
	if err := os.Symlink("/workspace/skills", link); err != nil {
		t.Fatalf("symlink: %v", err)
	}
	target, err := os.Readlink(link)
	if err != nil {
		t.Fatalf("readlink: %v", err)
	}
	if target != "/workspace/skills" {
		t.Errorf("skills link target = %q, want /workspace/skills", target)
	}
}
