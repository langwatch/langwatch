// Package langyagent is the langyagent manager — process-pool model.
//
// One pod, one of THIS process. Per conversation, we spawn a dedicated
// `opencode` subprocess and route all of that conversation's turns to it.
// Credentials are NEVER held by the manager process; they arrive in each
// request body, get injected into the worker subprocess's env at spawn time,
// and die with the subprocess. This is the only thing that makes per-session
// isolation real — the OS kernel won't let worker A read worker B's env even
// though they live in the same pod. See ADR-033 (isolation) and ADR-047 (this
// re-home).
//
// HTTP API:
//
//	POST /worker/{create,revive,continue}  (Bearer ${LANGY_INTERNAL_SECRET})
//	                                                 → application/x-ndjson turn stream
//	                                                   (intent labels; same turn logic)
//	POST /warm  /worker/probe                        → pre-flight (spawn / liveness)
//	GET  /health                                     → "ok (N/MAX workers)" (legacy alias)
//	GET  /healthz /readyz /startupz                  → k8s probes (pkg/health)
//
// Scaling & lifecycle (see ADR-047 "Durability, restart, and scaling"):
//   - SINGLE REPLICA ONLY. Workers live in-memory keyed by conversationId; the
//     chart pins replicaCount=1 with a render-time guard. Not horizontally
//     scalable until conversation-sticky routing exists.
//   - Workers are CHILDREN of this process (PID 1 in the pod). If the manager
//     restarts, the pod restarts and every worker dies with it; SESSIONS_ROOT
//     is wiped on boot. Conversations resume by lazily respawning a fresh
//     worker on the next turn — durable state (history, per-session key) lives
//     outside this process, in the control plane. A turn that was mid-flight
//     when the pod died is lost (no idempotency yet — event-sourced recovery is
//     a later PR in the stack).
package langyagent

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
)

// Config is the manager's runtime configuration. Loaded from env at startup via
// pkg/config (env tags → Hydrate, validate tags → Validate); not reloaded —
// operators restart the pod to change anything.
type Config struct {
	Environment string        `env:"ENVIRONMENT"`
	Log         clog.Config   `env:"LOG"`
	OTel        config.OTel   `env:"OTEL"`
	Server      config.Server `env:"SERVER"`

	// Port is the HTTP listen port. Kept as its own env var (PORT) rather than
	// SERVER_ADDR so the existing deployment contract is unchanged; Server.Addr
	// is derived from it in LoadConfig.
	Port int `env:"PORT" validate:"gt=0,lte=65535"`

	// InternalSecret is the service-to-service bearer secret the control plane
	// presents on /chat. Required — the manager fails fast without it.
	InternalSecret string `env:"LANGY_INTERNAL_SECRET" validate:"required"`

	MaxWorkers         int    `env:"LANGY_MAX_WORKERS" validate:"gt=0"`
	WorkerIdleMS       int64  `env:"LANGY_WORKER_IDLE_MS" validate:"gt=0"`
	ReaperIntervalMS   int64  `env:"LANGY_REAPER_INTERVAL_MS" validate:"gt=0"`
	ReadinessTimeoutMS int64  `env:"LANGY_READINESS_TIMEOUT_MS" validate:"gt=0"`
	SessionsRoot       string `env:"SESSIONS_ROOT" validate:"required"`

	// ShutdownHandoffDeadlineMS (ADR-048) is the wall-clock budget the manager
	// gives each live worker to checkpoint on SIGTERM before the process-group
	// kill. The `deadline` posted to a worker is now + this. MUST leave room for
	// the drain: LoadConfig fails closed if
	// ShutdownHandoffDeadlineMS + ShutdownDrainBudgetMS >= GracefulSeconds*1000
	// (see the ADR-048 deadline math — SIGKILL is uncatchable, so the whole
	// handoff+drain must fit inside the graceful window, which the operator sizes
	// below the pod terminationGracePeriodSeconds).
	ShutdownHandoffDeadlineMS int64 `env:"LANGY_SHUTDOWN_HANDOFF_DEADLINE_MS" validate:"gte=0"`
	// ShutdownDrainBudgetMS (ADR-048) is the time reserved AFTER the handoff for
	// the worker-pool drain (per-worker SIGINT -> 2s grace -> SIGKILL, authproxy
	// teardown, margin). Subtracted from the graceful window so the handoff
	// deadline can never eat the drain budget out from under the kill.
	ShutdownDrainBudgetMS int64 `env:"LANGY_SHUTDOWN_DRAIN_BUDGET_MS" validate:"gte=0"`

	// Egress enforcement (ADR-043). These configure the per-worker egress
	// forward proxy the manager spawns for each worker (see adapters/egress).
	//
	// EgressFqdnFloor is the operator-owned always-allowed set (github /
	// gateway / control plane) — a floor, not a per-project policy. Additive to
	// each project's customer allow-list (which rides the credentials envelope);
	// never a ceiling by itself unless EgressEnforceFloor is on. Comma-separated
	// (config.Hydrate has no []string support) and split in cmd.
	EgressFqdnFloor string `env:"LANGY_EGRESS_FQDN_FLOOR"`
	// EgressRequireTLS refuses cleartext forwards and non-:443 CONNECTs
	// (rung 1a). Default ON — worker egress is HTTPS already, so this is the
	// always-safe rung. (A malformed bool env fails the pod closed at startup.)
	EgressRequireTLS bool `env:"LANGY_EGRESS_REQUIRE_TLS"`
	// EgressEnforceFloor makes the floor a hard ceiling for projects that set
	// no allow-list (rung 3 "always-on floor"). Default OFF so the stock
	// posture stays monitor-only: an install that configures nothing upgrades
	// into watching, not blocking.
	EgressEnforceFloor bool `env:"LANGY_EGRESS_ENFORCE_FLOOR"`
	// EgressSNICrossCheck peeks the TLS ClientHello SNI as an anti-fronting
	// cross-check of the CONNECT authority. Default ON.
	EgressSNICrossCheck bool `env:"LANGY_EGRESS_SNI_CROSSCHECK"`

	// WorkspaceRoot is the directory the manager materializes the embedded skills
	// tree into at boot (workerpool.New → internal/assets.MaterializeSkills), and
	// that setupWorkerHome symlinks ${WorkspaceRoot}/skills into each worker home.
	// AGENTS.md is NOT here — it is read from the embedded binary. In the container
	// this is /workspace (an emptyDir). Overridable so the manager can run OUTSIDE
	// the container in local dev, where `/workspace` cannot be created at the
	// filesystem root — point it at any writable dir (the manager fills skills/
	// itself). Independent of SESSIONS_ROOT (the per-conversation home dirs).
	WorkspaceRoot string `env:"LANGY_WORKSPACE_ROOT" validate:"required"`

	// UnsafeDevDisableIsolation disables the ADR-033 per-worker UID sandbox: no
	// os.Chown of worker homes/config to a per-conversation UID, and no setuid
	// Credential on the opencode subprocess (it runs as the manager's own user).
	// This exists ONLY so the manager can spawn opencode on a LOCAL DEV box where
	// it runs as an unprivileged user — there, the chown and the setuid Credential
	// both fail with EPERM (they require root + CAP_SETUID/CAP_SETGID/CAP_CHOWN)
	// and no worker can start at all. Enabling it DESTROYS sibling-worker
	// isolation: every worker runs under one UID, so worker A can read worker B's
	// plaintext credentials on the shared volume. It MUST only ever be used
	// locally — LoadConfig hard-refuses it whenever ENVIRONMENT is not a
	// local-like value (see environmentPermitsUnsafeDev), so it can never be
	// switched on in production.
	UnsafeDevDisableIsolation bool `env:"LANGY_UNSAFE_DEV_DISABLE_ISOLATION"`

	// OpenCodeBinaryPath is the opencode executable (resolved via PATH). Not
	// env-configurable in the original; kept as a fixed default so behaviour is
	// unchanged, but overridable in tests.
	OpenCodeBinaryPath string
}

const (
	defaultPort               = 8080
	defaultMaxWorkers         = 20
	defaultWorkerIdleMS       = 600_000 // 10 min
	defaultReadinessTimeoutMS = 15_000  // 15s (the chart raises this to 60s for gVisor cold boot)
	defaultReaperIntervalMS   = 30_000  // 30s
	defaultSessionsRoot       = "/workspace/sessions"
	defaultWorkspaceRoot      = "/workspace"
	defaultGracefulSeconds    = 10
	// defaultMaxBodyBytes caps the /chat body at 1MB so a hostile
	// manager-internal caller can't OOM the pod. Deliberately far below the
	// shared config.DefaultMaxRequestBodyBytes (128 MiB) — /chat carries a short
	// prompt + credentials, never large-context LLM payloads.
	defaultMaxBodyBytes = 1_000_000
	// ADR-048 shutdown-handoff budgets (ms). Defaults sum to 8s, comfortably
	// under the 10s default graceful window; the operator sizes
	// terminationGracePeriodSeconds above the graceful window.
	defaultShutdownHandoffDeadlineMS = 5_000
	defaultShutdownDrainBudgetMS     = 3_000
)

func defaultConfig() Config {
	return Config{
		Environment: "local",
		Port:        defaultPort,
		Server: config.Server{
			GracefulSeconds:     defaultGracefulSeconds,
			MaxRequestBodyBytes: defaultMaxBodyBytes,
		},
		MaxWorkers:                defaultMaxWorkers,
		WorkerIdleMS:              defaultWorkerIdleMS,
		ReaperIntervalMS:          defaultReaperIntervalMS,
		ReadinessTimeoutMS:        defaultReadinessTimeoutMS,
		SessionsRoot:              defaultSessionsRoot,
		WorkspaceRoot:             defaultWorkspaceRoot,
		OpenCodeBinaryPath:        "opencode",
		ShutdownHandoffDeadlineMS: defaultShutdownHandoffDeadlineMS,
		ShutdownDrainBudgetMS:     defaultShutdownDrainBudgetMS,
		// ADR-043 rung 1a + SNI cross-check are the always-safe rungs; both
		// default ON. Unset env leaves these defaults (Hydrate skips empty env),
		// so an install that configures nothing still requires TLS and cross-
		// checks SNI. EgressEnforceFloor defaults OFF (zero value) — the floor
		// stays monitor-only until an operator flips it after reading monitoring.
		EgressRequireTLS:    true,
		EgressSNICrossCheck: true,
		OTel: config.OTel{
			// Left unset so an operator-supplied ratio is distinguishable
			// from the default; resolved in LoadConfig.
			SampleRatio: config.UnsetSampleRatio,
		},
	}
}

// LoadConfig hydrates the service config from environment variables.
func LoadConfig(ctx context.Context) (Config, error) {
	cfg := defaultConfig()
	if err := config.Hydrate(&cfg); err != nil {
		return Config{}, err
	}
	// Derive the listen address from PORT (kept as its own env var). Set after
	// Hydrate so PORT always wins over any stray SERVER_ADDR.
	cfg.Server.Addr = fmt.Sprintf(":%d", cfg.Port)
	cfg.OTel.ResolveSampleRatio(cfg.Environment)
	if err := cfg.Log.Validate(); err != nil {
		return Config{}, err
	}
	if err := config.Validate(ctx, cfg); err != nil {
		return Config{}, err
	}
	// Fail closed: the unsafe UID-isolation bypass may only be armed in a
	// local-like environment. Checked AFTER hydrate+validate so cfg.Environment
	// reflects the real ENVIRONMENT value. environmentPermitsUnsafeDev is an
	// allowlist, so any non-local environment (production, staging, an unknown
	// "prod-eu", or an empty value that isn't the local default) refuses the flag.
	if cfg.UnsafeDevDisableIsolation && !environmentPermitsUnsafeDev(cfg.Environment) {
		return Config{}, fmt.Errorf(
			"LANGY_UNSAFE_DEV_DISABLE_ISOLATION cannot be enabled when ENVIRONMENT=%q — per-worker isolation may only be disabled in local development",
			cfg.Environment,
		)
	}
	// ADR-048 deadline math: the handoff budget plus the drain budget must fit
	// strictly inside the graceful shutdown window, so the worker-authored
	// checkpoint AND the process-group kill that follows both complete before the
	// graceful deadline — which the operator in turn sizes below the pod's
	// terminationGracePeriodSeconds (SIGKILL is uncatchable). A config that
	// violates this would post a `deadline` the worker cannot meet before the kill.
	gracefulMS := int64(cfg.Server.GracefulSeconds) * 1000
	if gracefulMS > 0 && cfg.ShutdownHandoffDeadlineMS+cfg.ShutdownDrainBudgetMS >= gracefulMS {
		return Config{}, fmt.Errorf(
			"LANGY_SHUTDOWN_HANDOFF_DEADLINE_MS (%d) + LANGY_SHUTDOWN_DRAIN_BUDGET_MS (%d) must be < the graceful shutdown window (%d ms) — see ADR-048 deadline math",
			cfg.ShutdownHandoffDeadlineMS, cfg.ShutdownDrainBudgetMS, gracefulMS,
		)
	}
	return cfg, nil
}

// environmentPermitsUnsafeDev reports whether env is a local-like environment in
// which the ADR-033 per-worker UID sandbox may be disabled. It is an ALLOWLIST,
// not a production denylist: only the explicitly-listed local-like values return
// true, so a novel or misconfigured environment name (e.g. "prod-eu", "staging",
// or an empty string) fails closed and NEVER permits the bypass. Matching is
// case-insensitive and trims surrounding whitespace.
func environmentPermitsUnsafeDev(env string) bool {
	switch strings.ToLower(strings.TrimSpace(env)) {
	case "local", "dev", "development", "test":
		return true
	default:
		return false
	}
}

// WorkerIdle is the idle duration after which a worker is reaped.
func (c Config) WorkerIdle() time.Duration {
	return time.Duration(c.WorkerIdleMS) * time.Millisecond
}

// ReadinessTimeout is how long a spawn waits for opencode to become ready.
func (c Config) ReadinessTimeout() time.Duration {
	return time.Duration(c.ReadinessTimeoutMS) * time.Millisecond
}

// ReaperInterval is the idle-sweep tick.
func (c Config) ReaperInterval() time.Duration {
	return time.Duration(c.ReaperIntervalMS) * time.Millisecond
}

// ShutdownHandoffDeadline is the budget a live worker gets to checkpoint on
// SIGTERM before the process-group kill (ADR-048).
func (c Config) ShutdownHandoffDeadline() time.Duration {
	return time.Duration(c.ShutdownHandoffDeadlineMS) * time.Millisecond
}

// ShutdownDrainBudget is the time reserved after the handoff for the worker
// drain (ADR-048).
func (c Config) ShutdownDrainBudget() time.Duration {
	return time.Duration(c.ShutdownDrainBudgetMS) * time.Millisecond
}
