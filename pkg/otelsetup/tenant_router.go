// Tenant-aware span router for multi-project OTel export.
//
// Background: nlpgo runs in a Lambda-style container that's reused
// across invocations from different LangWatch projects. Each Studio
// event arrives with its own `workflow.api_key` (the project's
// LangWatch API key). Spans produced during that handler must be
// exported back to LangWatch's /api/otel/v1/traces endpoint with
// `X-Auth-Token: <api_key>` so the langwatch app's collector can
// attribute the trace to the right project.
//
// The OTel SDK's standard pattern is "configure auth headers on the
// exporter at boot, batch globally". That's wrong here: a single
// batch can contain spans from multiple tenants (concurrent Lambda
// invocations or container reuse), and a static `X-Auth-Token` would
// attribute every span to whichever tenant's key was wired in. Cross-
// tenant trace leakage is the threat we cannot tolerate.
//
// This router solves it by:
//
//  1. Stamping the api_key onto each span at OnStart, sourced from
//     the per-request context.Context (set by the HTTP middleware).
//     The api_key is held in an internal map keyed by the span's
//     {trace_id, span_id} — NOT exposed as a span attribute (that
//     would leak the secret to the OTLP collector wire).
//
//  2. Routing OnEnd to a per-tenant `BatchSpanProcessor` cached in a
//     sync.Map keyed by api_key. Each processor wraps an
//     `otlptracehttp` exporter constructed with that tenant's key as
//     a static `X-Auth-Token` header — so async batching is safe
//     because each batch already belongs to one tenant.
//
// Lambda safety: no per-request global state mutation. The router
// itself is global and immutable; per-tenant processors are created
// lazily and cached. ForceFlush + Shutdown fan out to every cached
// processor.
package otelsetup

import (
	"context"
	"errors"
	"sync"

	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// APIKeyContextKey is the context key the HTTP middleware uses to
// stash the inbound `workflow.api_key`. Public so middleware in
// services/nlpgo/adapters/httpapi can set it without importing this
// package's internals.
type APIKeyContextKey struct{}

// spanIdent is the lookup key for the span→api_key map. Combining
// trace_id + span_id ensures uniqueness across concurrent traces.
type spanIdent [24]byte

func identFor(sc trace.SpanContext) spanIdent {
	var k spanIdent
	tid := sc.TraceID()
	sid := sc.SpanID()
	copy(k[:16], tid[:])
	copy(k[16:], sid[:])
	return k
}

// TenantRouter is a sdktrace.SpanProcessor that routes each span to a
// per-tenant BatchSpanProcessor based on the api_key sourced from the
// request context at OnStart time.
type TenantRouter struct {
	endpoint string

	// spanAuth maps spanIdent → api_key (string). Populated on
	// OnStart, consumed (and deleted) on OnEnd. Keeps the api_key
	// off the span itself so we don't leak it to the OTLP wire.
	spanAuth sync.Map

	// processors maps api_key → sdktrace.SpanProcessor. Lazily
	// initialized on first sight of a tenant; cached for the life of
	// the process. Each processor owns its own otlptracehttp exporter
	// configured with that tenant's static auth header.
	processors sync.Map

	// newProcessor is the constructor used to build a per-tenant
	// processor when the router first sees an api_key. Indirected
	// through a field so tests can stub the OTLP exporter without
	// standing up a real HTTPS endpoint.
	newProcessor func(endpoint, apiKey string) (sdktrace.SpanProcessor, error)
}

// NewTenantRouter constructs a router that exports to `endpoint`
// (typically `${LANGWATCH_ENDPOINT}/api/otel/v1/traces`). Per-tenant
// processors are built on first sight of each api_key.
func NewTenantRouter(endpoint string) *TenantRouter {
	return &TenantRouter{
		endpoint:     endpoint,
		newProcessor: defaultTenantProcessor,
	}
}

func defaultTenantProcessor(endpoint, apiKey string) (sdktrace.SpanProcessor, error) {
	exp, err := otlptracehttp.New(context.Background(),
		otlptracehttp.WithEndpointURL(endpoint),
		otlptracehttp.WithHeaders(map[string]string{
			"X-Auth-Token": apiKey,
		}),
	)
	if err != nil {
		return nil, err
	}
	return sdktrace.NewBatchSpanProcessor(exp), nil
}

// OnStart records the request's api_key for the span. Called
// synchronously in the goroutine that started the span — the parent
// context still holds the per-request value at this point.
func (r *TenantRouter) OnStart(parent context.Context, s sdktrace.ReadWriteSpan) {
	apiKey, _ := parent.Value(APIKeyContextKey{}).(string)
	if apiKey == "" {
		// Fall back to the parent span's recorded api_key (handles
		// child spans started in goroutines that didn't propagate
		// ctx — rare but possible). Empty string just means "drop";
		// downstream OnEnd skips spans without auth.
		if parentSpan := trace.SpanFromContext(parent); parentSpan.SpanContext().IsValid() {
			if v, ok := r.spanAuth.Load(identFor(parentSpan.SpanContext())); ok {
				apiKey, _ = v.(string)
			}
		}
	}
	if apiKey == "" {
		return
	}
	r.spanAuth.Store(identFor(s.SpanContext()), apiKey)
}

// OnEnd dispatches the span to its tenant's BatchSpanProcessor.
// Spans without a recorded api_key are dropped — they had no tenant
// context at start time and we have no safe attribution path for them.
func (r *TenantRouter) OnEnd(s sdktrace.ReadOnlySpan) {
	ident := identFor(s.SpanContext())
	v, ok := r.spanAuth.LoadAndDelete(ident)
	if !ok {
		return
	}
	apiKey, _ := v.(string)
	if apiKey == "" {
		return
	}
	proc, err := r.processorFor(apiKey)
	if err != nil || proc == nil {
		return
	}
	proc.OnEnd(s)
}

// processorFor returns the (cached) BatchSpanProcessor for `apiKey`,
// constructing it on first sight. Concurrent calls for the same
// api_key race the constructor but LoadOrStore ensures only one
// processor lands in the map per key.
func (r *TenantRouter) processorFor(apiKey string) (sdktrace.SpanProcessor, error) {
	if existing, ok := r.processors.Load(apiKey); ok {
		return existing.(sdktrace.SpanProcessor), nil
	}
	created, err := r.newProcessor(r.endpoint, apiKey)
	if err != nil {
		return nil, err
	}
	actual, loaded := r.processors.LoadOrStore(apiKey, created)
	if loaded {
		// We lost the race; another goroutine cached first. Drop our
		// instance — leaks the BSP background goroutine until process
		// exit, but races on the same key are rare (one per tenant)
		// and shutdown sweeps the surviving cache entry anyway.
		_ = created.Shutdown(context.Background())
	}
	return actual.(sdktrace.SpanProcessor), nil
}

// ForceFlush flushes every per-tenant processor. Callers that need
// at-most-N-tenant ordering must serialize their own; this fans out
// in undefined order.
func (r *TenantRouter) ForceFlush(ctx context.Context) error {
	var errs []error
	r.processors.Range(func(_, v any) bool {
		if err := v.(sdktrace.SpanProcessor).ForceFlush(ctx); err != nil {
			errs = append(errs, err)
		}
		return true
	})
	return errors.Join(errs...)
}

// Shutdown flushes + tears down every per-tenant processor.
func (r *TenantRouter) Shutdown(ctx context.Context) error {
	var errs []error
	r.processors.Range(func(_, v any) bool {
		if err := v.(sdktrace.SpanProcessor).Shutdown(ctx); err != nil {
			errs = append(errs, err)
		}
		return true
	})
	return errors.Join(errs...)
}
