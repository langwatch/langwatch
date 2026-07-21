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
// The router's destination is CUSTOMER trace routing, which is product
// configuration — `LANGWATCH_ENDPOINT` (the universal LangWatch URL env
// var) + the OTLP ingest path — and deliberately NOT the official
// OTEL_EXPORTER_OTLP_* namespace: in a dev shell that namespace points
// every service's OWN telemetry at the local observability stack, and
// reading it here would silently divert customer studio traces into it.
// The deprecated `OTEL_OTLP_ENDPOINT` fallback is kept for environments
// that predate LANGWATCH_ENDPOINT wiring.
func configureNLPGoOTel(ctx context.Context, cfg Config, nodeID string) (*otelsetup.Provider, error) {
	// LANGWATCH_ENDPOINT is the ONLY source for the customer router. The
	// pre-unification fallback to OTEL_OTLP_ENDPOINT was removed when that
	// name became the deprecated alias for the INTERNAL collector: one var
	// carrying both meanings is exactly how a config mistake inverts a
	// tenant boundary silently — an operator pointing "nlpgo's own
	// telemetry" at the internal stack would have routed customer studio
	// content there instead. Losing telemetry is recoverable; misrouting it
	// is not, so an unset LANGWATCH_ENDPOINT fails toward exporting nothing,
	// loudly.
	endpoint := strings.TrimSpace(os.Getenv("LANGWATCH_ENDPOINT"))
	if endpoint != "" {
		endpoint = strings.TrimRight(endpoint, "/") + "/api/otel/v1/traces"
	} else if cfg.OTel.OTLPEndpoint != "" || cfg.OTel.ExporterEndpoint != "" || cfg.OTel.ExporterTracesEndpoint != "" {
		clog.Get(ctx).Warn("nlpgo customer trace export is OFF: set LANGWATCH_ENDPOINT — the OTEL_* endpoints carry LangWatch's own operational spans and never route customer traces (the debug collector still applies for local development)")
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
	debugEndpoint, debugHeaders := cfg.OTel.DebugCollector()
	// The service's OWN spans (startup, health, background work — anything
	// that never acquires a tenant api_key) go to the internal collector the
	// official OTEL_* vars name. Customer traces keep routing per-tenant via
	// LANGWATCH_ENDPOINT above; the two pipelines never mix.
	opsEndpoint, opsHeaders := cfg.OTel.PrimaryOTLP()
	return otelsetup.New(ctx, otelsetup.Options{
		NodeID:                 nodeID,
		OTLPEndpoint:           endpoint,
		Sampler:                cfg.OTel.SamplerChoice(),
		MultiTenant:            true,
		SyncExport:             syncExport,
		OpsEndpoint:            opsEndpoint,
		OpsHeaders:             opsHeaders,
		DebugCollectorEndpoint: debugEndpoint,
		DebugCollectorHeaders:  debugHeaders,
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
	// When the debug collector is enabled, tee stdout logs into it too.
	// No-op (returns the same logger) otherwise.
	if lp := otelProvider.LoggerProvider(); lp != nil {
		logger = clog.WithCollector(ctx, cfg.Log, logger, lp)
		ctx = clog.Set(ctx, logger)
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
