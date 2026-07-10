package langyagent

import (
	"context"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/langy-agent/adapters/httpapi"
	"github.com/langwatch/langwatch/services/langy-agent/adapters/workerpool"
	"github.com/langwatch/langwatch/services/langy-agent/app"
)

// Serve wires the app into HTTP transport and pkg/lifecycle management,
// blocking until shutdown. Services stop in reverse registration order, so the
// HTTP listener stops accepting first, then the worker pool drains (killing
// each opencode subprocess), then OTel flushes.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config) error {
	deps.Logger.Info("langy_agent_starting",
		zap.String("addr", cfg.Server.Addr),
		zap.Int("max_workers", cfg.MaxWorkers),
	)

	info := contexts.MustGetServiceInfo(ctx)
	handler := httpapi.NewRouter(httpapi.RouterDeps{
		App:                 application,
		Logger:              deps.Logger,
		Health:              deps.Health,
		Version:             info.Version,
		InternalSecret:      cfg.InternalSecret,
		MaxRequestBodyBytes: cfg.Server.MaxRequestBodyBytes,
	})

	srv := &http.Server{
		Handler:           handler,
		Addr:              cfg.Server.Addr,
		ReadHeaderTimeout: 10 * time.Second,
		// No ReadTimeout / WriteTimeout — /chat streams arbitrarily long ndjson
		// responses (the worker keeps producing for as long as the LLM keeps
		// generating). Per-handler cancellation drives the deadline instead.
	}

	g := lifecycle.New(
		lifecycle.WithGraceful(time.Duration(cfg.Server.GracefulSeconds)*time.Second),
		lifecycle.WithHealth(deps.Health),
	)
	g.Add(
		lifecycle.Closer("otel", deps.OTel.Shutdown),
		// The PID-1 orphan reaper: opencode's children (gh/git/npm) reparent to
		// the manager on worker kill; only PID 1 may reap them. Fire-and-forget,
		// stops when the group context cancels.
		lifecycle.Worker("orphan-reaper", func(ctx context.Context) {
			workerpool.StartOrphanReaper(ctx)
		}, func() {}),
		// The worker pool: Start begins the idle-reaper sweep; Stop tears down
		// every worker (process-group kill) and cancels the pool context that
		// worker subprocesses are bound to.
		lifecycle.Worker("worker-pool", func(context.Context) {
			application.Pool().StartReaper()
		}, func() {
			application.Pool().Shutdown()
		}),
		lifecycle.ListenServer("http", srv),
	)
	return g.Run(ctx)
}
