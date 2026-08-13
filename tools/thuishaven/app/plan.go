package app

import (
	"fmt"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// palette gives each supervised child a distinct prefix color.
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
func (o *Orchestrator) planChildren(st domain.Stack, opts PlanOptions, lwDir, langyDockerHost string) []Child {
	base := st.OverlayEnv()
	logPath := func(name string) string {
		return filepath.Join(o.cfg.Home, "logs", st.Slug, name+".log")
	}
	// Bun and Node use their own bundled CA roots, NOT the macOS system store, so
	// the app process and the langy worker's opencode (Bun) subprocess otherwise
	// reject the portless HTTPS certs on every gateway/control-plane call ("self
	// signed certificate in certificate chain"). Point them at the portless Local
	// CA so those runtimes trust the same hostnames curl/Go/the browser already do.
	// Dev/portless only — production serves real certs, and CACertPath is "" when
	// the CA is absent, so this appends nothing outside a portless stack.
	if ca := o.proxy.CACertPath(); ca != "" {
		base = append(base, "NODE_EXTRA_CA_CERTS="+ca)
	}
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
		Name: "app", Dir: lwDir, Color: palette[1], LogPath: logPath("app"),
		Shell: "pnpm -s run dev:vite",
		Env:   nodeEnv(),
		// Hold the web (vite) until the API answers /api/health. The app proxies
		// /api to the API (start:app:dev), which is a bigger process and boots slower;
		// a browser that loads the web before the API is up gets stuck in an auth
		// redirect loop. Gating the lane means the hostname simply isn't served
		// until the stack can actually handle a request.
		ReadyProbeURL: fmt.Sprintf("http://127.0.0.1:%d/api/health", st.APIPort),
	})
	// In-process worker mode (the default): the app process hosts the worker
	// stack itself, so there is no separate `workers` lane below — one Node
	// process instead of two, saving its RAM. `haven up +workers` selects the
	// standalone lane instead.
	apiEnv := nodeEnv()
	if !opts.Selection.Workers {
		apiEnv = append(apiEnv, "WORKERS_IN_PROCESS=1")
	}
	out = append(out, Child{
		Name: "api", Dir: lwDir, Color: palette[3], LogPath: logPath("api"),
		// `:dev` runs the app from source through tsx. The bare `start:app` is the
		// PRODUCTION entry (`node dist/server/server.cjs`) and nothing in a dev
		// worktree builds that bundle, so it crash-loops on MODULE_NOT_FOUND and
		// the app lane never passes its /api/health gate. scripts/start.sh makes
		// the same split off NODE_ENV; these lanes bypass start.sh, so they pick
		// the dev entry point themselves. Pinned by TestNodeLanesUseDevEntryPoints.
		Shell: "pnpm -s run start:app:dev",
		Env:   apiEnv,
	})
	if opts.Selection.Gateway {
		out = append(out, Child{
			Name: "gateway", Dir: opts.RepoRoot, Color: palette[2], LogPath: logPath("gateway"),
			Shell: goServiceShell(opts.RepoRoot, "aigateway", opts.ShouldGoWatch),
			Env:   append(append([]string{}, base...), fmt.Sprintf("SERVER_ADDR=:%d", port("gateway"))),
		})
	}
	if opts.Selection.NLP {
		out = append(out, Child{
			Name: "nlp", Dir: opts.RepoRoot, Color: palette[4], LogPath: logPath("nlp"),
			Shell: goServiceShell(opts.RepoRoot, "nlpgo", opts.ShouldGoWatch),
			Env:   append(append([]string{}, base...), fmt.Sprintf("SERVER_ADDR=:%d", port("nlp"))),
		})
	}
	if opts.Selection.Langy {
		langy := o.langyChild(st, opts, base, port("langyagent"), langyDockerHost)
		langy.LogPath = logPath("langyagent")
		out = append(out, langy)
	}
	if opts.Selection.Workers {
		out = append(out, Child{
			// green, not red: workers are a healthy background lane, and a red
			// prefix reads as an error even on ordinary info logs. Red (palette[5])
			// is reserved for genuine failures, so no lane label uses it —
			// TestNoLaneIsRed pins that.
			Name: "workers", Dir: lwDir, Color: palette[0], LogPath: logPath("workers"),
			// `:dev` for the same reason as the api lane above — the bare
			// `start:workers` is `node dist/server/workers.cjs`.
			Shell: "pnpm -s run start:workers:dev",
			Env:   append(nodeEnv(), "START_WORKERS=true"),
		})
	}
	return out
}
