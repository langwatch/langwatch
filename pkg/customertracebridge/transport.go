package customertracebridge

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	lru "github.com/hashicorp/golang-lru/v2"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/metric/noop"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
)

const defaultExporterCacheSize = 10_000

// cachedExporter records WHERE a cached exporter sends, so a later export can
// tell whether the registry still names that destination. Caching the exporter
// alone is what allowed a rotated token to keep shipping to a stale endpoint
// for the lifetime of the process.
type cachedExporter struct {
	exp      *otlptrace.Exporter
	endpoint string
	headers  map[string]string
}

// serves reports whether this cached exporter still targets the given
// destination — same endpoint AND same auth headers.
func (c cachedExporter) serves(endpoint string, headers map[string]string) bool {
	return c.endpoint == endpoint && headersEqual(c.headers, headers)
}

// routerExporter is an OTel SpanExporter that routes spans to per-project OTLP
// endpoints based on the langwatch.project_id attribute. Exporters are cached
// in a bounded LRU; evicted and superseded exporters are shut down gracefully.
type routerExporter struct {
	baseCtx   context.Context
	registry  *Registry
	mu        sync.Mutex
	byProject *lru.Cache[string, cachedExporter]
	closing   atomic.Bool

	spansExported metric.Int64Counter
	spansDropped  metric.Int64Counter
}

func newRouterExporter(ctx context.Context, registry *Registry) *routerExporter {
	r := &routerExporter{baseCtx: ctx, registry: registry}
	cache, _ := lru.NewWithEvict(
		defaultExporterCacheSize,
		func(_ string, c cachedExporter) {
			// During Shutdown the purge must not spawn a second, unobserved
			// shutdown per exporter: Shutdown owns the lifecycle from there on.
			if r.closing.Load() {
				return
			}
			shutdownDetached(c.exp)
		},
	)
	r.byProject = cache

	const scope = "langwatch-ai-gateway"
	meter := otel.Meter(scope)
	fallback := noop.NewMeterProvider().Meter(scope)
	var err error
	if r.spansExported, err = meter.Int64Counter(
		"langwatch.gateway.customer_trace.spans_exported",
		metric.WithDescription("Customer trace spans delivered to a project's OTLP ingest."),
	); err != nil {
		r.spansExported, _ = fallback.Int64Counter("langwatch.gateway.customer_trace.spans_exported")
	}
	if r.spansDropped, err = meter.Int64Counter(
		"langwatch.gateway.customer_trace.spans_dropped",
		metric.WithDescription("Customer trace spans that never reached a project, tagged by reason."),
	); err != nil {
		r.spansDropped, _ = fallback.Int64Counter("langwatch.gateway.customer_trace.spans_dropped")
	}
	return r
}

// shutdownDetached retires a superseded or evicted exporter without blocking
// the caller. The LRU evict callback runs inside Add/Remove while r.mu is held,
// and a blocking 5s Shutdown there would stall the single export goroutine for
// every other tenant.
func shutdownDetached(exp *otlptrace.Exporter) {
	if exp == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = exp.Shutdown(ctx)
	}()
}

func (r *routerExporter) ExportSpans(ctx context.Context, spans []sdktrace.ReadOnlySpan) error {
	buckets := make(map[string][]sdktrace.ReadOnlySpan)
	unrouted := 0
	for _, s := range spans {
		pid := readAttr(s, string(attrProjectID))
		if pid == "" {
			unrouted++
			continue
		}
		buckets[pid] = append(buckets[pid], s)
	}
	if unrouted > 0 {
		r.dropped(ctx, "no_project_id", unrouted)
		clog.Get(r.baseCtx).Warn("customer_trace_spans_unrouted", zap.Int("spans", unrouted))
	}

	var errs []error
	for pid, batch := range buckets {
		exp, buildErr := r.exporterFor(ctx, pid)
		if buildErr != nil {
			r.dropped(ctx, "exporter_build_failed", len(batch))
			clog.Get(r.baseCtx).Warn("customer_trace_exporter_build_failed",
				zap.String("project_id", pid), zap.Int("spans", len(batch)), zap.Error(buildErr))
			errs = append(errs, fmt.Errorf("project %s: %w", pid, buildErr))
			continue
		}
		if exp == nil {
			r.dropped(ctx, "no_endpoint", len(batch))
			clog.Get(r.baseCtx).Warn("customer_trace_no_endpoint",
				zap.String("project_id", pid), zap.Int("spans", len(batch)))
			continue
		}
		if err := exp.ExportSpans(ctx, batch); err != nil {
			// Surfaced, not swallowed: a customer receiving nothing — revoked or
			// rotated token, ingest outage — must be visible from the gateway.
			r.dropped(ctx, "export_failed", len(batch))
			clog.Get(r.baseCtx).Warn("customer_trace_export_failed",
				zap.String("project_id", pid), zap.Int("spans", len(batch)), zap.Error(err))
			errs = append(errs, fmt.Errorf("project %s: %w", pid, err))
			continue
		}
		r.spansExported.Add(ctx, int64(len(batch)))
	}
	return errors.Join(errs...)
}

func (r *routerExporter) dropped(ctx context.Context, reason string, n int) {
	r.spansDropped.Add(ctx, int64(n), metric.WithAttributes(attribute.String("reason", reason)))
}

// exporterShutdownTimeout bounds each tenant's final flush. One project whose
// OTLP ingest is unreachable must not hold the process open, and must not stall
// the other tenants' flush behind it — the same reasoning as shutdownDetached,
// which the eviction path already applies.
const exporterShutdownTimeout = 5 * time.Second

func (r *routerExporter) Shutdown(ctx context.Context) error {
	r.closing.Store(true)

	r.mu.Lock()
	pids := r.byProject.Keys()
	exps := make([]*otlptrace.Exporter, 0, len(pids))
	live := make([]string, 0, len(pids))
	for _, pid := range pids {
		if c, ok := r.byProject.Peek(pid); ok && c.exp != nil {
			live = append(live, pid)
			exps = append(exps, c.exp)
		}
	}
	r.byProject.Purge()
	r.mu.Unlock()

	// Off the lock and in parallel, each bounded independently.
	var wg sync.WaitGroup
	errs := make([]error, len(exps))
	for i := range exps {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sctx, cancel := context.WithTimeout(ctx, exporterShutdownTimeout)
			defer cancel()
			if err := exps[i].Shutdown(sctx); err != nil {
				// Surfaced, not swallowed, for the same reason a failed export is:
				// a customer's last spans going missing must be visible.
				clog.Get(r.baseCtx).Warn("customer_trace_exporter_shutdown_failed",
					zap.String("project_id", live[i]), zap.Error(err))
				errs[i] = fmt.Errorf("project %s: %w", live[i], err)
			}
		}(i)
	}
	wg.Wait()
	return errors.Join(errs...)
}

// exporterFor returns the exporter for a project, rebuilding it whenever the
// registry names a destination the cached one does not serve.
//
// The registry is consulted BEFORE the cache on purpose. Returning a cached
// exporter without checking the registry means an endpoint or auth-token change
// never takes effect: a rotated key keeps 401-ing with the old token, and a
// token corrected after a mispairing keeps shipping to the wrong project.
func (r *routerExporter) exporterFor(
	ctx context.Context,
	projectID string,
) (*otlptrace.Exporter, error) {
	endpoint, headers, ok := r.registry.Lookup(projectID)
	if !ok || endpoint == "" {
		return nil, nil
	}
	endpoint = normalizeEndpoint(endpoint)

	if c, hit := r.byProject.Get(projectID); hit && c.serves(endpoint, headers) {
		return c.exp, nil
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	// Double-check after lock: another goroutine may have rebuilt it.
	if c, hit := r.byProject.Get(projectID); hit {
		if c.serves(endpoint, headers) {
			return c.exp, nil
		}
		// Destination changed under us — retire the stale exporter. Remove fires
		// the evict callback, which detaches the shutdown.
		r.byProject.Remove(projectID)
	}

	copts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL(endpoint),
		otlptracehttp.WithTimeout(5 * time.Second),
	}
	if len(headers) > 0 {
		copts = append(copts, otlptracehttp.WithHeaders(headers))
	}
	exp, err := otlptracehttp.New(ctx, copts...)
	if err != nil {
		return nil, fmt.Errorf("build OTLP exporter: %w", err)
	}
	r.byProject.Add(projectID, cachedExporter{exp: exp, endpoint: endpoint, headers: headers})
	return exp, nil
}

func headersEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if bv, ok := b[k]; !ok || bv != v {
			return false
		}
	}
	return true
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
