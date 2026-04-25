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
// blocking until shutdown. The uvicorn child is started first so the
// reverse proxy is healthy when the HTTP listener starts accepting.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config) error {
	deps.Logger.Info("nlpgo_starting", zap.String("addr", cfg.Server.Addr))

	info := contexts.MustGetServiceInfo(ctx)
	handler := httpapi.NewRouter(httpapi.RouterDeps{
		App:                 application,
		Logger:              deps.Logger,
		Health:              deps.Health,
		Version:             info.Version,
		ChildProxy:          deps.ChildProxy,
		MaxRequestBodyBytes: cfg.Server.MaxRequestBodyBytes,
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
		lifecycle.Worker("uvicorn-child", func(ctx context.Context) {
			if err := deps.Child.Start(ctx); err != nil {
				deps.Logger.Error("uvicorn_child_start_failed", zap.Error(err))
			}
		}, deps.Child.Stop),
		lifecycle.ListenServer("http", srv),
	)
	return g.Run(ctx)
}
