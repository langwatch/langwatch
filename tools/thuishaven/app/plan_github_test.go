package app

import (
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "haven runs githubsim only when the worktree asks for it"
func TestGithubEnvNamesTheStacksWebhookAndSetupDoors(t *testing.T) {
	st := domain.Stack{Slug: "feat-x", Services: []domain.Service{
		{Name: "app", URL: "https://app.feat-x.langwatch.localhost"},
		{Name: domain.GithubService, Port: 45596, URL: "https://github.feat-x.langwatch.localhost"},
	}}
	env := githubEnv(st)
	for _, want := range []string{
		"GITHUBSIM_ADDR=:45596", "GITHUBSIM_STACK=feat-x", "GITHUBSIM_SEED=1",
		"GITHUBSIM_WEBHOOK_SECRET=" + domain.GithubSimWebhookSecret,
		"GITHUBSIM_WEBHOOK_URL=https://app.feat-x.langwatch.localhost/api/github/webhook",
		"GITHUBSIM_SETUP_URL=https://app.feat-x.langwatch.localhost/api/github/setup",
	} {
		if !slices.Contains(env, want) {
			t.Errorf("githubEnv %v lacks %s", env, want)
		}
	}
	svc := domain.Service{Name: domain.GithubService, Port: 45596, URL: "https://github.feat-x.langwatch.localhost"}
	t.Setenv("GITHUB_LANGY_APP_ID", "")
	if got := simulatorBaseEnv(domain.Selection{}, svc, t.TempDir()); got != nil {
		t.Errorf("an unselected githubsim still set %v", got)
	}
	if got := simulatorBaseEnv(domain.Selection{Github: true}, svc, t.TempDir()); !slices.Contains(got, "GITHUB_LANGY_API_BASE=https://github.feat-x.langwatch.localhost") {
		t.Errorf("a selected githubsim set %v", got)
	}
	if got := simulatorBaseEnv(domain.Selection{Github: true}, svc, t.TempDir()); slices.ContainsFunc(got, func(l string) bool { return strings.HasPrefix(l, "LANGY_GITHUB_HOST=") }) {
		t.Errorf("without +langy the worker host must stay unset, got %v", got)
	}
	if got := simulatorBaseEnv(domain.Selection{Github: true, Langy: true}, svc, t.TempDir()); !slices.Contains(got, "LANGY_GITHUB_HOST=github.feat-x.langwatch.localhost") {
		t.Errorf("+github +langy must name the sim as Langy's GitHub host, got %v", got)
	}
}
