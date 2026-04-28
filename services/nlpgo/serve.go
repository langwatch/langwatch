package nlpgo

import (
	"context"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// Serve wires the app into HTTP transport and lifecycle management,
// blocking until shutdown.
//
// Service ordering is load-bearing on AWS Lambda: the HTTP listener must
// bind $PORT before the uvicorn-child waitHealthy poll runs, otherwise
// the Lambda init phase (10-second hard limit) times out before the
// adapter sees the port. With the listener up first, init completes in
// milliseconds and the uvicorn-child startup happens in the background;
// /go/* paths (the FF-on hot path) work immediately because they don't
// touch the proxy, and /studio/* fall-through traffic gets a typed 503
// from the proxy until the child reports healthy.
//
// Pre-fix shape registered Worker("uvicorn-child") before
// ListenServer("http"); on Lambda this caused INIT_REPORT timeouts at
// 9999ms and an account-level concurrency exhaustion cascade as failed
// inits retried (~333→1000 ConcurrentExecutions during the prod incident
// observed at 18:13 UTC after PR langwatch-saas#473 deployed).
//
// `playground` may be nil in test contexts that don't exercise the
// /go/proxy/v1/* path; the handler falls back to a typed 501 in that
// case so misconfiguration is loud rather than silent.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config, playground httpapi.PlaygroundProxy) error {
	deps.Logger.Info("nlpgo_starting", zap.String("addr", cfg.Server.Addr))

	info := contexts.MustGetServiceInfo(ctx)
	handler := httpapi.NewRouter(httpapi.RouterDeps{
		App:                 application,
		Logger:              deps.Logger,
		Health:              deps.Health,
		Version:             info.Version,
		ChildProxy:          deps.ChildProxy,
		MaxRequestBodyBytes: cfg.Server.MaxRequestBodyBytes,
		PlaygroundProxy:     playground,
		OTel:                deps.OTel,
	})

	srv := &http.Server{
		Handler:           handler,
		Addr:              cfg.Server.Addr,
		ReadHeaderTimeout: 10 * time.Second,
	}

	g := lifecycle.New(
		lifecycle.WithGraceful(time.Duration(cfg.Server.GracefulSeconds)*time.Second),
		lifecycle.WithHealth(deps.Health),
	)
	g.Add(
		lifecycle.Closer("otel", deps.OTel.Shutdown),
		// HTTP listener binds $PORT first — Lambda init only needs the
		// port to be bound, not the upstream proxy to be live. This
		// keeps init under the 10s ceiling regardless of how long the
		// python child takes to import litellm + langwatch_nlp.
		lifecycle.ListenServer("http", srv),
		// Uvicorn-child starts in the background; the worker startFn
		// returns immediately so it doesn't block the lifecycle group.
		// Manager.Start internally polls /health and writes
		// uvicorn_child_ready on success; until then the proxy fall-
		// through returns a typed 503 so callers can retry instead of
		// hanging on a stalled connection.
		lifecycle.Worker("uvicorn-child", func(ctx context.Context) {
			go func() {
				if err := deps.Child.Start(ctx); err != nil {
					deps.Logger.Error("uvicorn_child_start_failed", zap.Error(err))
				}
			}()
		}, deps.Child.Stop),
	)
	return g.Run(ctx)
}
