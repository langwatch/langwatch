package nlpgo

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/proxypass"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/uvicornchild"
)

// Deps holds nlpgo's infrastructure adapters.
type Deps struct {
	Logger     *zap.Logger
	NodeID     string
	OTel       *otelsetup.Provider
	Health     *health.Registry
	Child      *uvicornchild.Manager
	ChildProxy http.Handler
}

// NewDeps wires every adapter from the validated Config.
func NewDeps(ctx context.Context, cfg Config) (context.Context, *Deps, error) {
	if err := cfg.Log.Validate(); err != nil {
		return ctx, nil, err
	}
	logger := clog.New(ctx, cfg.Log)
	ctx = clog.Set(ctx, logger)
	nodeID := resolveNodeID(ctx, logger)

	otelProvider, err := cfg.OTel.Configure(ctx, nodeID)
	if err != nil {
		return ctx, nil, fmt.Errorf("otel init: %w", err)
	}

	probes := health.New(contexts.MustGetServiceInfo(ctx).Environment)

	child := uvicornchild.New(uvicornchild.Options{
		Command:   cfg.Child.Command,
		Args:      cfg.Child.Args,
		HealthURL: cfg.Child.HealthURL,
		Disabled:  cfg.Child.Bypass,
		Logger:    logger,
	})

	probes.RegisterReadiness("uvicorn_child", func() (bool, string) {
		hctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := child.Healthy(hctx); err != nil {
			return false, err.Error()
		}
		return true, ""
	})
	probes.MarkStarted()

	var proxy http.Handler
	if cfg.Child.UpstreamURL != "" {
		p, err := proxypass.New(proxypass.Options{
			UpstreamURL: cfg.Child.UpstreamURL,
			Logger:      logger,
		})
		if err != nil {
			return ctx, nil, fmt.Errorf("proxypass init: %w", err)
		}
		proxy = p
	}

	return ctx, &Deps{
		Logger:     logger,
		NodeID:     nodeID,
		OTel:       otelProvider,
		Health:     probes,
		Child:      child,
		ChildProxy: proxy,
	}, nil
}

func resolveNodeID(ctx context.Context, logger *zap.Logger) string {
	hostname, err := os.Hostname()
	if err != nil {
		id := ulid.Make().String()
		logger.Warn("hostname_unavailable", zap.Error(err), zap.String("fallback_node_id", id))
		_ = ctx
		return id
	}
	return hostname
}
