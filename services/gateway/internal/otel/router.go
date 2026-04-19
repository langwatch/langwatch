package otel

import (
	"context"
	"sync"
	"time"

	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

// RouterExporter dispatches each span to a per-project OTLP exporter,
// looked up by the `langwatch.project_id` span attribute. When no
// project_id is present or a lookup returns no endpoint, the default
// exporter handles the span.
//
// Per-project routing enables customers to send their gateway spans to
// their own LangWatch project (the same one their SDK pushes to), so the
// gateway span appears as a child of the user's existing trace with no
// extra wiring. A single bifrost engine serves every tenant; one OTLP
// exporter per project keeps the blast radius of any single upstream
// outage contained.
type RouterExporter struct {
	mu         sync.RWMutex
	byProject  map[string]*otlptrace.Exporter
	defaultExp sdktrace.SpanExporter
	lookup     EndpointResolver
	headers    map[string]string
	timeout    time.Duration
}

// EndpointResolver returns the OTLP HTTP endpoint (scheme://host[:port])
// for a given project_id. A nil resolver means "no per-project routing
// yet — always use default". Resolvers must be safe to call on the hot
// path; cache upstream.
type EndpointResolver func(projectID string) (endpoint string, headers map[string]string, ok bool)

// RouterOptions configures the routing exporter.
type RouterOptions struct {
	// DefaultEndpoint is the OTLP HTTP endpoint used when no per-project
	// routing is configured or when no resolver is set. Empty string
	// drops spans silently (useful for tests and dev).
	DefaultEndpoint string
	// DefaultHeaders are applied to the default exporter.
	DefaultHeaders map[string]string
	// Resolver returns per-project endpoints. Optional.
	Resolver EndpointResolver
	// Timeout is the per-export http timeout for every exporter.
	Timeout time.Duration
}

// NewRouterExporter builds the routing exporter. Returns a span
// exporter that can be passed to a BatchSpanProcessor.
func NewRouterExporter(ctx context.Context, opts RouterOptions) (*RouterExporter, error) {
	r := &RouterExporter{
		byProject: make(map[string]*otlptrace.Exporter),
		lookup:    opts.Resolver,
		headers:   opts.DefaultHeaders,
		timeout:   opts.Timeout,
	}
	if opts.DefaultEndpoint != "" {
		exp, err := buildOTLPExporter(ctx, opts.DefaultEndpoint, opts.DefaultHeaders, opts.Timeout)
		if err != nil {
			return nil, err
		}
		r.defaultExp = exp
	} else {
		r.defaultExp = &noopExporter{}
	}
	return r, nil
}

// ExportSpans fans spans out by project_id. Spans without a resolvable
// endpoint go to the default exporter.
func (r *RouterExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	buckets := make(map[string][]sdktrace.ReadOnlySpan)
	var defaultBucket []sdktrace.ReadOnlySpan
	for _, s := range spans {
		pid := readProjectID(s)
		if pid == "" || r.lookup == nil {
			defaultBucket = append(defaultBucket, s)
			continue
		}
		endpoint, _, ok := r.lookup(pid)
		if !ok || endpoint == "" {
			defaultBucket = append(defaultBucket, s)
			continue
		}
		buckets[pid] = append(buckets[pid], s)
	}
	// Export default bucket first (most common path).
	if len(defaultBucket) > 0 && r.defaultExp != nil {
		if err := r.defaultExp.ExportSpans(ctx, defaultBucket); err != nil {
			return err
		}
	}
	for pid, bucket := range buckets {
		exp, err := r.exporterFor(ctx, pid)
		if err != nil {
			// Failing a single project's export must not poison the
			// others; log upstream by swallowing here (exporter
			// instrumentation hooks up its own error metric).
			continue
		}
		_ = exp.ExportSpans(ctx, bucket)
	}
	return nil
}

// Shutdown flushes and closes all exporters.
func (r *RouterExporter) Shutdown(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	var firstErr error
	if r.defaultExp != nil {
		if err := r.defaultExp.Shutdown(ctx); err != nil {
			firstErr = err
		}
	}
	for _, e := range r.byProject {
		if err := e.Shutdown(ctx); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	r.byProject = map[string]*otlptrace.Exporter{}
	return firstErr
}

func (r *RouterExporter) exporterFor(ctx context.Context, projectID string) (*otlptrace.Exporter, error) {
	r.mu.RLock()
	if e, ok := r.byProject[projectID]; ok {
		r.mu.RUnlock()
		return e, nil
	}
	r.mu.RUnlock()

	endpoint, headers, _ := r.lookup(projectID)
	r.mu.Lock()
	defer r.mu.Unlock()
	if e, ok := r.byProject[projectID]; ok {
		return e, nil
	}
	exp, err := buildOTLPExporter(ctx, endpoint, mergeHeaders(r.headers, headers), r.timeout)
	if err != nil {
		return nil, err
	}
	r.byProject[projectID] = exp
	return exp, nil
}

func buildOTLPExporter(ctx context.Context, endpoint string, headers map[string]string, timeout time.Duration) (*otlptrace.Exporter, error) {
	if timeout == 0 {
		timeout = 5 * time.Second
	}
	copts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(endpoint),
		otlptracehttp.WithTimeout(timeout),
	}
	if len(headers) > 0 {
		copts = append(copts, otlptracehttp.WithHeaders(headers))
	}
	return otlptracehttp.New(ctx, copts...)
}

func mergeHeaders(a, b map[string]string) map[string]string {
	if len(a) == 0 {
		return b
	}
	if len(b) == 0 {
		return a
	}
	out := make(map[string]string, len(a)+len(b))
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

func readProjectID(s sdktrace.ReadOnlySpan) string {
	for _, kv := range s.Attributes() {
		if string(kv.Key) == AttrProjectID {
			return kv.Value.AsString()
		}
	}
	return ""
}

// noopExporter drops spans silently. Used when no default endpoint is
// configured (dev mode) so the SDK machinery still runs and tests can
// assert span shape without a live collector.
type noopExporter struct{}

func (n *noopExporter) ExportSpans(context.Context, []sdktrace.ReadOnlySpan) error { return nil }
func (n *noopExporter) Shutdown(context.Context) error                             { return nil }
