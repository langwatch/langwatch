package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// langyImage is the tag haven builds and runs the langyagent worker under in its
// container tiers. Local-only (never pushed/pulled) — built from Dockerfile.langyagent.
const langyImage = "langyagent:dev"

// Langy is intentionally constrained in local development. OpenCode workers are
// heavyweight processes (roughly 600-650 MiB each in normal use), and an uncapped
// manager can otherwise consume the entire small Colima VM before the ten-minute
// production-shaped idle timeout has a chance to help. These are local launcher
// settings only; the production chart keeps its own independent limits.
const (
	localLangyMaxWorkers       = 2
	localLangyWorkerIdleMS     = 15_000
	localLangyReaperIntervalMS = 2_000
	localLangyContainerMemory  = "1792m"
	localLangyContainerCPUs    = "2"
	localLangyContainerPIDs    = 256
	// localLangyWorkerIdleHostMS is the host tier's idle cutoff — the small-Colima-VM
	// memory pressure above does not apply here (the worker runs directly on the
	// developer's own machine, not a capped VM), so the aggressive 15s container-tier
	// value only causes real conversations to reap their worker mid-gap: a multi-turn
	// scenario test's own next-turn generation (an LLM call) routinely takes longer
	// than 15s, and a real human's think-and-type pause between messages easily does
	// too. 2 minutes is generous headroom for both without holding a worker open
	// anywhere near production's 10-minute default.
	localLangyWorkerIdleHostMS = 120_000
)

// langyWorkerIdleEnv lets a developer override the aggressive local idle timeout
// for their own worktree.
const langyWorkerIdleEnv = "LANGY_WORKER_IDLE_MS"

// langyWorkerIdleMS resolves the worker idle timeout haven passes to the
// manager, given the caller's own tier-appropriate default (the container
// tier's constrained 15s, or the host tier's unconstrained 2-minute value —
// see the constants above).
//
// The container tier's 15s default is a RAM decision, not a product one, and
// it has a real cost when you are working on Langy itself: production reaps
// idle workers after ten minutes, so locally every message sent more than
// fifteen seconds after the last one hits a freshly-spawned worker and shows the
// cold "Waking Langy up…" copy. Warm-path behaviour is therefore untestable
// locally by default, and the difference is invisible — nothing in the UI says
// the worker was reaped.
//
// So the value is overridable: export LANGY_WORKER_IDLE_MS to hold workers
// longer than either default while you work on the warm path. It stays opt-in
// because the cost is real — up to localLangyMaxWorkers × ~600 MiB held on a
// small Colima VM — so nobody pays it who has not asked to. A missing,
// unparseable or non-positive value falls back to the given default rather
// than failing the launch: a typo in a dev env var must never stop the stack
// coming up.
func langyWorkerIdleMS(defaultMS int) int {
	raw := strings.TrimSpace(os.Getenv(langyWorkerIdleEnv))
	if raw == "" {
		return defaultMS
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return defaultMS
	}
	return parsed
}

// langyChild builds the supervised child that runs the langyagent worker, picking
// the launch mechanism from the stack's tier (see domain.LangyTier):
//
//   - host-unsafe tier: a bare `go run` on the host (via `make service`), full host
//     access, the per-worker UID sandbox off (it needs root, which the developer's
//     own user is not). This is the fast-iteration tier.
//   - sandboxed / container-unsafe tiers: a `docker run` in colima. The sandboxed
//     tier keeps the UID sandbox on (production-like); the container-unsafe tier
//     turns it off but the VM still isolates the host. langyDockerHost is colima's
//     docker socket, resolved by Up before it plans; empty means the container
//     could not be prepared and this path is not reached.
func (o *Orchestrator) langyChild(st domain.Stack, opts PlanOptions, base []string, port int, langyDockerHost string) Child {
	if st.LangyTier.RunsInContainer() {
		ca := o.proxy.CACertPath()
		if ca == "" {
			if home, err := os.UserHomeDir(); err == nil {
				fallback := filepath.Join(home, ".portless", "ca.pem")
				if _, err := os.Stat(fallback); err == nil {
					ca = fallback
				}
			}
		}
		return Child{
			Name: "langyagent", Dir: opts.RepoRoot, Color: palette[6],
			Shell: langyContainerShell(langyContainerOpts{
				Slug:                  st.Slug,
				Port:                  port,
				Secret:                domain.DefaultLangyInternalSecret,
				DisableUIDSandbox:     st.LangyTier.DisablesUIDSandbox(),
				ObservabilityOTLPPort: st.ObservabilityOTLPPort,
				PortlessCACertPath:    ca,
			}),
			// Only DOCKER_HOST — the container is a clean environment; its langyagent
			// config rides the `docker run -e` flags, not the host overlay.
			Env: []string{"DOCKER_HOST=" + langyDockerHost},
		}
	}
	// Host tier: langyagent (the cmd/service mono-binary) takes its listen port from
	// PORT, not SERVER_ADDR (see services/langyagent/config.go) — PORT always wins.
	// Its sessions/workspace roots default to the in-container /workspace, which is
	// read-only on a dev host; point them at writable per-slug dirs under haven's
	// home and create them so the manager boots (session spawn still needs an
	// `opencode` binary on PATH, but the service itself comes up). The UID sandbox
	// is disabled — on the host the worker runs as the developer's own unprivileged
	// user, where the setuid + chown the sandbox needs would fail with EPERM.
	laRoot := filepath.Join(o.cfg.Home, "langyagent", st.Slug)
	_ = os.MkdirAll(filepath.Join(laRoot, "sessions"), 0o755)
	_ = os.MkdirAll(filepath.Join(laRoot, "workspace"), 0o755)
	return Child{
		Name: "langyagent", Dir: opts.RepoRoot, Color: palette[6],
		Shell: goServiceShell(opts.RepoRoot, "langyagent", opts.ShouldGoWatch),
		Env: append(append([]string{}, base...),
			fmt.Sprintf("PORT=%d", port),
			"SESSIONS_ROOT="+filepath.Join(laRoot, "sessions"),
			"LANGY_WORKSPACE_ROOT="+filepath.Join(laRoot, "workspace"),
			fmt.Sprintf("LANGY_MAX_WORKERS=%d", localLangyMaxWorkers),
			fmt.Sprintf("LANGY_WORKER_IDLE_MS=%d", langyWorkerIdleMS(localLangyWorkerIdleHostMS)),
			fmt.Sprintf("LANGY_REAPER_INTERVAL_MS=%d", localLangyReaperIntervalMS),
			"LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true",
		),
	}
}

// langyContainerOpts are the inputs to the `docker run` command for a
// containerized langyagent worker (the sandboxed / container-unsafe tiers).
type langyContainerOpts struct {
	Slug   string // per-worktree, names the container so restarts replace cleanly
	Port   int    // the manager's HTTP port, published to host loopback and set as PORT
	Secret string // the shared control-plane ↔ manager bearer secret
	Image  string // the image tag (defaults to langyImage when empty)
	// DisableUIDSandbox sets LANGY_UNSAFE_DEV_DISABLE_ISOLATION inside the container
	// — true only for the container-unsafe tier. The sandboxed tier leaves it unset
	// so the worker uses the ADR-033 per-worker UID sandbox (the container runs as
	// root, so setuid+chown work), exactly as production does.
	DisableUIDSandbox bool
	// ObservabilityOTLPPort, when non-zero, dual-exports the worker's own operational
	// telemetry (traces + logs + metrics) to the shared LGTM collector — the same
	// wiring the host-run Go services get via OverlayEnv. It is reached at
	// host.docker.internal, NOT 127.0.0.1: inside the container loopback is the
	// container itself, not the host the collector binds to. Zero when the
	// observability stack is down, and then nothing is added (prod-shaped no-op).
	ObservabilityOTLPPort int
	// PortlessCACertPath is mounted into the local worker container so Bun/Node
	// trusts Haven's HTTPS hostname certificate, just like host processes do.
	PortlessCACertPath string
}

func (o langyContainerOpts) image() string {
	if o.Image != "" {
		return o.Image
	}
	return langyImage
}

// containerName is the stable per-slug name so a restart replaces the previous
// container rather than colliding with it.
func (o langyContainerOpts) containerName() string {
	return "langyagent-" + o.Slug
}

// langyContainerShell builds the supervised child's shell for a containerized
// worker. It runs against colima's docker socket (DOCKER_HOST is set on the child
// env, not here). The container reaches the host control plane + gateway via the
// host.docker.internal overrides the overlay already injected; the host reaches
// the manager via the published loopback port. A stale container from a prior
// crash is force-removed first, then `exec docker run` makes the container the
// child's own process so the supervisor's SIGTERM stops it directly (and --rm
// cleans it up).
func langyContainerShell(o langyContainerOpts) string {
	run := []string{
		"docker", "run", "--rm",
		"--name", o.containerName(),
		// Keep a runaway local agent from taking the browser and the rest of the
		// development stack down with the Colima VM. memory-swap equal to memory
		// means Docker cannot silently spill beyond the hard cap.
		"--memory", localLangyContainerMemory,
		"--memory-swap", localLangyContainerMemory,
		"--cpus", localLangyContainerCPUs,
		"--pids-limit", fmt.Sprintf("%d", localLangyContainerPIDs),
		// Never touch a registry — the image is built locally into this colima
		// daemon. A missing image is a hard error, not a silent pull of something else.
		"--pull", "never",
		"-p", fmt.Sprintf("127.0.0.1:%d:%d", o.Port, o.Port),
		"-e", fmt.Sprintf("PORT=%d", o.Port),
		"-e", "ENVIRONMENT=local",
		// Pretty, human-readable console logging (clog reads LOG_FORMAT), matching the
		// host-run Go services and the TS app so every haven dev lane reads the same.
		// Unconditional in the container tier — it is always a human at the console.
		"-e", "LOG_FORMAT=pretty",
		"-e", "LANGY_INTERNAL_SECRET=" + o.Secret,
		"-e", fmt.Sprintf("LANGY_MAX_WORKERS=%d", localLangyMaxWorkers),
		"-e", fmt.Sprintf("LANGY_WORKER_IDLE_MS=%d", langyWorkerIdleMS(localLangyWorkerIdleMS)),
		"-e", fmt.Sprintf("LANGY_REAPER_INTERVAL_MS=%d", localLangyReaperIntervalMS),
	}
	if o.DisableUIDSandbox {
		run = append(run, "-e", "LANGY_UNSAFE_DEV_DISABLE_ISOLATION=true")
	}
	// Dual-export the worker's telemetry to the shared LGTM collector, exactly as
	// the host-run Go services do — but at host.docker.internal, since 127.0.0.1
	// inside the container is the container itself, not the host the collector binds
	// to. Tagged with the worktree so a dozen stacks stay filterable in Grafana.
	// OTEL_DEBUG_COLLECTOR_ENDPOINT is the langyagent config's dev-collector var
	// (config.OTel, dual-export — never the primary product pipeline); the resource
	// attr is read by the OTel SDK's env detector. Emitted only when the stack is up.
	if o.ObservabilityOTLPPort != 0 {
		run = append(run,
			"-e", fmt.Sprintf("OTEL_DEBUG_COLLECTOR_ENDPOINT=http://host.docker.internal:%d", o.ObservabilityOTLPPort),
			"-e", "OTEL_RESOURCE_ATTRIBUTES="+domain.ObservabilityWorktreeAttr+"="+o.Slug,
		)
	}
	if o.PortlessCACertPath != "" {
		const containerCA = "/etc/langwatch/portless-ca.pem"
		run = append(run,
			"-v", o.PortlessCACertPath+":"+containerCA+":ro",
			"-e", "NODE_EXTRA_CA_CERTS="+containerCA,
		)
	}
	run = append(run, o.image())

	quoted := make([]string, len(run))
	for i, a := range run {
		quoted[i] = shQuote(a)
	}
	return fmt.Sprintf("docker rm -f %s >/dev/null 2>&1; exec %s",
		shQuote(o.containerName()), strings.Join(quoted, " "))
}

// langyImageEnsureShell checks the image is present and builds it only when it is
// not, so a normal `up` pays nothing after the first (minutes-long) build. When
// forceRebuild is set (HAVEN_LANGY_REBUILD=1) it always rebuilds — the escape
// hatch for picking up langyagent source changes, since the presence check alone
// would keep running stale bytes. Runs from the repo root (the build context).
func langyImageEnsureShell(image string, forceRebuild bool) string {
	build := fmt.Sprintf("docker build -f Dockerfile.langyagent -t %s .", shQuote(image))
	if forceRebuild {
		return build
	}
	return fmt.Sprintf("docker image inspect %s >/dev/null 2>&1 || %s", shQuote(image), build)
}

// shQuote single-quotes a shell argument, escaping embedded single quotes. Every
// value here is a controlled constant today, but quoting keeps a future value with
// a shell metacharacter from breaking out of the command.
func shQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", `'\''`) + "'"
}
