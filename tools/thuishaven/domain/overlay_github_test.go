package domain

import (
	"slices"
	"strings"
	"testing"
)

// @scenario "haven runs githubsim only when the worktree asks for it"
func TestGithubAppEnvPointsTheModuleAtGithubsim(t *testing.T) {
	env := GithubAppEnv("https://github.s.langwatch.localhost")
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

// @scenario "+github wins over a real GitHub App in .env"
func TestGithubAppEnvBeatsARealAppInDotenv(t *testing.T) {
	root := map[string]string{
		"GITHUB_LANGY_APP_ID": "123456", "GITHUB_LANGY_APP_SLUG": "real-app",
		"GITHUB_LANGY_PRIVATE_KEY": "real-key", "GITHUB_LANGY_WEBHOOK_SECRET": "real-secret",
		"GITHUB_LANGY_API_BASE": "https://api.github.com", "GITHUB_LANGY_WEB_BASE": "https://github.com",
	}
	child := map[string]string{}
	for k, v := range root {
		child[k] = v
	}
	for _, line := range GithubAppEnv("https://github.s.langwatch.localhost") {
		if k, v, ok := strings.Cut(line, "="); ok {
			child[k] = v
		}
	}
	want := map[string]string{
		"GITHUB_LANGY_APP_ID": GithubSimAppID, "GITHUB_LANGY_APP_SLUG": GithubSimAppSlug,
		"GITHUB_LANGY_WEBHOOK_SECRET": GithubSimWebhookSecret,
		"GITHUB_LANGY_API_BASE":       "https://github.s.langwatch.localhost",
		"GITHUB_LANGY_WEB_BASE":       "https://github.s.langwatch.localhost",
	}
	for k, v := range want {
		if child[k] != v {
			t.Errorf("%s = %q, want the sim's %q", k, child[k], v)
		}
	}
	if k := child["GITHUB_LANGY_PRIVATE_KEY"]; k == "real-key" || !strings.HasPrefix(k, "-----BEGIN RSA PRIVATE KEY-----") {
		t.Errorf("the private key is not the sim's")
	}
}

// @scenario "Langy's worker reaches githubsim when the stack names it as the GitHub host"
func TestGithubLangyEnvNamesTheSimHost(t *testing.T) {
	got := GithubLangyEnv("https://github.s.langwatch.localhost:1355")
	if !slices.Equal(got, []string{"LANGY_GITHUB_HOST=github.s.langwatch.localhost:1355"}) {
		t.Errorf("GithubLangyEnv = %v", got)
	}
	if got := GithubLangyEnv(""); got != nil {
		t.Errorf("no endpoint must give no host, got %v", got)
	}
}
