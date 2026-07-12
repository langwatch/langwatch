package app

import (
	"fmt"
	"os"
	"path/filepath"

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
	// `pnpm -s` drops the `> pkg@ver script` lifecycle banner; DOTENV_CONFIG_QUIET
	// silences dotenv v17's promo line for lanes that load it via
	// `import "dotenv/config"`. Together with the `quiet: true` passed in
	// server.mts / vite.config.ts, this keeps every Node lane starting on real
	// logs — matching the Go services' clean startup.
	nodeEnv := func() []string {
		return append(append([]string{}, base...),
			"NODE_ENV=development", "DOTENV_CONFIG_QUIET=true")
	}
	out = append(out, Child{
		Name: "app", Dir: lwDir, Color: palette[1],
		Shell: "pnpm -s run dev:vite",
		Env:   nodeEnv(),
	})
	// In-process worker mode: the app process (start:app -> start.ts) hosts the
	// worker stack itself when WORKERS_IN_PROCESS=1, so there is no separate
	// `workers` lane below — one Node process instead of two, saving its RAM.
	apiEnv := nodeEnv()
	if opts.ShouldRunWorkersInProcess {
		apiEnv = append(apiEnv, "WORKERS_IN_PROCESS=1")
	}
	out = append(out, Child{
		Name: "api", Dir: lwDir, Color: palette[3],
		Shell: "pnpm -s run start:app",
		Env:   apiEnv,
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
	if !opts.ShouldSkipLangyAgent {
		// langyagent (the cmd/service mono-binary) takes its listen port from PORT,
		// not SERVER_ADDR (see services/langyagent/config.go) — PORT always wins. Its
		// sessions/workspace roots default to the in-container /workspace, which is
		// read-only on a dev host; point them at writable per-slug dirs under haven's
		// home and create them so the manager boots (session spawn still needs an
		// `opencode` binary on PATH, but the service itself comes up).
		laRoot := filepath.Join(o.cfg.Home, "langyagent", st.Slug)
		_ = os.MkdirAll(filepath.Join(laRoot, "sessions"), 0o755)
		_ = os.MkdirAll(filepath.Join(laRoot, "workspace"), 0o755)
		out = append(out, Child{
			Name: "langyagent", Dir: opts.RepoRoot, Color: palette[6],
			Shell: goServiceShell(opts.RepoRoot, "langyagent", opts.ShouldGoWatch),
			Env: append(append([]string{}, base...),
				fmt.Sprintf("PORT=%d", port("langyagent")),
				"SESSIONS_ROOT="+filepath.Join(laRoot, "sessions"),
				"LANGY_WORKSPACE_ROOT="+filepath.Join(laRoot, "workspace"),
			),
		})
	}
	if opts.ShouldStartWorkers && !opts.ShouldRunWorkersInProcess {
		out = append(out, Child{
			// green, not red: workers are a healthy background lane, and a red
			// prefix reads as an error even on ordinary info logs. Red (palette[5])
			// is reserved for genuine failures, so no lane label uses it —
			// TestNoLaneIsRed pins that.
			Name: "workers", Dir: lwDir, Color: palette[0],
			Shell: "pnpm -s run start:workers",
			Env:   append(nodeEnv(), "START_WORKERS=true"),
		})
	}
	return out
}
