// Package cmd exposes the langy-agent service entrypoint for the mono-binary
// (cmd/service). Mirrors the aigateway / nlpgo pattern: LoadConfig → NewDeps →
// wire adapters → Serve.
package cmd

import (
	"context"

	"github.com/langwatch/langwatch/pkg/contexts"
	langyagent "github.com/langwatch/langwatch/services/langy-agent"
	"github.com/langwatch/langwatch/services/langy-agent/adapters/egress"
	"github.com/langwatch/langwatch/services/langy-agent/adapters/workerpool"
	"github.com/langwatch/langwatch/services/langy-agent/app"
)

// Root is the service entrypoint called by cmd/service. Errors returned here
// cause `service langy-agent` to exit non-zero — missing LANGY_INTERNAL_SECRET,
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

	// The worker pool is the driven adapter. It wipes SESSIONS_ROOT before
	// accepting traffic and binds worker subprocesses to the pool-lifetime
	// context. The egress guard is the ADR-043 stub seam (pass-through in PR1;
	// PR3 slots real monitoring in without touching the pool).
	pool, err := workerpool.New(ctx, workerpool.Options{
		MaxWorkers:         cfg.MaxWorkers,
		WorkerIdle:         cfg.WorkerIdle(),
		ReadinessTimeout:   cfg.ReadinessTimeout(),
		ReaperInterval:     cfg.ReaperInterval(),
		SessionsRoot:       cfg.SessionsRoot,
		OpenCodeBinaryPath: cfg.OpenCodeBinaryPath,
		OTelPluginVersion:  cfg.OTelPluginVersion,
		Telemetry:          deps.Telemetry,
		Egress:             egress.NewPassThrough(),
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
