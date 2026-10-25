package nlpgo

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/contexts"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/pkg/profiling"
	"github.com/langwatch/langwatch/pkg/ssrf"
	"github.com/langwatch/langwatch/services/aigateway/dispatcher"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/gateway"
	evalhttp "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels/http"
	evalrpc "github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/transport/rpc"
	lingua "github.com/langwatch/langwatch/services/third_party/lingua-go"
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
	endpoint := strings.TrimSpace(cfg.LangWatchEndpoint)
	if endpoint != "" {
		endpoint = strings.TrimRight(endpoint, "/") + "/api/otel/v1/traces"
	} else if cfg.OTel.OTLPEndpoint != "" || cfg.OTel.ExporterEndpoint != "" || cfg.OTel.ExporterTracesEndpoint != "" {
		clog.Get(ctx).Warn("nlpgo customer trace export is OFF: set LANGWATCH_ENDPOINT — the OTEL_* endpoints carry LangWatch's own operational spans and never route customer traces (the debug collector still applies for local development)")
	}
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
		SyncExport:             cfg.SpanSync,
		OpsEndpoint:            opsEndpoint,
		OpsHeaders:             opsHeaders,
		DebugCollectorEndpoint: debugEndpoint,
		DebugCollectorHeaders:  debugHeaders,
		// The same switch every service built through OTel.Configure honors.
		// nlpgo builds its Options by hand (its spans route per tenant), and
		// without this line it was the one Go lane still posting metrics to a
		// debug collector a developer had not started.
		MetricsDisabled: cfg.OTel.MetricsExportDisabled(),
	})
}

// Deps holds nlpgo's infrastructure adapters.
type Deps struct {
	Logger *zap.Logger
	NodeID string
	OTel   *otelsetup.Provider
	Health *health.Registry
	// Profiler is the continuous CPU/heap profiler. Its zero value is a
	// no-op, so an unconfigured deployment carries an inert struct rather
	// than a nil check at every use.
	Profiler profiling.Profiler
	// Evaluators serves /go/evaluators; nil leaves the route unmounted.
	Evaluators http.Handler
}

// NewDeps wires every adapter from the validated Config.
func NewDeps(ctx context.Context, cfg Config) (context.Context, *Deps, error) {
	if err := cfg.Log.Validate(); err != nil {
		return ctx, nil, err
	}
	logger := clog.New(ctx, cfg.Log)
	ctx = clog.Set(ctx, logger)
	nodeID := otelsetup.ResolveNodeID(logger)

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

	svcInfo := contexts.MustGetServiceInfo(ctx)
	probes := health.New(svcInfo.Environment)
	probes.MarkStarted()

	// Started after the collector-teed logger exists, so the one line saying
	// profiling is on lands wherever the rest of this service's logs do.
	profiler := profiling.StartFromEnv(svcInfo.Service, svcInfo.Environment, logger)

	return ctx, &Deps{
		Logger:   logger,
		NodeID:   nodeID,
		OTel:     otelProvider,
		Health:   probes,
		Profiler: profiler,
	}, nil
}

// EvaluatorsOptions is what NewEvaluatorsHandler builds the runtime from.
type EvaluatorsOptions struct {
	Config     Config
	Deps       *Deps
	Dispatcher *dispatcher.Dispatcher
	Egress     ssrf.Options
}

// NewEvaluatorsHandler builds the evaluator runtime and its transport. disp is
// the studio's dispatcher, so the egress policy is the same. The returned
// shutdown flushes the customer trace and the module's ops provider.
func NewEvaluatorsHandler(ctx context.Context, opts EvaluatorsOptions) (http.Handler, func(context.Context) error, error) {
	cfg, deps, disp := opts.Config, opts.Deps, opts.Dispatcher
	opsProvider, err := newEvaluatorsOpsTracerProvider(ctx, cfg, deps.NodeID)
	if err != nil {
		return nil, nil, fmt.Errorf("evaluators ops tracer: %w", err)
	}
	customerTrace, err := evalhttp.NewCustomerTrace(ctx, evalhttp.CustomerTraceOptions{
		Endpoint: strings.TrimSpace(cfg.LangWatchEndpoint),
		Logger:   deps.Logger,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("evaluators customer trace: %w", err)
	}
	if cfg.LinguaModelsPath != "" {
		if err := lingua.LoadModels(cfg.LinguaModelsPath); err != nil {
			return nil, nil, fmt.Errorf("evaluators: %w", err)
		}
	}
	var pricing *gateway.Pricing // nil prices nothing, said once at boot
	if cfg.ModelPricingDir == "" {
		deps.Logger.Warn("evaluator costs are unpriced: " + gateway.PricingDirEnv + " is not set")
	} else if pricing, err = gateway.LoadPricing(cfg.ModelPricingDir, deps.Logger.Named("evaluators")); err != nil {
		return nil, nil, fmt.Errorf("evaluators: %w", err)
	} else if pricing.Len() == 0 {
		deps.Logger.Warn("evaluator costs are unpriced: no model catalogue found", zap.String("dir", cfg.ModelPricingDir))
	}
	var piiAnalyzer channels.PIIAnalyzer // a nil *PIIAnalyzer must not become a non-nil interface
	if cfg.PIIAnalyzerURL != "" {
		piiAnalyzer = evalhttp.NewPIIAnalyzer(evalhttp.PIIAnalyzerOptions{BaseURL: cfg.PIIAnalyzerURL, Key: cfg.PIIAnalyzerKey})
	}
	module := evaluators.New(evaluators.Deps{
		Config:        cfg.Evaluators,
		LLM:           gateway.New(gateway.Options{Dispatcher: disp, Pricing: pricing, Logger: deps.Logger}),
		CustomerTrace: customerTrace,
		Vendor:        evalhttp.NewVendor(evalhttp.VendorOptions{Egress: opts.Egress}),
		PIIAnalyzer:   piiAnalyzer,
		OpsTracer:     opsProvider.Tracer("langwatch.nlpgo.evaluators"),
		Logger:        deps.Logger.Named("evaluators"),
	})
	handler := evalrpc.NewHandler(evalrpc.HandlerDeps{
		API:            module,
		InternalSecret: cfg.EvaluatorsInternalSecret,
		MaxBodyBytes:   cfg.Evaluators.MaxBodyBytes,
		Logger:         deps.Logger.Named("evaluators"),
	})
	shutdown := func(ctx context.Context) error {
		return errors.Join(customerTrace.Shutdown(ctx), opsProvider.Shutdown(ctx))
	}
	return handler, shutdown, nil
}

// newEvaluatorsOpsTracerProvider is the evaluators module's own provider on
// the internal collector: never the multi-tenant one, whose unkeyed spans
// fall back by routing rules the module must not depend on (plan §6.2).
func newEvaluatorsOpsTracerProvider(ctx context.Context, cfg Config, nodeID string) (*sdktrace.TracerProvider, error) {
	info := contexts.MustGetServiceInfo(ctx)
	options := []sdktrace.TracerProviderOption{sdktrace.WithResource(resource.NewSchemaless(
		attribute.String("service.name", info.Service),
		attribute.String("service.version", info.Version),
		attribute.String("deployment.environment.name", cfg.Environment),
		attribute.String("node.id", nodeID),
		attribute.String(otelsetup.AttrLangWatchOrigin, otelsetup.OriginPlatformInternal),
	))}
	endpoint, headers := cfg.OTel.PrimaryOTLP()
	if endpoint != "" {
		exporter, err := otlptracehttp.New(ctx,
			otlptracehttp.WithEndpointURL(strings.TrimRight(endpoint, "/")+"/v1/traces"),
			otlptracehttp.WithHeaders(headers),
		)
		if err != nil {
			return nil, err
		}
		options = append(options, sdktrace.WithBatcher(exporter))
	}
	return sdktrace.NewTracerProvider(options...), nil
}
