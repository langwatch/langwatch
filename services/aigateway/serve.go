package aigateway

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/aigateway/adapters/httpapi"
	"github.com/langwatch/langwatch/services/aigateway/adapters/ottlserver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/statusprobe"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// Serve wires the app into HTTP transport and lifecycle management, blocking
// until shutdown signal.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config) error {
	deps.Logger.Info("aigateway_starting", zap.String("addr", cfg.Server.Addr))

	ottlSrv, err := ottlserver.New(deps.Logger)
	if err != nil {
		return fmt.Errorf("ottlserver init: %w", err)
	}

	// Backs the public GET /health status-page endpoint: probes the
	// control plane on its own clock so a poll never fans out.
	statusMon := statusprobe.New(statusprobe.Options{
		Pinger: deps.ControlPlane,
		Logger: deps.Logger,
	})

	info := contexts.MustGetServiceInfo(ctx)
	handler := httpapi.NewRouter(httpapi.RouterDeps{
		App:                   application,
		Logger:                deps.Logger,
		Health:                deps.Health,
		Metrics:               deps.Metrics,
		Version:               info.Version,
		TraceRegistry:         deps.TraceRegistry,
		DefaultExportEndpoint: cfg.CustomerTraceBridge.BaseURL + "/api/otel",
		OTTLServer:            ottlSrv,
		InternalSecret:        cfg.ControlPlane.InternalSecret,
		MaxRequestBodyBytes:   cfg.Server.MaxRequestBodyBytes,
		HeartbeatInterval:     time.Duration(cfg.NonStreamingHeartbeatIntervalSeconds) * time.Second,
		Status:                statusMon,
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
		lifecycle.Worker("statusprobe", statusMon.Start, statusMon.Stop),
		lifecycle.ListenServer("http", srv),
	)
	if deps.SpendDrainer != nil {
		g.Add(lifecycle.Worker("spend-drainer", deps.SpendDrainer.Start, deps.SpendDrainer.Stop))
	}
	if deps.SpendSpool != nil {
		g.Add(lifecycle.Closer("spend-spool", func(context.Context) error { return deps.SpendSpool.Close() }))
	}
	return g.Run(ctx)
}
