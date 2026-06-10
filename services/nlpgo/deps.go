package nlpgo

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/oklog/ulid/v2"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/otelsetup"
)

// configureNLPGoOTel installs nlpgo's OTel provider in multi-tenant
// mode: every span is routed to a per-tenant exporter keyed by the
// inbound `workflow.api_key`, so spans from project A and project B
// can't end up in one another's traces even when the same Lambda
// container handles both.
//
// Endpoint resolution mirrors the legacy Python service: read
// `LANGWATCH_ENDPOINT` (the universal LangWatch URL env var), append
// the OTLP traces path. Falls back to the generic `OTEL_OTLP_ENDPOINT`
// only when LANGWATCH_ENDPOINT is unset, for environments that wire
// OTel via the standard OTel env vars.
func configureNLPGoOTel(ctx context.Context, cfg Config, nodeID string) (*otelsetup.Provider, error) {
	endpoint := strings.TrimSpace(os.Getenv("LANGWATCH_ENDPOINT"))
	if endpoint != "" {
		endpoint = strings.TrimRight(endpoint, "/") + "/api/otel/v1/traces"
	} else {
		endpoint = cfg.OTel.OTLPEndpoint
		if endpoint != "" && !strings.HasSuffix(endpoint, "/v1/traces") {
			endpoint = strings.TrimRight(endpoint, "/") + "/v1/traces"
		}
	}
	// NLPGO_SPAN_SYNC=1 swaps the per-tenant BatchSpanProcessor for a
	// SimpleSpanProcessor — every span.End() blocks on the OTLP
	// roundtrip. The integration test
	// langwatch/src/server/nlpgo/__tests__/traceparent-roundtrip.integration.test.ts
	// flips this on so it can assert on persisted spans without
	// chasing async BSP-flush windows under saturated-CI scheduler
	// contention. Production deployments must leave this off — async
	// batching is what keeps the request hot path independent of
	// collector RTT.
	syncExport := strings.TrimSpace(os.Getenv("NLPGO_SPAN_SYNC")) == "1"
	return otelsetup.New(ctx, otelsetup.Options{
		NodeID:       nodeID,
		OTLPEndpoint: endpoint,
		SampleRatio:  cfg.OTel.SampleRatio,
		MultiTenant:  true,
		SyncExport:   syncExport,
	})
}

// Deps holds nlpgo's infrastructure adapters.
type Deps struct {
	Logger *zap.Logger
	NodeID string
	OTel   *otelsetup.Provider
	Health *health.Registry
}

// NewDeps wires every adapter from the validated Config.
func NewDeps(ctx context.Context, cfg Config) (context.Context, *Deps, error) {
	if err := cfg.Log.Validate(); err != nil {
		return ctx, nil, err
	}
	logger := clog.New(ctx, cfg.Log)
	ctx = clog.Set(ctx, logger)
	nodeID := resolveNodeID(ctx, logger)

	otelProvider, err := configureNLPGoOTel(ctx, cfg, nodeID)
	if err != nil {
		return ctx, nil, fmt.Errorf("otel init: %w", err)
	}

	probes := health.New(contexts.MustGetServiceInfo(ctx).Environment)
	probes.MarkStarted()

	return ctx, &Deps{
		Logger: logger,
		NodeID: nodeID,
		OTel:   otelProvider,
		Health: probes,
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
