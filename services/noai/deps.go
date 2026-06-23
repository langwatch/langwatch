package noai

import (
	"context"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/health"
)

// Deps is the wired set of infrastructure adapters the service needs.
type Deps struct {
	Logger *zap.Logger
	Health *health.Registry
}

// NewDeps constructs the dependency set from Config. It only allocates;
// the lifecycle group in Serve takes care of starting/stopping anything
// that needs it (currently nothing — this service is pure HTTP).
func NewDeps(ctx context.Context, cfg Config) (context.Context, *Deps, error) {
	logger := clog.New(ctx, cfg.Log)
	ctx = clog.Set(ctx, logger)
	info := contexts.MustGetServiceInfo(ctx)
	registry := health.New(info.Version)
	registry.MarkStarted()
	return ctx, &Deps{Logger: logger, Health: registry}, nil
}
