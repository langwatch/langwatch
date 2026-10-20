package app

import (
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "haven points mcpsim at the stack's app with its key, project and local login"
func TestMcpEnvNamesTheStacksAppKeyProjectAndAdminLogin(t *testing.T) {
	st := domain.Stack{Slug: "feat-x", LocalAPIKey: "sk-lw-test", Services: []domain.Service{
		{Name: "app", URL: "https://app.feat-x.langwatch.localhost/"},
		{Name: domain.McpService, Port: 45599, URL: "https://mcp.feat-x.langwatch.localhost"},
	}}
	env := mcpEnv(st)
	for _, want := range []string{
		"MCPSIM_ADDR=127.0.0.1:45599", "MCPSIM_STACK=feat-x",
		"MCPSIM_ENDPOINT=https://app.feat-x.langwatch.localhost",
		"MCPSIM_API_KEY=sk-lw-test", "MCPSIM_PROJECT_ID=local-dev-project",
		"MCPSIM_PUBLIC_URL=https://mcp.feat-x.langwatch.localhost",
		"MCPSIM_SIGNIN_EMAIL=" + domain.DefaultAdminEmail, "MCPSIM_SIGNIN_PASSWORD=" + domain.DefaultAdminPassword,
	} {
		if !slices.Contains(env, want) {
			t.Errorf("mcpEnv %v lacks %s", env, want)
		}
	}
	st.LocalAPIKey = ""
	if slices.ContainsFunc(mcpEnv(st), func(l string) bool { return strings.HasPrefix(l, "MCPSIM_API_KEY=") }) {
		t.Error("a stack with no seeded key still names one")
	}
	if domain.DefaultSelection().Mcp {
		t.Error("mcpsim must be off by default")
	}
}

// @scenario "haven runs mcpsim only when the worktree asks for it"
func TestMcpsimIsHostedOnlyWhenSelected(t *testing.T) {
	o := &Orchestrator{cfg: Config{Home: t.TempDir(), SimulatorArgv: []string{"/bin/haven", "simulator"}}, proxy: stubProxy{}}
	repo := t.TempDir() // no combined_dev.go: haven runs its bundled copy as a lane of its own
	st := domain.Stack{Slug: "test", WorktreeDir: repo, Services: []domain.Service{
		{Name: "app", Port: 45560, URL: "https://app.test.langwatch.localhost"},
		{Name: domain.McpService, Port: 45599, URL: "https://mcp.test.langwatch.localhost"},
	}}
	if _, ok := findChild(o.planChildren(st, PlanOptions{Selection: domain.DefaultSelection(), RepoRoot: repo}, repo), domain.McpService); ok {
		t.Error("mcpsim ran without +mcp")
	}
	sel := domain.DefaultSelection()
	sel.Mcp = true
	lane, ok := findChild(o.planChildren(st, PlanOptions{Selection: sel, RepoRoot: repo}, repo), domain.McpService)
	if !ok {
		t.Fatal("+mcp planned no mcpsim lane")
	}
	if !strings.Contains(lane.Shell, "simulator") || !strings.Contains(lane.Shell, "mcp") || !slices.Contains(lane.Env, "MCPSIM_ADDR=127.0.0.1:45599") {
		t.Errorf("mcpsim lane %+v", lane)
	}
}
