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
// `playground` may be nil in test contexts that don't exercise the
// /go/proxy/v1/* path; the handler falls back to a typed 501 in that
// case so misconfiguration is loud rather than silent.
func Serve(ctx context.Context, application *app.App, deps *Deps, cfg Config, playground httpapi.PlaygroundProxy) error {
	deps.Logger.Info("nlpgo_starting", zap.String("addr", cfg.Server.Addr))

	info := contexts.MustGetServiceInfo(ctx)
	handler := httpapi.NewRouter(newRouterDeps(routerDepsInput{
		App:        application,
		Deps:       deps,
		Cfg:        cfg,
		Version:    info.Version,
		Playground: playground,
	}))

	srv := &http.Server{
		Handler:           handler,
		Addr:              cfg.Server.Addr,
		ReadHeaderTimeout: 10 * time.Second,
		// net/http rejects requests whose header section exceeds this with a
		// pre-handler 431 that never reaches our logging. Requests arrive
		// through LWA, which folds upstream metadata into headers, so give
		// them ample room instead of the 1 MiB default.
		MaxHeaderBytes: 8 << 20,
	}

	g := lifecycle.New(
		lifecycle.WithGraceful(time.Duration(cfg.Server.GracefulSeconds)*time.Second),
		lifecycle.WithHealth(deps.Health),
	)
	g.Add(buildServices(deps, srv)...)
	return g.Run(ctx)
}

// routerDepsInput carries everything newRouterDeps needs to map the
// service config onto the HTTP adapter. A struct rather than a positional
// list so a new knob is named at the call site instead of joining a row of
// interchangeable arguments.
type routerDepsInput struct {
	App        *app.App
	Deps       *Deps
	Cfg        Config
	Version    string
	Playground httpapi.PlaygroundProxy
}

// newRouterDeps maps the service config onto the HTTP adapter's
// dependencies. Extracted from Serve so a test can assert which
// operator knob reaches which transport option without binding a
// listener or standing up the engine.
func newRouterDeps(in routerDepsInput) httpapi.RouterDeps {
	return httpapi.RouterDeps{
		App:                 in.App,
		Logger:              in.Deps.Logger,
		Health:              in.Deps.Health,
		Version:             in.Version,
		MaxRequestBodyBytes: in.Cfg.Server.MaxRequestBodyBytes,
		PlaygroundProxy:     in.Playground,
		OTel:                in.Deps.OTel,
		StreamHeartbeat:     resolveStreamHeartbeat(in.Cfg.Engine.StreamHeartbeatSeconds),
		StreamIdleTimeout:   resolveStreamIdleTimeout(in.Cfg.Engine.StreamIdleTimeoutSeconds),
	}
}

// resolveStreamHeartbeat converts the operator's
// NLPGO_ENGINE_STREAM_HEARTBEAT_SECONDS into the is_alive_response
// cadence the SSE handler applies.
//
// Zero or negative returns zero, which defers to the handler's own
// DefaultStreamHeartbeat — one default, in one place. Passing a
// non-positive duration on instead would reach engine.ExecuteStream,
// which starts no heartbeat goroutine at all below zero, so a typo in a
// config file would silently stop every is_alive_response frame and let
// intermediate proxies tear down healthy long-running streams.
func resolveStreamHeartbeat(seconds int) time.Duration {
	if seconds <= 0 {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

// resolveStreamIdleTimeout converts the operator's
// NLPGO_ENGINE_STREAM_IDLE_TIMEOUT_SECONDS into the silence budget the SSE
// handler enforces.
//
// Zero or negative returns zero, which defers to the handler's own
// DefaultStreamIdleTimeout — one default, in one place. Passing a
// non-positive duration on instead would arm a timer that fires before the
// first engine event, so a typo in a config file would tear down every
// stream at once rather than only the stalled ones.
func resolveStreamIdleTimeout(seconds int) time.Duration {
	if seconds <= 0 {
		return 0
	}
	return time.Duration(seconds) * time.Second
}

// buildServices returns the lifecycle services Serve registers.
// Extracted from Serve so tests can assert the set directly. The HTTP
// listener binds $PORT; on Lambda that is all the init phase needs, so
// init completes in milliseconds.
func buildServices(deps *Deps, srv *http.Server) []lifecycle.Service {
	return []lifecycle.Service{
		lifecycle.Closer("otel", deps.OTel.Shutdown),
		lifecycle.Closer("profiling", deps.Profiler.Shutdown),
		lifecycle.ListenServer("http", srv),
	}
}
