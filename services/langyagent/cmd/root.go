// Package cmd exposes the langyagent service entrypoint for the mono-binary
// (cmd/service). Mirrors the aigateway / nlpgo pattern: LoadConfig → NewDeps →
// wire adapters → Serve.
package cmd

import (
	"context"

	"github.com/langwatch/langwatch/pkg/contexts"
	langyagent "github.com/langwatch/langwatch/services/langyagent"
	"github.com/langwatch/langwatch/services/langyagent/adapters/workerpool"
	"github.com/langwatch/langwatch/services/langyagent/app"
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

	// The worker pool is the driven adapter. It wipes SESSIONS_ROOT before
	// accepting traffic and binds worker subprocesses to the pool-lifetime
	// context. The egress guard is consulted around each worker's lifecycle.
	pool, err := workerpool.New(ctx, workerpool.Options{
		MaxWorkers:          cfg.MaxWorkers,
		WorkerIdle:          cfg.WorkerIdle(),
		ReadinessTimeout:    cfg.ReadinessTimeout(),
		ReaperInterval:      cfg.ReaperInterval(),
		SessionsRoot:        cfg.SessionsRoot,
		WorkspaceRoot:       cfg.WorkspaceRoot,
		OpenCodeBinaryPath:  cfg.OpenCodeBinaryPath,
		OTelPluginVersion:   cfg.OTelPluginVersion,
		DisableUIDIsolation: cfg.UnsafeDevDisableIsolation,
		Telemetry:           deps.Telemetry,
		Egress:              mgr.EgressGuard(),
	})
	if err != nil {
		return err
	}

	application := app.New(
		app.WithLogger(deps.Logger),
		app.WithWorkerPool(pool),
		app.WithTelemetry(deps.Telemetry),
	)

	return langyagent.Serve(ctx, application, deps, cfg)
}
