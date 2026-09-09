package app

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// palette gives each supervised child a distinct prefix color.
var palette = []string{"32", "34", "33", "35", "36", "31", "92", "94", "96", "95"}

// goServiceShell picks `make service` (go run) or `make service-watch` (air) for
// a Go service — the "run vs watch" decision the orchestrator owns.
func goServiceShell(repoRoot, svc string, shouldWatch bool) string {
	target := "service"
	if shouldWatch {
		target = "service-watch"
	}
	return fmt.Sprintf("make -C %q %s svc=%s", repoRoot, target, svc)
}

// goCombinedShell runs the data-plane services in ONE Go process — the local
// topology (ADR-004, amendment 2026-09-07). `services` names which of them this
// stack selected, so a worktree that turned one off gets a process hosting only
// the other rather than a second lane it has to reason about.
//
// Watching is air: it rebuilds the one binary on a Go change, restarts only
// when the build succeeded, and waits out the same quiet window the Node lane
// debounces on (LANGWATCH_DEV_WATCH_DEBOUNCE_MS).
func goCombinedShell(repoRoot string, services []string, shouldWatch bool) string {
	target := "service"
	if shouldWatch {
		target = "service-watch"
	}
	return fmt.Sprintf("make -C %q %s svc=combined args=%q", repoRoot, target, strings.Join(services, " "))
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
	// the app process and the langy worker (Bun) subprocess otherwise
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
	nodeEnv := func(lane string) []string {
		return append(append([]string{}, base...),
			"NODE_ENV=development", "DOTENV_CONFIG_QUIET=true", domain.LaneEnv(lane))
	}
	out = append(out, Child{
		Name: "ui", Dir: repoDir, Color: palette[1], LogPath: logPath("ui"),
		Shell: "pnpm -s --filter " + UIPackage + " dev",
		Env:   nodeEnv("ui"),
		// Hold the browser application (vite) until the API answers /api/health.
		// It proxies /api to the API lane, which is a much bigger process and
		// boots slower; a browser that loads the SPA before the API is up gets
		// stuck in an auth redirect loop. Gating the lane means the hostname
		// simply isn't served until the stack can actually handle a request.
		ReadyProbeURL: fmt.Sprintf("http://127.0.0.1:%d/api/health", st.APIPort),
	})
	// One Go lane, hosting whichever data-plane services this stack selected.
	// Each still binds the port haven allocated for its hostname: SERVER_ADDR
	// cannot answer for two listeners in one process, so each has its own
	// address variable.
	var goServices []string
	goEnv := append(append([]string{}, base...), domain.LaneEnv(GoLane))
	if opts.Selection.Gateway {
		goServices = append(goServices, "aigateway")
		goEnv = append(goEnv, fmt.Sprintf("%s=:%d", GatewayAddrEnv, port("gateway")))
	}
	if opts.Selection.NLP {
		goServices = append(goServices, "nlpgo")
		goEnv = append(goEnv, fmt.Sprintf("%s=:%d", NLPAddrEnv, port("nlp")))
	}
	if len(goServices) > 0 {
		out = append(out, Child{
			Name: GoLane, Dir: opts.RepoRoot, Color: palette[2], LogPath: logPath(GoLane),
			Shell: goCombinedShell(opts.RepoRoot, goServices, opts.ShouldGoWatch),
			Env:   goEnv,
		})
	}
	if opts.Selection.IDP {
		idpEnv := append(append([]string{}, base...),
			fmt.Sprintf("SERVER_ADDR=:%d", port("idp")), domain.LaneEnv("idp"))
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
	// The two developer tools. Neither is a Node LANE — nothing in the product
	// degrades without them — so they are planned like the Go services: only
	// when the worktree has selected them, and never counted among the three.
	// Each is handed the port haven allocated for its hostname, on the command
	// line, because both tools otherwise bind a fixed default that a second
	// worktree would find busy.
	if opts.Selection.DesignSystem {
		out = append(out, Child{
			Name: domain.DesignSystemService, Dir: repoDir, Color: palette[8], LogPath: logPath(domain.DesignSystemService),
			Shell: fmt.Sprintf("pnpm -s --filter %s storybook --port %d --ci",
				DesignSystemPackage, port(domain.DesignSystemService)),
			Env: nodeEnv(domain.DesignSystemService),
		})
	}
	if opts.Selection.MailRoom {
		out = append(out, Child{
			Name: domain.MailRoomService, Dir: repoDir, Color: palette[9], LogPath: logPath(domain.MailRoomService),
			// --strictPort: vite silently moves to the next free port otherwise,
			// which would leave mail-room.<slug> routed to nothing at all.
			// --host 127.0.0.1: vite's default "localhost" binds only ::1 on
			// this machine, and the proxy and the port probe both dial IPv4.
			Shell: fmt.Sprintf("pnpm -s --filter %s dev --host 127.0.0.1 --port %d --strictPort",
				MailPackage, port(domain.MailRoomService)),
			Env: nodeEnv(domain.MailRoomService),
		})
	}
	if opts.Selection.Langy {
		langy := o.langyChild(st, opts, base, port("langyagent"), langyDockerHost)
		langy.LogPath = logPath("langyagent")
		out = append(out, langy)
	}
	out = append(out, Child{
		// green, not red: the backend is a healthy lane, and a red prefix reads
		// as an error even on ordinary info logs. Red (palette[5]) is reserved
		// for genuine failures, so no lane label uses it — TestNoLaneIsRed pins
		// that.
		//
		// Unconditional, and one lane: locally the API application and the
		// worker application share a process (ADR-004, amendment 2026-09-07).
		// It is a launcher, not a process role — each application still parses
		// its own configuration and composes its own graph, and nothing reads
		// WORKERS_IN_PROCESS or START_WORKERS. Production still deploys them
		// separately.
		Name: BackendLane, Dir: repoDir, Color: palette[0], LogPath: logPath(BackendLane),
		Shell: "pnpm -s --filter " + BackendPackage + " dev",
		Env:   nodeEnv(BackendLane),
	})
	return out
}

// The Node lanes a stack supervises, by workspace package name. planChildren
// runs each with `pnpm --filter <pkg> dev` from the workspace root, so the lane
// never depends on a path staying where it is.
const (
	// UIPackage is the browser application — Vite, which serves the routed
	// app.<slug> hostname and proxies /api to the backend lane.
	UIPackage = "@langwatch/ui"
	// BackendPackage is the contributor-only launcher that hosts the API
	// application and the worker application in one local process. Both
	// applications keep their own entry points; this only starts them together.
	BackendPackage = "@langwatch/dev-runtime"
	// APIPackage and WorkerPackage are the two applications the backend lane
	// hosts. Locally they share one process; in production each is its own
	// deployment, started from its own entry point. Named here because that is
	// what the lane is made of, and because `pnpm --filter <pkg> dev` still runs
	// either one on its own.
	APIPackage    = "@langwatch/platform-api"
	WorkerPackage = "@langwatch/worker"
)

// The lane names haven supervises, logs and restarts by.
const (
	// BackendLane is the API + worker Node process.
	BackendLane = "backend"
	// GoLane is the process hosting the Go data-plane services.
	GoLane = "go"
)

// The address variable each service in the combined Go process binds. One per
// service, because SERVER_ADDR cannot name two listeners in one process. They
// are the same names cmd/service reads.
const (
	GatewayAddrEnv = "LANGWATCH_GO_AIGATEWAY_ADDR"
	NLPAddrEnv     = "LANGWATCH_GO_NLPGO_ADDR"
)

// The two developer tools a stack can optionally supervise, by workspace
// package name. They are tools rather than parts of the product — nothing the
// application does depends on either — so they stay in their own packages and
// haven only runs them for a worktree that asked (`haven up +design-system
// +mail-room`).
const (
	// DesignSystemPackage owns the component workshop (Storybook), routed at
	// design-system.<slug>.
	DesignSystemPackage = "@langwatch/design-system"
	// MailPackage owns the studio that previews every transactional message,
	// routed at mail-room.<slug>. Its `dev` script is the studio's Vite server.
	MailPackage = "@langwatch/mail"
)

// UIDirRel is where the browser application lives inside the workspace. Only
// the Vite lane's own working directory needs it — the HMR-gate marker is
// resolved by the plugin against that directory, not the workspace root.
const UIDirRel = "apps/ui"

// UIDir is the Vite lane's working directory inside a checkout.
func UIDir(repoDir string) string { return filepath.Join(repoDir, UIDirRel) }
