package telemetrysim

import (
	"errors"
	"fmt"
	"time"

	colllogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collmetricspb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	colltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	logspb "go.opentelemetry.io/proto/otlp/logs/v1"
	metricspb "go.opentelemetry.io/proto/otlp/metrics/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

// Part is one slice of a backfill chunk. For a trace preset it is trace number Index of its cell,
// cut to its first Count spans; for logs and metrics it is Count records or points numbered from
// Index. Each trace, record or point draws from its own stream, so chunking never changes content.
type Part struct {
	Preset Preset
	Index  int
	Count  int
}

// Backfill is one chunk of past telemetry: every instant falls in [Start, Start+Window), so a
// backfill never reads the clock. The same Backfill always builds the same bytes.
type Backfill struct {
	Seed     uint64
	Start    time.Time
	Window   time.Duration
	Parts    []Part
	Encoding Encoding
}

// BuildBackfill encodes the chunk; its parts must share one signal.
func BuildBackfill(fill Backfill) (Payload, error) {
	if len(fill.Parts) == 0 {
		return Payload{}, errors.New("backfill has no parts")
	}
	signal := fill.Parts[0].Preset.Signal
	for i := range fill.Parts {
		if fill.Parts[i].Preset.Signal != signal {
			return Payload{}, fmt.Errorf("backfill mixes %s and %s", signal, fill.Parts[i].Preset.Signal)
		}
	}
	var msg proto.Message
	switch signal {
	case SignalLogs:
		msg = backfillLogs(fill)
	case SignalMetrics:
		msg = backfillMetrics(fill)
	default:
		msg = backfillTraces(fill)
	}
	body, err := marshal(msg, fill.Encoding)
	if err != nil {
		return Payload{}, err
	}
	return Payload{Signal: signal, Body: body, ContentType: contentType(fill.Encoding)}, nil
}

// item is one trace, record or point: its own stream, placed so that it ends inside the window.
func (fill Backfill) item(p Preset, index int, extent time.Duration) *batch {
	b := &batch{rng: stream(fill.Seed, p.Name, index), index: index, start: fill.Start}
	room := fill.Window - extent
	b.at = fill.Start
	if room > 0 {
		b.at = fill.Start.Add(time.Duration(b.rng.Int64N(int64(room))))
	}
	b.session = fmt.Sprintf("%016x", fill.Seed^uint64(b.rng.IntN(64))) // a few traces share each thread
	b.user = fmt.Sprintf("user-%02d", b.rng.IntN(40))
	b.traceID = b.bytes(16)
	return b
}

// extent is the latest a preset's span may end: vary stretches a duration to at most 1.5 times.
func extent(p Preset) time.Duration {
	var most int64
	for _, s := range p.Spans {
		most = max(most, s.OffsetMs+s.DurationMs*3/2+1)
	}
	return ms(most)
}

// grouped keeps one resource per preset, in first-seen order.
type grouped[T any] struct {
	order []string
	by    map[string]*T
}

func (g *grouped[T]) get(name string, fresh func() *T) *T {
	if g.by == nil {
		g.by = map[string]*T{}
	}
	if v, ok := g.by[name]; ok {
		return v
	}
	v := fresh()
	g.by[name], g.order = v, append(g.order, name)
	return v
}

func (g *grouped[T]) all() []*T {
	out := make([]*T, 0, len(g.order))
	for _, name := range g.order {
		out = append(out, g.by[name])
	}
	return out
}

func resourceFor(p Preset) *resourcepb.Resource {
	b := &batch{}
	return &resourcepb.Resource{Attributes: b.attributes(append([]Attr{{"service.name", p.Service}}, p.Resource...))}
}

func backfillTraces(fill Backfill) *colltracepb.ExportTraceServiceRequest {
	var groups grouped[tracepb.ResourceSpans]
	for i := range fill.Parts {
		part := &fill.Parts[i]
		p := part.Preset
		p.Spans = p.Spans[:min(part.Count, len(p.Spans))]
		spans := fill.item(p, part.Index, extent(p)).traces(p, nil).GetResourceSpans()[0].GetScopeSpans()[0].GetSpans()
		rs := groups.get(p.Name, func() *tracepb.ResourceSpans {
			return &tracepb.ResourceSpans{Resource: resourceFor(p), ScopeSpans: []*tracepb.ScopeSpans{{Scope: scope()}}}
		})
		rs.ScopeSpans[0].Spans = append(rs.ScopeSpans[0].Spans, spans...)
	}
	return &colltracepb.ExportTraceServiceRequest{ResourceSpans: groups.all()}
}

func backfillLogs(fill Backfill) *colllogspb.ExportLogsServiceRequest {
	var groups grouped[logspb.ResourceLogs]
	for i := range fill.Parts {
		part := &fill.Parts[i]
		p := part.Preset
		rl := groups.get(p.Name, func() *logspb.ResourceLogs {
			return &logspb.ResourceLogs{Resource: resourceFor(p), ScopeLogs: []*logspb.ScopeLogs{{Scope: scope()}}}
		})
		for k := part.Index; k < part.Index+part.Count; k++ {
			one := Preset{Logs: []LogShape{p.Logs[k%len(p.Logs)]}}
			one.Logs[0].OffsetMs = 0
			records := fill.item(p, k, 0).logs(one, nil).GetResourceLogs()[0].GetScopeLogs()[0].GetLogRecords()
			rl.ScopeLogs[0].LogRecords = append(rl.ScopeLogs[0].LogRecords, records...)
		}
	}
	return &colllogspb.ExportLogsServiceRequest{ResourceLogs: groups.all()}
}

// backfillMetrics reports each point as its own delta so points need no ordering across chunks.
func backfillMetrics(fill Backfill) *collmetricspb.ExportMetricsServiceRequest {
	var groups grouped[metricspb.ResourceMetrics]
	for i := range fill.Parts {
		part := &fill.Parts[i]
		p := part.Preset
		rm := groups.get(p.Name, func() *metricspb.ResourceMetrics {
			return &metricspb.ResourceMetrics{Resource: resourceFor(p), ScopeMetrics: []*metricspb.ScopeMetrics{{Scope: scope()}}}
		})
		for k := part.Index; k < part.Index+part.Count; k++ {
			b := fill.item(p, k, 100*time.Millisecond)
			b.at = b.at.Add(100 * time.Millisecond) // a delta's start must stay inside the window
			b.start = b.at.Add(-100 * time.Millisecond)
			m := b.metrics(Preset{Metrics: []MetricShape{p.Metrics[k%len(p.Metrics)]}}, nil).GetResourceMetrics()[0].GetScopeMetrics()[0].GetMetrics()
			if sum := m[0].GetSum(); sum != nil {
				sum.AggregationTemporality = metricspb.AggregationTemporality_AGGREGATION_TEMPORALITY_DELTA
				sum.DataPoints[0].Value = &metricspb.NumberDataPoint_AsDouble{AsDouble: p.Metrics[k%len(p.Metrics)].Base * (0.5 + b.rng.Float64())}
			}
			rm.ScopeMetrics[0].Metrics = append(rm.ScopeMetrics[0].Metrics, m...)
		}
	}
	return &collmetricspb.ExportMetricsServiceRequest{ResourceMetrics: groups.all()}
}
