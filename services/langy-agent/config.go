// Package langyagent is the langy-agent manager — process-pool model.
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
//	POST /chat   (Bearer ${LANGY_INTERNAL_SECRET})   → application/x-ndjson stream
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
	ReadinessTimeoutMS int64  `env:"LANGY_READINESS_TIMEOUT_MS" validate:"gt=0"`
	SessionsRoot       string `env:"SESSIONS_ROOT" validate:"required"`
	OTelPluginVersion  string `env:"OPENCODE_OTEL_PLUGIN_VERSION" validate:"required"`

	// OpenCodeBinaryPath is the opencode executable (resolved via PATH). Not
	// env-configurable in the original; kept as a fixed default so behaviour is
	// unchanged, but overridable in tests.
	OpenCodeBinaryPath string

	// reaperInterval is the idle-sweep tick. Fixed (not env-configurable in the
	// original), exposed via ReaperInterval().
	reaperInterval time.Duration
}

const (
	defaultPort               = 8080
	defaultMaxWorkers         = 20
	defaultWorkerIdleMS       = 600_000 // 10 min
	defaultReadinessTimeoutMS = 15_000  // 15s (the chart raises this to 60s for gVisor cold boot)
	defaultReaperInterval     = 30 * time.Second
	defaultSessionsRoot       = "/workspace/sessions"
	defaultGracefulSeconds    = 10
	// defaultMaxBodyBytes caps the /chat body at 1MB so a hostile
	// manager-internal caller can't OOM the pod. Deliberately far below the
	// shared config.DefaultMaxRequestBodyBytes (128 MiB) — /chat carries a short
	// prompt + credentials, never large-context LLM payloads.
	defaultMaxBodyBytes      = 1_000_000
	defaultOTelPluginVersion = "1.0.0"
)

func defaultConfig() Config {
	return Config{
		Environment: "local",
		Port:        defaultPort,
		Server: config.Server{
			GracefulSeconds:     defaultGracefulSeconds,
			MaxRequestBodyBytes: defaultMaxBodyBytes,
		},
		MaxWorkers:         defaultMaxWorkers,
		WorkerIdleMS:       defaultWorkerIdleMS,
		ReadinessTimeoutMS: defaultReadinessTimeoutMS,
		SessionsRoot:       defaultSessionsRoot,
		OTelPluginVersion:  defaultOTelPluginVersion,
		OpenCodeBinaryPath: "opencode",
		reaperInterval:     defaultReaperInterval,
		OTel: config.OTel{
			SampleRatio: 1.0, // overridden to 0.1 for non-local in LoadConfig
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
	if cfg.OTel.SampleRatio == 1.0 && cfg.Environment != "local" {
		cfg.OTel.SampleRatio = 0.1
	}
	if err := cfg.Log.Validate(); err != nil {
		return Config{}, err
	}
	if err := config.Validate(ctx, cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
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
	if c.reaperInterval <= 0 {
		return defaultReaperInterval
	}
	return c.reaperInterval
}
