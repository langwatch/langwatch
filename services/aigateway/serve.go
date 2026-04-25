package aigateway

import (
	"context"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/aigateway/adapters/httpapi"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// Serve wires the app into HTTP transport and lifecycle management, blocking
// until shutdown signal.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config) error {
	deps.Logger.Info("aigateway_starting", zap.String("addr", cfg.Server.Addr))

	info := contexts.MustGetServiceInfo(ctx)
	handler := httpapi.NewRouter(httpapi.RouterDeps{
		App:                   application,
		Logger:                deps.Logger,
		Health:                deps.Health,
		Version:               info.Version,
		TraceRegistry:         deps.TraceRegistry,
		DefaultExportEndpoint: cfg.CustomerTraceBridge.BaseURL + "/api/otel",
		MaxRequestBodyBytes:   cfg.Server.MaxRequestBodyBytes,
		InternalSecret:        cfg.ControlPlane.InternalSecret,
	})

	srv := &http.Server{Handler: handler, Addr: cfg.Server.Addr, ReadHeaderTimeout: 10 * time.Second}

	g := lifecycle.New(
		lifecycle.WithGraceful(time.Duration(cfg.Server.GracefulSeconds)*time.Second),
		lifecycle.WithHealth(deps.Health),
	)
	g.Add(
		lifecycle.Closer("otel", deps.OTel.Shutdown),
		lifecycle.Closer("customer-trace-bridge", deps.TraceBridge.Shutdown),
		lifecycle.Worker("auth", deps.Auth.Start, deps.Auth.Stop),
		lifecycle.ListenServer("http", srv),
	)
	return g.Run(ctx)
}
