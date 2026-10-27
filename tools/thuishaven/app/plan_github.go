package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// githubEnv is githubsim's own configuration: its port and the app's GitHub
// App doors it redirects to and signs deliveries for.
func githubEnv(st domain.Stack) []string {
	var port int
	var self, app string
	for _, svc := range st.Services {
		switch svc.Name {
		case domain.GithubService:
			port, self = svc.Port, svc.URL
		case "app":
			app = svc.URL
		}
	}
	env := []string{
		fmt.Sprintf("GITHUBSIM_ADDR=:%d", port), "GITHUBSIM_STACK=" + st.Slug, "GITHUBSIM_PUBLIC_URL=" + self,
		"GITHUBSIM_SEED=1", "GITHUBSIM_APP_ID=" + domain.GithubSimAppID, "GITHUBSIM_APP_SLUG=" + domain.GithubSimAppSlug,
		"GITHUBSIM_WEBHOOK_SECRET=" + domain.GithubSimWebhookSecret,
	}
	if app != "" {
		env = append(env, "GITHUBSIM_WEBHOOK_URL="+app+"/api/github/webhook", "GITHUBSIM_SETUP_URL="+app+"/api/github/setup")
	}
	return env
}

// githubChild is the supervised githubsim lane. It keeps nothing on disk.
func (o *Orchestrator) githubChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.GithubService, Dir: repoRoot, Color: palette[2], LogPath: filepath.Join(logDir, domain.GithubService+".log"),
		Shell: o.simulatorShell("github"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.GithubService)), githubEnv(st)...),
	}
}
