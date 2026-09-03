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
	"github.com/langwatch/langwatch/services/aigateway/adapters/providers"
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
			zap.String("fix", "set LW_GATEWAY_BASE_URL explicitly, see .env.example"),
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
		WebhookRelay:          deps.ControlPlane,
	})

	srv := &http.Server{Handler: handler, Addr: cfg.Server.Addr, ReadHeaderTimeout: 10 * time.Second}

	g := lifecycle.New(
		lifecycle.WithGraceful(time.Duration(cfg.Server.GracefulSeconds)*time.Second),
		lifecycle.WithDrainDelay(time.Duration(cfg.Server.DrainDelaySeconds)*time.Second),
		lifecycle.WithHealth(deps.Health),
	)
	addManagedServices(g, deps, ownServices{Status: statusMon, HTTP: srv})
	return g.Run(ctx)
}

// ownServices are the services Serve constructs for itself, as distinct from
// the collaborators injected through Deps. Both sets are registered together,
// in one order, because that order is what shutdown correctness depends on.
type ownServices struct {
	Status *statusprobe.Monitor
	HTTP   *http.Server
}

// addManagedServices registers every managed service in start order.
//
// Stop runs in reverse, so the listener is registered last and is therefore
// the first thing stopped. That ordering is load bearing. The spend spool
// has to still be open while in-flight requests finish, because Spool.Append
// counts and discards every record handed to it after Close, so draining the
// listener last would throw away the spend of every request that completed
// during the drain. Telemetry is registered first, so it is torn down last
// and the shutdown itself is still traced — the profiler included, so a
// shutdown slow enough to be worth profiling is still being sampled while it
// happens.
func addManagedServices(g *lifecycle.Group, deps *Deps, own ownServices) {
	g.Add(
		lifecycle.Closer("otel", deps.OTel.Shutdown),
		lifecycle.Closer("profiling", deps.Profiler.Shutdown),
		lifecycle.Closer("customer-trace-bridge", deps.TraceBridge.Shutdown),
	)
	if deps.SpendSpool != nil {
		g.Add(lifecycle.Closer("spend-spool", func(context.Context) error { return deps.SpendSpool.Close() }))
	}
	if deps.SpendDrainer != nil {
		g.Add(lifecycle.Worker("spend-drainer", deps.SpendDrainer.Start, deps.SpendDrainer.Stop))
	}
	g.Add(
		lifecycle.Worker("auth", deps.Auth.Start, deps.Auth.Stop),
		lifecycle.Worker("statusprobe", own.Status.Start, own.Status.Stop),
		lifecycle.ListenServer("http", own.HTTP),
	)
}

// warnIfGracefulShutdownTooShort surfaces the two ways a graceful window can
// be too small for the traffic this gateway actually carries. Both compare
// against a request this gateway itself considers legitimate, so either one
// firing means real requests are being cut on every rolling deploy.
//
// The first bound is the non-streaming heartbeat interval. HeartbeatInterval
// decides when a non-streaming response is legitimately expected to still be
// running, so a graceful window below it kills every request the heartbeat
// mechanism exists to keep alive before its own keep-alive interval elapses
// even once.
//
// The second bound is the upstream ceiling, and it is the one that bites.
// Nothing gateway-side bounds how long a streaming response runs: the HTTP
// server above sets ReadHeaderTimeout only, no WriteTimeout and no
// IdleTimeout. The single real limit is upstream, at
// providers.ProviderRequestTimeoutSeconds, so a stream can legitimately run
// for 14 minutes. A graceful window under that severs long streams on every
// rolling deploy, node drain and scale-down, and the client sees the
// connection drop mid-stream with no resumption and no retry.
//
// The stock defaults clear both checks by design, so a warning here marks a
// deployment that narrowed SERVER_GRACEFUL_SECONDS rather than one that took
// what it was given.
func warnIfGracefulShutdownTooShort(logger *zap.Logger, cfg Config) {
	graceful := time.Duration(cfg.Server.GracefulSeconds) * time.Second
	if graceful <= 0 {
		return
	}

	heartbeat := time.Duration(cfg.NonStreamingHeartbeatIntervalSeconds) * time.Second
	if heartbeat == 0 {
		heartbeat = config.DefaultNonStreamingHeartbeatInterval
	}
	// A negative interval disables heartbeating entirely, which leaves
	// nothing to compare against on this bound alone.
	if heartbeat > 0 && graceful < heartbeat {
		logger.Warn("graceful_shutdown_shorter_than_heartbeat_interval",
			zap.Duration("graceful_shutdown_window", graceful),
			zap.Duration("heartbeat_interval", heartbeat),
			zap.String("hint", "any non-streaming request slower than the heartbeat interval is one this gateway expects to legitimately keep running, but it cannot survive a rolling deploy if GracefulSeconds is shorter than the heartbeat interval meant to keep it alive. Raise SERVER_GRACEFUL_SECONDS above the heartbeat interval, or accept that slow in-flight requests may be interrupted during deploys."),
		)
	}

	maxStream := providers.ProviderRequestTimeoutSeconds * time.Second
	if graceful < maxStream {
		logger.Warn("graceful_shutdown_shorter_than_max_stream_duration",
			zap.Duration("graceful_shutdown_window", graceful),
			zap.Duration("max_stream_duration", maxStream),
			zap.String("hint", "a streaming response is bounded only by the upstream provider timeout, so it can legitimately run for the full max_stream_duration. With a shorter graceful window, any stream still running when the window expires is severed on every rolling deploy, node drain and scale-down. Raise SERVER_GRACEFUL_SECONDS to at least the max stream duration, and size the pod's terminationGracePeriodSeconds above SERVER_GRACEFUL_SECONDS plus SERVER_DRAIN_DELAY_SECONDS, or accept that long streams are cut during deploys."),
		)
	}
}
