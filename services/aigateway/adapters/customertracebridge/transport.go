package customertracebridge

import (
	"context"
	"strings"
	"sync"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

const defaultExporterCacheSize = 10_000

// routerExporter is an OTel SpanExporter that routes spans to per-project OTLP
// endpoints based on the langwatch.project_id attribute. Exporters are cached
// in a bounded LRU; evicted exporters are shut down gracefully.
type routerExporter struct {
	registry  *Registry
	mu        sync.Mutex
	byProject *lru.Cache[string, *otlptrace.Exporter]
}

func newRouterExporter(registry *Registry) *routerExporter {
	r := &routerExporter{registry: registry}
	cache, _ := lru.NewWithEvict[string, *otlptrace.Exporter](
		defaultExporterCacheSize,
		func(_ string, exp *otlptrace.Exporter) {
			// Best-effort shutdown on eviction.
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = exp.Shutdown(ctx)
		},
	)
	r.byProject = cache
	return r
}

func (r *routerExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	buckets := make(map[string][]sdktrace.ReadOnlySpan)
	for _, s := range spans {
		pid := readAttr(s, string(attrProjectID))
		if pid == "" {
			continue
		}
		buckets[pid] = append(buckets[pid], s)
	}

	for pid, batch := range buckets {
		exp := r.exporterFor(ctx, pid)
		if exp == nil {
			continue
		}
		_ = exp.ExportSpans(ctx, batch)
	}
	return nil
}

func (r *routerExporter) Shutdown(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	keys := r.byProject.Keys()
	for _, k := range keys {
		if exp, ok := r.byProject.Get(k); ok {
			_ = exp.Shutdown(ctx)
		}
	}
	r.byProject.Purge()
	return nil
}

func (r *routerExporter) exporterFor(ctx context.Context, projectID string) *otlptrace.Exporter {
	// Fast path: already cached (LRU Get promotes to front).
	if exp, ok := r.byProject.Get(projectID); ok {
		return exp
	}

	endpoint, headers, ok := r.registry.Lookup(projectID)
	if !ok || endpoint == "" {
		return nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	// Double-check after lock.
	if exp, ok := r.byProject.Get(projectID); ok {
		return exp
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
		return nil
	}
	r.byProject.Add(projectID, exp)
	return exp
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
