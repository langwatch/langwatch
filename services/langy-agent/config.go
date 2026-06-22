// Package langyagent is the Langy manager — process-pool model.
//
// One pod, one of THIS process. Per conversation, we spawn a dedicated
// `opencode` subprocess and route all of that conversation's turns to it.
// Credentials are NEVER held by the manager process; they arrive in each
// request body, get injected into the worker subprocess's env at spawn
// time, and die with the subprocess. This is the only thing that makes
// per-session isolation real — the OS kernel won't let worker A read
// worker B's env even though they live in the same pod.
//
// HTTP API:
//
//	POST /chat   (Bearer ${LANGY_INTERNAL_SECRET})
//	  body: { conversationId, prompt, system?, credentials: {
//	           langwatchApiKey, llmVirtualKey, gatewayBaseUrl,
//	           langwatchEndpoint }, modelOverride? }
//	  resp: application/x-ndjson stream of opencode events
//	GET /health
//	  resp: text/plain "ok (N/MAX workers)"
//
// Lifecycle:
//   - Workers spawn on first message of a conversation (~1-2s cold start)
//   - Reused for subsequent turns of the same conversation
//   - Killed on idle timeout (LANGY_WORKER_IDLE_MS, default 10 min)
//   - Killed on SIGTERM (pod shutdown)
//   - Killed if opencode dies on its own
//   - Cap at MAX_WORKERS concurrent; 503 when full
package langyagent

import (
	"context"
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config is the manager's runtime configuration. Loaded from env at
// startup; not reloaded — operators restart the pod to change anything.
type Config struct {
	Port               int
	InternalSecret     string
	MaxWorkers         int
	WorkerIdle         time.Duration
	ReadinessTimeout   time.Duration
	ReaperInterval     time.Duration
	SessionsRoot       string
	MaxBodyBytes       int64
	GracefulShutdown   time.Duration
	OTelPluginVersion  string
	OpenCodeBinaryPath string
}

const (
	defaultPort              = 8080
	defaultMaxWorkers        = 20
	defaultWorkerIdle        = 10 * time.Minute
	defaultReadinessTimeout  = 15 * time.Second
	defaultReaperInterval    = 30 * time.Second
	defaultSessionsRoot      = "/workspace/sessions"
	defaultMaxBodyBytes      = 1_000_000 // 1MB cap on /chat body so a hostile manager-internal caller can't OOM the pod.
	defaultGracefulShutdown  = 10 * time.Second
	defaultOTelPluginVersion = "1.0.0"
)

// LoadConfig hydrates Config from env. Required fields fail fast.
func LoadConfig(_ context.Context) (Config, error) {
	cfg := Config{
		Port:               defaultPort,
		MaxWorkers:         defaultMaxWorkers,
		WorkerIdle:         defaultWorkerIdle,
		ReadinessTimeout:   defaultReadinessTimeout,
		ReaperInterval:     defaultReaperInterval,
		SessionsRoot:       defaultSessionsRoot,
		MaxBodyBytes:       defaultMaxBodyBytes,
		GracefulShutdown:   defaultGracefulShutdown,
		OTelPluginVersion:  defaultOTelPluginVersion,
		OpenCodeBinaryPath: "opencode",
	}

	if v := os.Getenv("PORT"); v != "" {
		p, err := strconv.Atoi(v)
		if err != nil || p <= 0 || p > 65535 {
			return cfg, fmt.Errorf("invalid PORT %q", v)
		}
		cfg.Port = p
	}

	cfg.InternalSecret = os.Getenv("LANGY_INTERNAL_SECRET")
	if cfg.InternalSecret == "" {
		return cfg, fmt.Errorf("LANGY_INTERNAL_SECRET is required")
	}

	if v := os.Getenv("LANGY_MAX_WORKERS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			return cfg, fmt.Errorf("invalid LANGY_MAX_WORKERS %q", v)
		}
		cfg.MaxWorkers = n
	}
	if v := os.Getenv("LANGY_WORKER_IDLE_MS"); v != "" {
		ms, err := strconv.ParseInt(v, 10, 64)
		if err != nil || ms <= 0 {
			return cfg, fmt.Errorf("invalid LANGY_WORKER_IDLE_MS %q", v)
		}
		cfg.WorkerIdle = time.Duration(ms) * time.Millisecond
	}
	if v := os.Getenv("LANGY_READINESS_TIMEOUT_MS"); v != "" {
		ms, err := strconv.ParseInt(v, 10, 64)
		if err != nil || ms <= 0 {
			return cfg, fmt.Errorf("invalid LANGY_READINESS_TIMEOUT_MS %q", v)
		}
		cfg.ReadinessTimeout = time.Duration(ms) * time.Millisecond
	}
	if v := os.Getenv("OPENCODE_OTEL_PLUGIN_VERSION"); v != "" {
		cfg.OTelPluginVersion = v
	}

	return cfg, nil
}
