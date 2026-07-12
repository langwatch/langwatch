package langyagent

import (
	"context"
	"net"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/app/workerpool"
	"github.com/langwatch/langwatch/services/langyagent/transport/rpc"
)

// Serve wires the app into HTTP transport and pkg/lifecycle management,
// blocking until shutdown. Services stop in reverse registration order, so the
// HTTP listener stops accepting first, then the worker pool drains (killing
// each opencode subprocess), then OTel flushes.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config) error {
	deps.Logger.Info("langyagent_starting",
		zap.String("addr", cfg.Server.Addr),
		zap.Int("max_workers", cfg.MaxWorkers),
	)

	info := contexts.MustGetServiceInfo(ctx)
	handler := rpc.NewRouter(rpc.RouterDeps{
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

		// Seed every request context with the service logger (which already carries
		// service/version/env fields) so clog.Get(ctx) is authoritative from the
		// first middleware down through the app — the Telemetry middleware then
		// layers request fields, and the handlers layer conversation/turn ids, all
		// inherited by every log the turn emits. A detached context.Background keeps
		// in-flight streams alive across shutdown (lifecycle.ListenServer drains).
		BaseContext: func(net.Listener) context.Context {
			return clog.Set(context.Background(), deps.Logger)
		},
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
		// otel-early-flush (PR3, ADR-044): on SIGTERM, force-flush buffered
		// telemetry BEFORE the worker drain so a grace period later cut short by
		// SIGKILL still ships what we already have. Registered BEFORE the handoff
		// Closer below so it stops AFTER it (reverse-order). ForceFlushGlobal
		// flushes the tracer provider and the meter provider; the full Shutdown of
		// "otel" (registered first) still runs LAST. HONEST LIMIT: SIGKILL / OOM are
		// uncatchable — this narrows the loss window, it is not a zero-loss
		// guarantee. Bounded so a dead collector can't eat the grace budget out from
		// under the worker drain.
		lifecycle.Closer("otel-early-flush", func(ctx context.Context) error {
			flushCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			defer cancel()
			otelsetup.ForceFlushGlobal(flushCtx)
			return nil
		}),
		// ADR-048 shutdown-handoff. Registered LAST so it stops FIRST on SIGTERM
		// (reverse-order): before the http listener drains and well before the
		// worker-pool process-group kill, notify each live worker that shutdown is
		// imminent so opencode checkpoints the in-flight turn and emits a terminal
		// `handoff` frame. The frame flows out over the still-open /chat response
		// (ListenServer keeps in-flight requests alive via WithoutCancel) to the
		// control plane, which persists the resume token.
		//
		// COMPOSES WITH THE EARLY-FLUSH ABOVE: both are pre-drain SIGTERM steps.
		// Stop order is handoff -> early-flush -> http -> worker-pool (this one is
		// registered after early-flush, so it stops first). Neither depends on the
		// other; both must finish before the worker drain. Its goroutines are
		// panic-guarded with clog.Go (PR3), so a panic mid-shutdown can't crash
		// the process before the drain.
		//
		// The deadline is capped to always leave the drain its budget before the
		// graceful window closes (deadline < gracefulDeadline - drainBudget),
		// which holds regardless of any lifecycle drain-delay already consumed —
		// the honest ADR-048 math (graceful < terminationGracePeriodSeconds, so
		// deadline < TGP - drainBudget; SIGKILL is still uncatchable).
		lifecycle.Closer("langy-shutdown-handoff", func(ctx context.Context) error {
			deadline := time.Now().Add(cfg.ShutdownHandoffDeadline())
			if dl, ok := ctx.Deadline(); ok {
				latest := dl.Add(-cfg.ShutdownDrainBudget())
				if deadline.After(latest) {
					deadline = latest
				}
			}
			application.Pool().ShutdownHandoff(ctx, deadline)
			return nil
		}),
	)
	return g.Run(ctx)
}
