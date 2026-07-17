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
	"github.com/langwatch/langwatch/services/langyagent/adapters/otelrelay"
	"github.com/langwatch/langwatch/services/langyagent/internal/telemetry"
)

// Deps holds the manager's infrastructure adapters. Mirrors nlpgo/aigateway.
type Deps struct {
	Logger    *zap.Logger
	NodeID    string
	OTel      *otelsetup.Provider
	Health    *health.Registry
	Telemetry *telemetry.Telemetry
	// OTelRelay is the loopback worker telemetry + LLM mediation relay: workers
	// export OTLP to it keyless, and route LLM calls through it so the virtual
	// key stays out of the worker env. One per manager; the pool registers each
	// worker at spawn.
	OTelRelay *otelrelay.Relay
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

	// The loopback relay for host-mediated worker telemetry + LLM traffic. Binds
	// an ephemeral 127.0.0.1 port immediately; workers get token-scoped URLs on
	// it at spawn. Failing to bind loopback is a broken host — fail fast.
	relay, err := otelrelay.New(ctx)
	if err != nil {
		return ctx, nil, fmt.Errorf("otelrelay init: %w", err)
	}

	return ctx, &Deps{
		Logger:    logger,
		NodeID:    nodeID,
		OTel:      otelProvider,
		Health:    probes,
		Telemetry: telemetry.New(),
		OTelRelay: relay,
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
