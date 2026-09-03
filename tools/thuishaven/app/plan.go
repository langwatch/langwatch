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
func (o *Orchestrator) planChildren(st domain.Stack, opts PlanOptions, repoDir, langyDockerHost string) []Child {
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
		Name: "ui", Dir: repoDir, Color: palette[1], LogPath: logPath("ui"),
		Shell: "pnpm -s --filter " + UIPackage + " dev",
		Env:   nodeEnv(),
		// Hold the browser application (vite) until the API answers /api/health.
		// It proxies /api to the API lane, which is a much bigger process and
		// boots slower; a browser that loads the SPA before the API is up gets
		// stuck in an auth redirect loop. Gating the lane means the hostname
		// simply isn't served until the stack can actually handle a request.
		ReadyProbeURL: fmt.Sprintf("http://127.0.0.1:%d/api/health", st.APIPort),
	})
	out = append(out, Child{
		Name: "api", Dir: repoDir, Color: palette[3], LogPath: logPath("api"),
		Shell: "pnpm -s --filter " + APIPackage + " dev",
		Env:   nodeEnv(),
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
	if opts.Selection.IDP {
		idpEnv := append(append([]string{}, base...), fmt.Sprintf("SERVER_ADDR=:%d", port("idp")))
		// The issuer/metadata URLs the simulator publishes must be the routed
		// hostname, not loopback — the browser follows them during a login.
		for _, svc := range st.Services {
			if svc.Name == "idp" {
				if svc.URL != "" {
					idpEnv = append(idpEnv, "IDPSIM_BASE_URL="+svc.URL)
				}
				// Bound to loopback rather than the wildcard the simulator
				// defaults to: this nameserver answers whatever it is asked
				// about, so it should be reachable from this machine and
				// nowhere else.
				if svc.DNSPort != 0 {
					idpEnv = append(idpEnv, fmt.Sprintf("IDPSIM_DNS_ADDR=127.0.0.1:%d", svc.DNSPort))
				}
			}
		}
		out = append(out, Child{
			Name: "idp", Dir: opts.RepoRoot, Color: palette[6], LogPath: logPath("idp"),
			Shell: goServiceShell(opts.RepoRoot, "idpsim", opts.ShouldGoWatch),
			Env:   idpEnv,
		})
	}
	if opts.Selection.Langy {
		langy := o.langyChild(st, opts, base, port("langyagent"), langyDockerHost)
		langy.LogPath = logPath("langyagent")
		out = append(out, langy)
	}
	out = append(out, Child{
		// green, not red: workers are a healthy background lane, and a red
		// prefix reads as an error even on ordinary info logs. Red (palette[5])
		// is reserved for genuine failures, so no lane label uses it —
		// TestNoLaneIsRed pins that.
		//
		// Unconditional: the background worker is its own application now
		// (apps/worker), so there is no in-process mode left to choose and
		// nothing reads WORKERS_IN_PROCESS or START_WORKERS. Every stack runs
		// the three Node lanes — a stack that quietly did no background
		// processing would look identical to a healthy one until a job was
		// expected to have run.
		Name: "workers", Dir: repoDir, Color: palette[0], LogPath: logPath("workers"),
		Shell: "pnpm -s --filter " + WorkerPackage + " dev",
		Env:   nodeEnv(),
	})
	return out
}

// The three Node applications a stack supervises, by workspace package name.
// planChildren runs each with `pnpm --filter <pkg> dev` from the workspace
// root, so the lane never depends on a path staying where it is.
const (
	// UIPackage is the browser application — Vite, which serves the routed
	// app.<slug> hostname and proxies /api to the API lane.
	UIPackage = "@langwatch/ui"
	// APIPackage is the interactive API process: tRPC, REST, SSE.
	APIPackage = "@langwatch/platform-api"
	// WorkerPackage is the background process: queues, schedulers, projections.
	WorkerPackage = "@langwatch/worker"
)

// UIDirRel is where the browser application lives inside the workspace. Only
// the Vite lane's own working directory needs it — the HMR-gate marker is
// resolved by the plugin against that directory, not the workspace root.
const UIDirRel = "apps/ui"

// UIDir is the Vite lane's working directory inside a checkout.
func UIDir(repoDir string) string { return filepath.Join(repoDir, UIDirRel) }
