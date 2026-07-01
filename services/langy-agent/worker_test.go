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
		"LANGY_INTERNAL_SECRET":      "must-not-leak",
		"GITHUB_LANGY_APP_ID":        "must-not-leak",
		"CREDENTIALS_SECRET":         "must-not-leak",
		"NEXTAUTH_URL":               "must-not-leak",
		"NEXTAUTH_SECRET":            "must-not-leak",
		"DATABASE_URL":               "must-not-leak",
		"AWS_SECRET_ACCESS_KEY":      "must-not-leak",
		// Suffix patterns: any *_API_KEY / *_KEY / *_SECRET inherited from a
		// local-dev .env must not reach the worker. The worker gets its own
		// llmVirtualKey + langwatchApiKey injected via Credentials.* after.
		"OPENAI_API_KEY":             "must-not-leak",
		"ANTHROPIC_API_KEY":          "must-not-leak",
		"GROQ_API_KEY":               "must-not-leak",
		"AZURE_OPENAI_API_KEY":       "must-not-leak",
		"SENDGRID_API_KEY":           "must-not-leak",
		"API_TOKEN_JWT_SECRET":       "must-not-leak",
		"LW_GATEWAY_INTERNAL_SECRET": "must-not-leak",
		"LW_GATEWAY_JWT_SECRET":      "must-not-leak",
		"LW_VIRTUAL_KEY_PEPPER":      "must-not-leak",
		// New suffix patterns: credential-bearing connection strings, DSNs,
		// and the AWS_ACCESS_KEY_ID half of an AWS credential pair (ends in
		// `_ID`, not `_KEY`, so the suffix block needs an explicit literal).
		"REDIS_URL":                  "redis://user:secret@host:6379/0",
		"POSTGRES_URL":               "postgres://user:secret@host:5432/db",
		"CLICKHOUSE_URL":             "https://user:secret@host:8443/db",
		"MONGODB_URI":                "mongodb://user:secret@host:27017/db",
		"SENTRY_DSN":                 "https://abc123@o123.ingest.sentry.io/456",
		"AWS_ACCESS_KEY_ID":          "AKIA_must_not_leak",
		"GH_TOKEN":                   "ghp_inherited_must_not_leak",
		"GITHUB_TOKEN":               "ghp_ci_token_must_not_leak",
		"POSTGRES_PASSWORD":          "must-not-leak",
		// PASS-THROUGH cases: only entries WITHOUT credentials and without a
		// blocked suffix. The OPENCODE_* env values the worker actually needs
		// (OPENCODE_OTLP_ENDPOINT etc.) are explicitly re-injected by
		// spawnOpenCode AFTER this filter runs, so filtering the inherited
		// variants is correct.
		"LANGY_MAX_WORKERS":          "keep-me", // LANGY_ prefix but not the secret one
		"HOME":                       "keep-me",
		"LANGWATCH_API_KEY_OUTER":    "keep-me", // worker injects its own LANGWATCH_API_KEY after; the _OUTER suffix is neither _KEY nor _SECRET
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
		"OPENAI_API_KEY=",
		"ANTHROPIC_API_KEY=",
		"GROQ_API_KEY=",
		"AZURE_OPENAI_API_KEY=",
		"SENDGRID_API_KEY=",
		"API_TOKEN_JWT_SECRET=",
		"LW_GATEWAY_INTERNAL_SECRET=",
		"LW_GATEWAY_JWT_SECRET=",
		"LW_VIRTUAL_KEY_PEPPER=",
		// New patterns — credential-bearing connection strings and the AWS
		// access-key half. A prompt-injected worker could otherwise
		// `env | grep -iE 'redis|postgres|sentry'` and exfiltrate.
		"REDIS_URL=",
		"POSTGRES_URL=",
		"CLICKHOUSE_URL=",
		"MONGODB_URI=",
		"SENTRY_DSN=",
		"AWS_ACCESS_KEY_ID=",
		"GH_TOKEN=",
		"GITHUB_TOKEN=",
		"POSTGRES_PASSWORD=",
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
