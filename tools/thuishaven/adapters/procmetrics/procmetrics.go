// Package procmetrics ships the daemon's process-watch observations (ADR-095)
// to the local observability stack over OTLP, so per-class footprints and
// governor kills become queryable history in Grafana. Fire-and-forget by
// contract: when the stack is down, exports are dropped silently.
package procmetrics

import (
	"context"
	"fmt"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/exporters/otlp/otlpmetric/otlpmetrichttp"
	"go.opentelemetry.io/otel/metric"
	sdkmetric "go.opentelemetry.io/otel/sdk/metric"
	"go.opentelemetry.io/otel/sdk/resource"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Recorder implements the app's ProcTelemetry port.
type Recorder struct {
	rss    metric.Int64Gauge
	count  metric.Int64Gauge
	oldest metric.Int64Gauge
	kills  metric.Int64Counter
	// lastSeen tracks which class/role attribute pairs were published on the
	// previous sample, so a class that vanishes is zeroed rather than frozen
	// at its final value on the dashboard.
	lastSeen map[[2]string]bool
}

// New builds a Recorder exporting to the local OTLP HTTP endpoint. Exports
// that cannot be delivered are dropped without logging — the daemon must never
// grow a spam stream because Grafana is down.
func New(otlpHTTPPort int) *Recorder {
	exporter, err := otlpmetrichttp.New(context.Background(),
		otlpmetrichttp.WithEndpoint(fmt.Sprintf("127.0.0.1:%d", otlpHTTPPort)),
		otlpmetrichttp.WithInsecure(),
	)
	if err != nil {
		return nil
	}
	// The global handler would print every failed export to stderr; the
	// port's contract is silence.
	otel.SetErrorHandler(otel.ErrorHandlerFunc(func(error) {}))
	provider := sdkmetric.NewMeterProvider(
		sdkmetric.WithResource(resource.NewWithAttributes(semconv.SchemaURL,
			semconv.ServiceName("haven"),
		)),
		sdkmetric.WithReader(sdkmetric.NewPeriodicReader(exporter,
			sdkmetric.WithInterval(30*time.Second),
		)),
	)
	meter := provider.Meter("haven/procwatch")
	rss, err1 := meter.Int64Gauge("haven_proc_rss_bytes",
		metric.WithDescription("resident set of all watched processes, by class and role"))
	count, err2 := meter.Int64Gauge("haven_proc_count",
		metric.WithDescription("watched process count, by class and role"))
	oldest, err3 := meter.Int64Gauge("haven_proc_oldest_age_seconds",
		metric.WithDescription("age of the oldest watched process, by class and role"))
	kills, err4 := meter.Int64Counter("haven_proc_governor_kills_total",
		metric.WithDescription("processes the governor reclaimed, by class and reason"))
	if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
		return nil
	}
	return &Recorder{rss: rss, count: count, oldest: oldest, kills: kills, lastSeen: map[[2]string]bool{}}
}

// RecordSample publishes the current footprint of every watched class.
func (r *Recorder) RecordSample(procs []domain.WatchedProcess) {
	if r == nil {
		return
	}
	ctx := context.Background()
	type agg struct {
		rss    int64
		count  int64
		oldest time.Time
	}
	byKey := map[[2]string]agg{}
	now := time.Now()
	for _, p := range procs {
		key := [2]string{p.Class, string(p.Role)}
		a := byKey[key]
		a.rss += p.RSS
		a.count++
		if a.oldest.IsZero() || p.Started.Before(a.oldest) {
			a.oldest = p.Started
		}
		byKey[key] = a
	}
	seen := map[[2]string]bool{}
	for key, a := range byKey {
		attrs := metric.WithAttributes(
			attribute.String("class", key[0]),
			attribute.String("role", key[1]),
		)
		r.rss.Record(ctx, a.rss, attrs)
		r.count.Record(ctx, a.count, attrs)
		r.oldest.Record(ctx, int64(now.Sub(a.oldest).Seconds()), attrs)
		seen[key] = true
	}
	for key := range r.lastSeen {
		if seen[key] {
			continue
		}
		attrs := metric.WithAttributes(
			attribute.String("class", key[0]),
			attribute.String("role", key[1]),
		)
		r.rss.Record(ctx, 0, attrs)
		r.count.Record(ctx, 0, attrs)
		r.oldest.Record(ctx, 0, attrs)
	}
	r.lastSeen = seen
}

// RecordKill counts one governor enforcement.
func (r *Recorder) RecordKill(class, reason string) {
	if r == nil {
		return
	}
	r.kills.Add(context.Background(), 1, metric.WithAttributes(
		attribute.String("class", class),
		attribute.String("reason", reason),
	))
}
