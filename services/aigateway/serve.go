package aigateway

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/config"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/lifecycle"
	"github.com/langwatch/langwatch/services/aigateway/adapters/httpapi"
	"github.com/langwatch/langwatch/services/aigateway/adapters/ottlserver"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// Serve wires the app into HTTP transport and lifecycle management, blocking
// until shutdown signal.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config) error {
	deps.Logger.Info("aigateway_starting", zap.String("addr", cfg.Server.Addr))
	warnIfGracefulShutdownTooShort(deps.Logger, cfg)

	ottlSrv, err := ottlserver.New(deps.Logger)
	if err != nil {
		return fmt.Errorf("ottlserver init: %w", err)
	}

	info := contexts.MustGetServiceInfo(ctx)
	handler := httpapi.NewRouter(httpapi.RouterDeps{
		App:                   application,
		Logger:                deps.Logger,
		Health:                deps.Health,
		Version:               info.Version,
		TraceRegistry:         deps.TraceRegistry,
		DefaultExportEndpoint: cfg.CustomerTraceBridge.BaseURL + "/api/otel",
		OTTLServer:            ottlSrv,
		InternalSecret:        cfg.ControlPlane.InternalSecret,
		MaxRequestBodyBytes:   cfg.Server.MaxRequestBodyBytes,
		HeartbeatInterval:     time.Duration(cfg.NonStreamingHeartbeatIntervalSeconds) * time.Second,
	})

	srv := &http.Server{Handler: handler, Addr: cfg.Server.Addr, ReadHeaderTimeout: 10 * time.Second}

	g := lifecycle.New(
		lifecycle.WithGraceful(time.Duration(cfg.Server.GracefulSeconds)*time.Second),
		lifecycle.WithDrainDelay(time.Duration(cfg.Server.DrainDelaySeconds)*time.Second),
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

// warnIfGracefulShutdownTooShort surfaces a real, if narrow, operational
// trap: HeartbeatInterval decides when a non-streaming response is
// legitimately expected to still be running, but GracefulSeconds decides
// how long a rolling deploy waits for a still-running request to finish.
// If the second is smaller than the first, every non-streaming request the
// heartbeat mechanism exists to keep alive can, by construction, never
// survive a deploy — it gets killed before its own keep-alive interval
// even elapses once.
//
// This deliberately does NOT compare against the gateway's absolute
// upstream ceiling (providers.ProviderRequestTimeoutSeconds, 14 minutes):
// no sane GracefulSeconds ever approaches that, so that comparison would
// fire on every deployment everywhere — permanent noise with nothing
// actionable behind it. HeartbeatInterval is the deliberately chosen
// boundary between "fast, typical" and "slow but legitimate," which is why
// it's the comparison that's actually meaningful — and not universally
// true today: the stock defaults (10s graceful, 45s heartbeat) already
// fail it.
func warnIfGracefulShutdownTooShort(logger *zap.Logger, cfg Config) {
	graceful := time.Duration(cfg.Server.GracefulSeconds) * time.Second
	if graceful <= 0 {
		return
	}

	heartbeat := time.Duration(cfg.NonStreamingHeartbeatIntervalSeconds) * time.Second
	if heartbeat == 0 {
		heartbeat = config.DefaultNonStreamingHeartbeatInterval
	}
	if heartbeat < 0 {
		return // heartbeating disabled entirely — nothing to warn about
	}

	if graceful < heartbeat {
		logger.Warn("graceful_shutdown_shorter_than_heartbeat_interval",
			zap.Duration("graceful_shutdown_window", graceful),
			zap.Duration("heartbeat_interval", heartbeat),
			zap.String("hint", "any non-streaming request slower than the heartbeat interval is one this gateway expects to legitimately keep running, but it cannot survive a rolling deploy if GracefulSeconds is shorter than the heartbeat interval meant to keep it alive. Raise SERVER_GRACEFUL_SECONDS above the heartbeat interval, or accept that slow in-flight requests may be interrupted during deploys."),
		)
	}
}
