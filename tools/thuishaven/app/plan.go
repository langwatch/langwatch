package app

import (
	"fmt"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// palette gives each supervised child a distinct prefix colour.
var palette = []string{"32", "34", "33", "35", "36", "31", "92", "94"}

// goServiceShell picks `make service` (go run) or `make service-watch` (air) for
// a Go service — the "run vs watch" decision the orchestrator owns.
func goServiceShell(repoRoot, svc string, shouldWatch bool) string {
	target := "service"
	if shouldWatch {
		target = "service-watch"
	}
	return fmt.Sprintf("make -C %q %s svc=%s", repoRoot, target, svc)
}

// planChildren turns a resolved stack into the supervised process set, layering
// the overlay env (hostname URLs + ports) onto each child and giving each Go
// service its SERVER_ADDR.
func (o *Orchestrator) planChildren(st domain.Stack, opts PlanOptions, lwDir string) []Child {
	base := st.OverlayEnv()
	port := func(name string) int {
		for _, s := range st.Services {
			if s.Name == name {
				return s.Port
			}
		}
		return 0
	}
	var out []Child
	out = append(out, Child{
		Name: "app", Dir: lwDir, Color: palette[1],
		Shell: "pnpm run dev:vite",
		Env:   append(append([]string{}, base...), "NODE_ENV=development"),
	})
	out = append(out, Child{
		Name: "api", Dir: lwDir, Color: palette[3],
		Shell: "pnpm run start:app",
		Env:   append(append([]string{}, base...), "NODE_ENV=development"),
	})
	if !opts.ShouldSkipGateway {
		out = append(out, Child{
			Name: "gateway", Dir: opts.RepoRoot, Color: palette[2],
			Shell: goServiceShell(opts.RepoRoot, "aigateway", opts.ShouldGoWatch),
			Env:   append(append([]string{}, base...), fmt.Sprintf("SERVER_ADDR=:%d", port("gateway"))),
		})
	}
	if !opts.ShouldSkipNLP {
		out = append(out, Child{
			Name: "nlp", Dir: opts.RepoRoot, Color: palette[4],
			Shell: goServiceShell(opts.RepoRoot, "nlpgo", opts.ShouldGoWatch),
			Env:   append(append([]string{}, base...), fmt.Sprintf("SERVER_ADDR=:%d", port("nlp"))),
		})
	}
	if opts.ShouldStartWorkers {
		out = append(out, Child{
			Name: "workers", Dir: lwDir, Color: palette[5],
			Shell: "pnpm run start:workers",
			Env:   append(append([]string{}, base...), "NODE_ENV=development", "START_WORKERS=true"),
		})
	}
	return out
}
