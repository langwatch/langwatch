package noai

import (
	"context"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/noai/adapters/httpapi"
)

// Serve wires the HTTP transport into the lifecycle group and blocks until
// shutdown.
func Serve(ctx context.Context, deps *Deps, cfg Config) error {
	deps.Logger.Info("noai_starting", zap.String("addr", cfg.Server.Addr))

	handler := httpapi.NewRouter(httpapi.RouterDeps{
		Logger:              deps.Logger,
		Health:              deps.Health,
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
	g.Add(lifecycle.ListenServer("http", srv))
	return g.Run(ctx)
}
