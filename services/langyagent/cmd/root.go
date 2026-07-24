// Package cmd exposes the langyagent service entrypoint for the mono-binary
// (cmd/service). Mirrors the aigateway / nlpgo pattern: LoadConfig → NewDeps →
// wire adapters → Serve.
package cmd

import (
	"context"

	"github.com/langwatch/langwatch/pkg/contexts"
	langyagent "github.com/langwatch/langwatch/services/langyagent"
	"github.com/langwatch/langwatch/services/langyagent/adapters/controlplane"
	"github.com/langwatch/langwatch/services/langyagent/adapters/runner/localunsafe"
	"github.com/langwatch/langwatch/services/langyagent/adapters/runner/sandboxed"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/app/workerpool"
)

// Root is the service entrypoint called by cmd/service. Errors returned here
// cause `service langyagent` to exit non-zero — missing LANGY_INTERNAL_SECRET,
// an unparseable PORT, etc. fail fast at container start rather than at first
// traffic.
func Root(ctx context.Context, _ []string) error {
	cfg, err := langyagent.LoadConfig(ctx)
	if err != nil {
		return err
	}

	info := contexts.MustGetServiceInfo(ctx)
	info.Service = "langwatch-service-langyagent"
	info.Environment = cfg.Environment
	ctx = contexts.SetServiceInfo(ctx, *info)

	ctx, deps, err := langyagent.NewDeps(ctx, cfg)
	if err != nil {
		return err
	}

	// The egress guard (ADR-043): per-worker outbound forward-proxy enforcement
	// (require-TLS / throttle / floor ∪ allow-list / SNI cross-check), monitor-
	// first. Stock posture is monitor-only until an operator/customer opts in.
	// The pool consults it around each worker's lifecycle behind this seam.
	mgr := startEgressAdapter(cfg, deps.Logger)

	// The isolation substrate (ADR-033 secure-vs-local seam): sandboxed setuid +
	// chown in production; the unprivileged local-dev runner ONLY when the operator
	// armed LANGY_UNSAFE_DEV_DISABLE_ISOLATION. LoadConfig already refused that flag
	// outside a local-like environment; localunsafe.New re-checks ENVIRONMENT as an
	// independent second guard, so the no-isolation substrate can never be built in
	// production even if the config guard were bypassed.
	var runner app.Runner = sandboxed.New()
	if cfg.UnsafeDevDisableIsolation {
		local, lerr := localunsafe.New(cfg.Environment)
		if lerr != nil {
			return lerr
		}
		runner = local
	}

	// The worker pool is the driven adapter. It wipes SESSIONS_ROOT before
	// accepting traffic and binds worker subprocesses to the pool-lifetime
	// context. The egress guard is consulted around each worker's lifecycle.
	pool, err := workerpool.New(ctx, workerpool.Options{
		MaxWorkers:         cfg.MaxWorkers,
		WorkerIdle:         cfg.WorkerIdle(),
		ReadinessTimeout:   cfg.ReadinessTimeout(),
		ReaperInterval:     cfg.ReaperInterval(),
		SessionsRoot:       cfg.SessionsRoot,
		WorkspaceRoot:      cfg.WorkspaceRoot,
		OpenCodeBinaryPath: cfg.OpenCodeBinaryPath,
		Runner:             runner,
		Telemetry:          deps.Telemetry,
		Egress:             mgr.EgressGuard(),
		// Revoke-only. The manager can destroy a session key it was handed; it can
		// never ask for one to be minted. It reuses the SAME shared secret the
		// control plane authenticates to us with, so this direction adds no new
		// credential and no new configuration to drift.
		Revoker: controlplane.NewRevoker(cfg.InternalSecret, 0),
		// Host-mediated worker telemetry + LLM traffic: workers export OTLP to
		// this loopback relay keyless and route LLM calls through it; the manager
		// injects the session key / virtual key on the forwards.
		OTelRelay: deps.OTelRelay,
	})
	if err != nil {
		return err
	}

	application := app.New(
		app.WithWorkerPool(pool),
		app.WithTelemetry(deps.Telemetry),
		// Durable-final poster: same shared secret as the Revoker, no new config.
		// The independent completion path back to langy-internal, retried and
		// idempotent on turnId.
		app.WithFinalizer(controlplane.NewFinalizer(cfg.InternalSecret, 0)),
		// Relay push: the live edge. The manager SIGNS each output frame with the
		// turn's runToken and streams it to the control-plane relay — same shared
		// secret, no new config. Disabled per-turn when no runToken rides the turn.
		app.WithFrameRelay(controlplane.NewRelayClient(cfg.InternalSecret)),
	)

	return langyagent.Serve(ctx, application, deps, cfg)
}
