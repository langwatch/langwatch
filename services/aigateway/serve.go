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
	"github.com/langwatch/langwatch/services/aigateway/adapters/statusprobe"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// Serve wires the app into HTTP transport and lifecycle management, blocking
// until shutdown signal.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config) error {
	deps.Logger.Info("aigateway_starting", zap.String("addr", cfg.Server.Addr))
	warnIfGracefulShutdownTooShort(deps.Logger, cfg)
	if !cfg.ControlPlane.BaseURLExplicit {
		deps.Logger.Warn("aigateway_control_plane_base_url_not_explicit",
			zap.String("control_plane_base_url", cfg.ControlPlane.BaseURL),
			zap.String("fix", "set LW_GATEWAY_BASE_URL explicitly, see platform/app/.env.example"),
		)
	}

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
		ControlPlaneBaseURL:   cfg.ControlPlane.BaseURL,
	})

	srv := &http.Server{Handler: handler, Addr: cfg.Server.Addr, ReadHeaderTimeout: 10 * time.Second}

	g := lifecycle.New(
		lifecycle.WithGraceful(time.Duration(cfg.Server.GracefulSeconds)*time.Second),
		lifecycle.WithDrainDelay(time.Duration(cfg.Server.DrainDelaySeconds)*time.Second),
		lifecycle.WithHealth(deps.Health),
	)
	g.Add(
		lifecycle.Closer("otel", deps.OTel.Shutdown),
		lifecycle.Closer("profiling", deps.Profiler.Shutdown),
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
// fire on every deployment everywhere, permanent noise with nothing
// actionable behind it. HeartbeatInterval is the deliberately chosen
// boundary between "fast, typical" and "slow but legitimate," which is why
// it is the comparison that is actually meaningful.
//
// The stock defaults clear the check by design (60s graceful against a 45s
// heartbeat interval, and the gateway chart matches), so the warning marks
// a deployment that has narrowed SERVER_GRACEFUL_SECONDS rather than one
// that simply took what it was given.
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
