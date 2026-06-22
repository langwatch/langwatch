package langyagent

import (
	"os"
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
