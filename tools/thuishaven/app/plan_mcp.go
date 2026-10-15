package app

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// mcpEnv is mcpsim's own configuration, wherever it runs. The app's base URL is
// the hosted MCP endpoint's origin (<app>/mcp and <app>/sse); the seeded key and
// project are the API key flow's defaults, its own routed URL is where the OAuth
// redirect lands (<public>/callback), and the seeded admin's login lets it
// approve an OAuth consent itself, on a *.localhost app only.
func mcpEnv(st domain.Stack) []string {
	var port int
	var self, app string
	for _, svc := range st.Services {
		switch svc.Name {
		case domain.McpService:
			port, self = svc.Port, svc.URL
		case "app":
			app = svc.URL
		}
	}
	env := []string{
		fmt.Sprintf("MCPSIM_ADDR=127.0.0.1:%d", port), "MCPSIM_STACK=" + st.Slug,
		"MCPSIM_PROJECT_SLUG=" + domain.DefaultProjectSlug,
		"MCPSIM_ACCESS_TOKEN=" + domain.DefaultPrivateAccessToken,
		"MCPSIM_SIGNIN_EMAIL=" + domain.DefaultAdminEmail, "MCPSIM_SIGNIN_PASSWORD=" + domain.DefaultAdminPassword,
	}
	if self != "" {
		env = append(env, "MCPSIM_PUBLIC_URL="+strings.TrimRight(self, "/"))
	}
	if app != "" {
		env = append(env, "MCPSIM_ENDPOINT="+strings.TrimRight(app, "/"))
	}
	if st.LocalAPIKey != "" {
		env = append(env, "MCPSIM_API_KEY="+st.LocalAPIKey)
	}
	return env
}

// mcpChild is the supervised mcpsim lane. It keeps nothing on disk: the OAuth
// grant and its runs live in memory.
func (o *Orchestrator) mcpChild(st domain.Stack, repoRoot string, base []string) Child {
	logDir, _ := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	return Child{
		Name: domain.McpService, Dir: repoRoot, Color: palette[9], LogPath: filepath.Join(logDir, domain.McpService+".log"),
		Shell: o.simulatorShell("mcp"),
		Env:   append(append(append([]string{}, base...), domain.LaneEnv(domain.McpService)), mcpEnv(st)...),
	}
}
