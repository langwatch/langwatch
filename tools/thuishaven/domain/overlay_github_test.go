package domain

import (
	"slices"
	"strings"
	"testing"
)

// @scenario "haven runs githubsim only when the worktree asks for it"
func TestGithubAppEnvPointsTheModuleAtGithubsim(t *testing.T) {
	env := GithubAppEnv(map[string]string{}, "https://github.s.langwatch.localhost")
	for _, want := range []string{
		"GITHUB_LANGY_APP_ID=" + GithubSimAppID,
		"GITHUB_LANGY_APP_SLUG=" + GithubSimAppSlug,
		"GITHUB_LANGY_WEBHOOK_SECRET=" + GithubSimWebhookSecret,
		"GITHUB_LANGY_API_BASE=https://github.s.langwatch.localhost",
		"GITHUB_LANGY_WEB_BASE=https://github.s.langwatch.localhost",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("env lacks %s", want)
		}
	}
	var key string
	for _, line := range env {
		if v, ok := strings.CutPrefix(line, "GITHUB_LANGY_PRIVATE_KEY="); ok {
			key = v
		}
	}
	if !strings.HasPrefix(key, "-----BEGIN RSA PRIVATE KEY-----\\n") || strings.Contains(key, "\n") {
		t.Errorf("the private key is not a single-line PEM: %.40q", key)
	}
	if env := GithubAppEnv(map[string]string{"GITHUB_LANGY_APP_ID": "99"}, "https://x"); env != nil {
		t.Errorf("a developer's own GitHub App was overridden with %v", env)
	}
}

// @scenario "haven runs githubsim only when the worktree asks for it"
func TestGithubIsOptIn(t *testing.T) {
	sel, err := applySelectionDelta(Selection{}, "github", true)
	if err != nil || !sel.Github {
		t.Fatalf("+github did not select it: %v %v", sel, err)
	}
	if (Selection{}).Github {
		t.Error("githubsim must be off by default")
	}
}
