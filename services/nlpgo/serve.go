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
	handler := httpapi.NewRouter(httpapi.RouterDeps{
		App:                 application,
		Logger:              deps.Logger,
		Health:              deps.Health,
		Version:             info.Version,
		MaxRequestBodyBytes: cfg.Server.MaxRequestBodyBytes,
		PlaygroundProxy:     playground,
		OTel:                deps.OTel,
	})

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

// buildServices returns the lifecycle services Serve registers.
// Extracted from Serve so tests can assert the set directly. The HTTP
// listener binds $PORT; on Lambda that is all the init phase needs, so
// init completes in milliseconds.
func buildServices(deps *Deps, srv *http.Server) []lifecycle.Service {
	return []lifecycle.Service{
		lifecycle.Closer("otel", deps.OTel.Shutdown),
		lifecycle.ListenServer("http", srv),
	}
}
