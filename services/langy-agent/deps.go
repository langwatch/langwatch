package langyagent

import (
	"context"
	"fmt"
	"os"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/langy-agent/telemetry"
)

// Deps holds the manager's infrastructure adapters. Mirrors nlpgo/aigateway.
type Deps struct {
	Logger    *zap.Logger
	NodeID    string
	OTel      *otelsetup.Provider
	Health    *health.Registry
	Telemetry *telemetry.Telemetry
}

// NewDeps wires every adapter from the validated Config. It installs the
// context-carried logger and the OTel provider (the manager's OWN operational
// telemetry — distinct from the per-worker opencode plugin telemetry, which
// exports into each customer's project). The provider is a no-op until
// OTEL_OTLP_ENDPOINT is configured; the spans + metric call sites exist
// regardless (ADR-047 telemetry seam).
func NewDeps(ctx context.Context, cfg Config) (context.Context, *Deps, error) {
	logger := clog.New(ctx, cfg.Log)
	ctx = clog.Set(ctx, logger)
	nodeID := resolveNodeID(ctx, logger)

	otelProvider, err := cfg.OTel.Configure(ctx, nodeID)
	if err != nil {
		return ctx, nil, fmt.Errorf("otel init: %w", err)
	}

	probes := health.New(contexts.MustGetServiceInfo(ctx).Environment)
	probes.MarkStarted()

	return ctx, &Deps{
		Logger:    logger,
		NodeID:    nodeID,
		OTel:      otelProvider,
		Health:    probes,
		Telemetry: telemetry.New(),
	}, nil
}

func resolveNodeID(ctx context.Context, logger *zap.Logger) string {
	_ = ctx
	hostname, err := os.Hostname()
	if err != nil {
		id := ulid.Make().String()
		logger.Warn("hostname_unavailable", zap.Error(err), zap.String("fallback_node_id", id))
		return id
	}
	return hostname
}
