package infra

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"sync"
	"time"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// AITracer handles CUSTOMER AI trace export — gen_ai.* attributes routed
// per-project to each customer's OTLP endpoint. Inherits the client's
// traceparent so spans nest in the customer's existing trace.
type AITracer struct {
	tp         *sdktrace.TracerProvider
	tracer     trace.Tracer
	propagator propagation.TextMapPropagator
	registry   *ProjectRegistry
}

// AITracerOptions configures the customer AI tracer.
type AITracerOptions struct {
	Registry     *ProjectRegistry
	BatchTimeout time.Duration
	MaxQueueSize int
}

// NewAITracer creates the customer AI trace exporter.
func NewAITracer(ctx context.Context, opts AITracerOptions) (*AITracer, error) {
	if opts.Registry == nil {
		opts.Registry = NewProjectRegistry()
	}

	router := &routerExporter{
		registry:  opts.Registry,
		byProject: make(map[string]*otlptrace.Exporter),
	}

	batchTimeout := opts.BatchTimeout
	if batchTimeout == 0 {
		batchTimeout = 5 * time.Second
	}
	queueSize := opts.MaxQueueSize
	if queueSize == 0 {
		queueSize = 8192
	}

	res, _ := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(semconv.SchemaURL,
			semconv.ServiceName("langwatch-ai-gateway"),
		),
	)

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithResource(res),
		sdktrace.WithBatcher(router,
			sdktrace.WithBatchTimeout(batchTimeout),
			sdktrace.WithMaxQueueSize(queueSize),
		),
	)

	prop := propagation.NewCompositeTextMapPropagator(
		propagation.TraceContext{},
	)

	return &AITracer{
		tp:         tp,
		tracer:     tp.Tracer("langwatch-ai-gateway"),
		propagator: prop,
		registry:   opts.Registry,
	}, nil
}

// EmitCompletion creates a span representing a customer's AI completion,
// inheriting the client's traceparent from the request context.
func (t *AITracer) EmitCompletion(ctx context.Context, params AICompletionParams) {
	// Extract client's traceparent so this span nests in their trace
	parentCtx := t.propagator.Extract(ctx, propagation.HeaderCarrier(params.RequestHeaders))

	_, span := t.tracer.Start(parentCtx, "gen_ai."+string(params.RequestType),
		trace.WithSpanKind(trace.SpanKindClient),
		trace.WithAttributes(
			attribute.String(AttrProjectID, params.ProjectID),
			attribute.String(AttrGenAIOperationName, string(params.RequestType)),
			attribute.String(AttrGenAISystem, string(params.ProviderID)),
			attribute.String(AttrGenAIRequestModel, params.Model),
			attribute.Int(AttrGenAIUsageIn, params.Usage.PromptTokens),
			attribute.Int(AttrGenAIUsageOut, params.Usage.CompletionTokens),
			attribute.Int(AttrGenAIUsageTotal, params.Usage.TotalTokens),
			attribute.Float64(AttrCostUSD, params.Usage.CostUSD),
			attribute.Int64(AttrDurationMS, params.DurationMS),
			attribute.Bool(AttrStreaming, params.Streaming),
		),
	)
	span.End()
}

// Shutdown flushes pending customer spans.
func (t *AITracer) Shutdown(ctx context.Context) error {
	if t.tp != nil {
		return t.tp.Shutdown(ctx)
	}
	return nil
}

// AICompletionParams holds data for a customer AI trace span.
type AICompletionParams struct {
	ProjectID      string
	Model          string
	ProviderID     domain.ProviderID
	Usage          domain.Usage
	DurationMS     int64
	Streaming      bool
	RequestType    domain.RequestType
	RequestHeaders map[string][]string // original HTTP headers for traceparent extraction
}

// --- Project Registry ---

// ProjectRegistry maps project_id → OTLP endpoint + auth headers.
type ProjectRegistry struct {
	mu sync.RWMutex
	m  map[string]projectEntry
}

type projectEntry struct {
	endpoint string
	headers  map[string]string
}

// NewProjectRegistry creates an empty registry.
func NewProjectRegistry() *ProjectRegistry {
	return &ProjectRegistry{m: make(map[string]projectEntry)}
}

// ErrInvalidEndpoint is returned when an OTLP endpoint has a disallowed scheme.
var ErrInvalidEndpoint = errors.New("otlp endpoint must use http or https scheme")

// Set records an endpoint for a project. Empty endpoint clears the entry.
// Returns an error if the endpoint scheme is not http/https.
func (r *ProjectRegistry) Set(projectID, endpoint string, headers map[string]string) error {
	if projectID == "" {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if endpoint == "" {
		delete(r.m, projectID)
		return nil
	}
	if err := validateEndpointScheme(endpoint); err != nil {
		return err
	}
	r.m[projectID] = projectEntry{endpoint: endpoint, headers: headers}
	return nil
}

// validateEndpointScheme ensures only http/https endpoints are accepted.
func validateEndpointScheme(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		return ErrInvalidEndpoint
	}
	switch u.Scheme {
	case "http", "https":
		return nil
	default:
		return ErrInvalidEndpoint
	}
}

// Lookup returns the endpoint for a project.
func (r *ProjectRegistry) Lookup(projectID string) (string, map[string]string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.m[projectID]
	return e.endpoint, e.headers, ok
}

// --- Router Exporter (per-project fan-out) ---

type routerExporter struct {
	registry  *ProjectRegistry
	mu        sync.RWMutex
	byProject map[string]*otlptrace.Exporter
}

func (r *routerExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	buckets := make(map[string][]sdktrace.ReadOnlySpan)
	for _, s := range spans {
		pid := readAttr(s, AttrProjectID)
		if pid == "" {
			continue // no project = drop (customer traces always have a project)
		}
		buckets[pid] = append(buckets[pid], s)
	}

	for pid, batch := range buckets {
		exp, err := r.exporterFor(ctx, pid)
		if err != nil {
			continue // skip this project, don't poison others
		}
		_ = exp.ExportSpans(ctx, batch)
	}
	return nil
}

func (r *routerExporter) Shutdown(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, e := range r.byProject {
		_ = e.Shutdown(ctx)
	}
	r.byProject = make(map[string]*otlptrace.Exporter)
	return nil
}

func (r *routerExporter) exporterFor(ctx context.Context, projectID string) (*otlptrace.Exporter, error) {
	r.mu.RLock()
	if e, ok := r.byProject[projectID]; ok {
		r.mu.RUnlock()
		return e, nil
	}
	r.mu.RUnlock()

	endpoint, headers, ok := r.registry.Lookup(projectID)
	if !ok || endpoint == "" {
		return nil, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if e, ok := r.byProject[projectID]; ok {
		return e, nil
	}

	copts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(normalizeEndpoint(endpoint)),
		otlptracehttp.WithTimeout(5 * time.Second),
	}
	if len(headers) > 0 {
		copts = append(copts, otlptracehttp.WithHeaders(headers))
	}
	exp, err := otlptracehttp.New(ctx, copts...)
	if err != nil {
		return nil, err
	}
	r.byProject[projectID] = exp
	return exp, nil
}

func readAttr(s sdktrace.ReadOnlySpan, key string) string {
	for _, kv := range s.Attributes() {
		if string(kv.Key) == key {
			return kv.Value.AsString()
		}
	}
	return ""
}

func normalizeEndpoint(endpoint string) string {
	trimmed := strings.TrimRight(endpoint, "/")
	if strings.HasSuffix(trimmed, "/v1/traces") {
		return trimmed
	}
	return trimmed + "/v1/traces"
}
