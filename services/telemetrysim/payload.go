package telemetrysim

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"math"
	"math/rand/v2"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"

	colllogspb "go.opentelemetry.io/proto/otlp/collector/logs/v1"
	collmetricspb "go.opentelemetry.io/proto/otlp/collector/metrics/v1"
	colltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	logspb "go.opentelemetry.io/proto/otlp/logs/v1"
	metricspb "go.opentelemetry.io/proto/otlp/metrics/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// Signal is one OTLP signal; its HTTP path is /v1/<signal> below the endpoint.
type Signal string

// The signals telemetrysim sends.
const (
	SignalTraces  Signal = "traces"
	SignalLogs    Signal = "logs"
	SignalMetrics Signal = "metrics"
)

// Encoding is the OTLP HTTP body format.
type Encoding string

// The body formats telemetrysim sends.
const (
	EncodingProtobuf Encoding = "protobuf"
	EncodingJSON     Encoding = "json"
)

// Attr is one attribute. The string "$session" or "$user" becomes the batch's
// seeded id; an int or float64 is varied by the seed around its value.
type Attr struct {
	Key   string
	Value any
}

// SpanShape is one span of a trace preset.
type SpanShape struct {
	Name string
	// Parent is the parent's index in Spans plus one; 0 is the root.
	Parent     int
	Kind       tracepb.Span_SpanKind
	OffsetMs   int64
	DurationMs int64
	Attrs      []Attr
	// Error, when set, ends the span with an error status and an exception event.
	Error string
	// Events are extra span events, offset from the span's start.
	Events []EventShape
}

// EventShape is one span event of a SpanShape.
type EventShape struct {
	Name     string
	OffsetMs int64
	Attrs    []Attr
}

// LogShape is one record of a logs preset.
type LogShape struct {
	Body     string
	Severity logspb.SeverityNumber
	OffsetMs int64
	Attrs    []Attr
}

// MetricKind is how a MetricShape is reported.
type MetricKind string

// The ways a MetricShape is reported.
const (
	MetricSum       MetricKind = "sum"
	MetricGauge     MetricKind = "gauge"
	MetricHistogram MetricKind = "histogram"
)

// MetricShape is one metric of a metrics preset, one data point per batch.
type MetricShape struct {
	Name  string
	Unit  string
	Kind  MetricKind
	Base  float64
	Attrs []Attr
}

// Preset is one family of synthesized telemetry, as data. Recorded, scrubbed
// exports of real agents join these under fixtures/ (see its README).
type Preset struct {
	Name     string
	Signal   Signal
	Service  string
	Resource []Attr
	Spans    []SpanShape
	Logs     []LogShape
	Metrics  []MetricShape
}

const (
	client   = tracepb.Span_SPAN_KIND_CLIENT
	internal = tracepb.Span_SPAN_KIND_INTERNAL
)

// presets are synthesized shapes, not recordings: the coding-agent ones follow
// the span and attribute names those agents document, and a recording replaces
// them as the reference once one is committed.
var presets = append([]Preset{
	{Name: "llm-trace", Signal: SignalTraces, Service: "telemetrysim-agent", Spans: []SpanShape{
		{Name: "agent.run", Kind: internal, DurationMs: 2400, Attrs: []Attr{{"langwatch.thread.id", "$session"}, {"langwatch.user.id", "$user"}}},
		{Name: "chat gpt-4o-mini", Parent: 1, Kind: client, OffsetMs: 20, DurationMs: 1300, Attrs: []Attr{
			{"gen_ai.operation.name", "chat"}, {"gen_ai.system", "openai"}, {"gen_ai.request.model", "gpt-4o-mini"},
			{"gen_ai.usage.input_tokens", 420}, {"gen_ai.usage.output_tokens", 96},
		}},
		{Name: "execute_tool get_weather", Parent: 1, Kind: internal, OffsetMs: 1350, DurationMs: 300, Attrs: []Attr{
			{"gen_ai.operation.name", "execute_tool"}, {"gen_ai.tool.name", "get_weather"},
		}},
		{Name: "chat gpt-4o-mini", Parent: 1, Kind: client, OffsetMs: 1700, DurationMs: 650, Attrs: []Attr{
			{"gen_ai.operation.name", "chat"}, {"gen_ai.system", "openai"}, {"gen_ai.request.model", "gpt-4o-mini"},
			{"gen_ai.usage.input_tokens", 610}, {"gen_ai.usage.output_tokens", 48},
		}},
	}},
	{Name: "claude-code-session", Signal: SignalTraces, Service: "claude-code", Spans: []SpanShape{
		{Name: "claude_code.interaction", Kind: internal, DurationMs: 9000, Attrs: []Attr{{"session.id", "$session"}, {"user.id", "$user"}}},
		{Name: "claude_code.llm_request", Parent: 1, Kind: client, OffsetMs: 40, DurationMs: 3800, Attrs: []Attr{
			{"session.id", "$session"}, {"model", "claude-sonnet-4-5"}, {"input_tokens", 3200}, {"output_tokens", 410}, {"cost_usd", 0.0158},
		}},
		{Name: "claude_code.tool", Parent: 1, Kind: internal, OffsetMs: 3900, DurationMs: 800, Attrs: []Attr{
			{"session.id", "$session"}, {"tool_name", "Bash"}, {"success", true},
		}},
		{Name: "claude_code.llm_request", Parent: 1, Kind: client, OffsetMs: 4800, DurationMs: 3600, Attrs: []Attr{
			{"session.id", "$session"}, {"model", "claude-sonnet-4-5"}, {"input_tokens", 4100}, {"output_tokens", 290}, {"cost_usd", 0.0167},
		}},
	}},
	{Name: "codex-session", Signal: SignalTraces, Service: "codex_cli_rs", Spans: []SpanShape{
		{Name: "codex.conversation", Kind: internal, DurationMs: 7000, Attrs: []Attr{{"conversation.id", "$session"}, {"user.account_id", "$user"}}},
		{Name: "codex.api_request", Parent: 1, Kind: client, OffsetMs: 30, DurationMs: 2900, Attrs: []Attr{
			{"conversation.id", "$session"}, {"model", "gpt-5-codex"}, {"input_token_count", 2900}, {"output_token_count", 350},
		}},
		{Name: "codex.tool_result", Parent: 1, Kind: internal, OffsetMs: 3000, DurationMs: 600, Attrs: []Attr{
			{"conversation.id", "$session"}, {"tool_name", "shell"}, {"success", true},
		}},
		{Name: "codex.api_request", Parent: 1, Kind: client, OffsetMs: 3700, DurationMs: 3100, Attrs: []Attr{
			{"conversation.id", "$session"}, {"model", "gpt-5-codex"}, {"input_token_count", 3600}, {"output_token_count", 220},
		}},
	}},
	{Name: "logs", Signal: SignalLogs, Service: "telemetrysim-app", Logs: []LogShape{
		{Body: "request handled", Severity: logspb.SeverityNumber_SEVERITY_NUMBER_INFO, Attrs: []Attr{{"http.route", "/api/chat"}, {"session.id", "$session"}}},
		{Body: "slow upstream", Severity: logspb.SeverityNumber_SEVERITY_NUMBER_WARN, OffsetMs: 40, Attrs: []Attr{{"upstream.latency_ms", 1800}}},
		{Body: "tool call failed", Severity: logspb.SeverityNumber_SEVERITY_NUMBER_ERROR, OffsetMs: 80, Attrs: []Attr{{"exception.type", "ToolTimeout"}, {"user.id", "$user"}}},
	}},
	{Name: "metrics", Signal: SignalMetrics, Service: "telemetrysim-app", Metrics: []MetricShape{
		{Name: "telemetrysim.requests", Unit: "{request}", Kind: MetricSum, Base: 40, Attrs: []Attr{{"http.route", "/api/chat"}}},
		{Name: "telemetrysim.queue.depth", Unit: "{item}", Kind: MetricGauge, Base: 12},
		{Name: "telemetrysim.request.duration", Unit: "ms", Kind: MetricHistogram, Base: 120, Attrs: []Attr{{"http.route", "/api/chat"}}},
	}},
}, backfillPresets...)

func init() { presets = append(presets, markedPresets...) }

// PresetNames lists the presets in order.
func PresetNames() []string {
	names := make([]string, len(presets))
	for i := range presets {
		names[i] = presets[i].Name
	}
	return names
}

// PresetByName finds a preset by its name.
func PresetByName(name string) (Preset, bool) { return presetByName(name) }

func presetByName(name string) (Preset, bool) {
	for i := range presets {
		if presets[i].Name == name {
			return presets[i], true
		}
	}
	return Preset{}, false
}

// BatchSpec names one batch: the same spec always builds the same bytes.
type BatchSpec struct {
	Preset   Preset
	Seed     uint64
	Index    int
	Start    time.Time // the run's start; every instant is an offset from it
	Encoding Encoding
	Gzip     bool
}

// Payload is one encoded OTLP HTTP body.
type Payload struct {
	Signal      Signal
	Body        []byte
	ContentType string
	Gzip        bool
}

// Build encodes the batch spec names.
func Build(spec BatchSpec) (Payload, error) {
	body, err := marshal(message(spec), spec.Encoding)
	if err != nil {
		return Payload{}, err
	}
	return finish(spec, body, contentType(spec.Encoding))
}

func finish(spec BatchSpec, body []byte, ctype string) (Payload, error) {
	p := Payload{Signal: spec.Preset.Signal, Body: body, ContentType: ctype, Gzip: spec.Gzip}
	if !spec.Gzip {
		return p, nil
	}
	var buf bytes.Buffer
	w, err := gzip.NewWriterLevel(&buf, gzip.BestSpeed)
	if err != nil {
		return Payload{}, err
	}
	if _, err := w.Write(body); err != nil {
		return Payload{}, err
	}
	if err := w.Close(); err != nil {
		return Payload{}, err
	}
	p.Body = buf.Bytes()
	return p, nil
}

func contentType(enc Encoding) string {
	if enc == EncodingJSON {
		return "application/json"
	}
	return "application/x-protobuf"
}

// stream is the batch's PCG stream: (seed, name, index) fixes every draw.
func stream(seed uint64, name string, index int) *rand.Rand {
	h := fnv.New64a()
	_, _ = h.Write([]byte(name))
	return rand.New(rand.NewPCG(seed, h.Sum64()+uint64(index))) //nolint:gosec // index is a non-negative batch number
}

// batch is one batch being built: its draws, instants and seeded ids.
type batch struct {
	rng     *rand.Rand
	index   int
	start   time.Time
	at      time.Time
	session string
	user    string
	traceID []byte
}

func message(spec BatchSpec) proto.Message {
	b := &batch{
		rng: stream(spec.Seed, spec.Preset.Name, spec.Index), index: spec.Index,
		start: spec.Start, at: spec.Start.Add(time.Duration(spec.Index) * 100 * time.Millisecond),
	}
	b.session = hex.EncodeToString(b.bytes(8))
	b.user = "user-" + hex.EncodeToString(b.bytes(4))
	b.traceID = b.bytes(16)
	p := spec.Preset
	res := &resourcepb.Resource{Attributes: b.attributes(append([]Attr{{"service.name", p.Service}}, p.Resource...))}
	switch p.Signal {
	case SignalLogs:
		return b.logs(p, res)
	case SignalMetrics:
		return b.metrics(p, res)
	default:
		return b.traces(p, res)
	}
}

func (b *batch) bytes(n int) []byte {
	out := make([]byte, n)
	for i := range out {
		out[i] = byte(b.rng.Uint32())
	}
	return out
}

// vary is a seeded value between half and one and a half times n.
func (b *batch) vary(n int64) int64 {
	if n <= 0 {
		return n
	}
	return n/2 + b.rng.Int64N(n+1)
}

func (b *batch) attributes(in []Attr) []*commonpb.KeyValue {
	out := make([]*commonpb.KeyValue, 0, len(in))
	for _, a := range in {
		out = append(out, &commonpb.KeyValue{Key: a.Key, Value: b.value(a.Value)})
	}
	return out
}

func (b *batch) value(v any) *commonpb.AnyValue {
	switch v := v.(type) {
	case int:
		return &commonpb.AnyValue{Value: &commonpb.AnyValue_IntValue{IntValue: b.vary(int64(v))}}
	case float64:
		return &commonpb.AnyValue{Value: &commonpb.AnyValue_DoubleValue{DoubleValue: v * (0.5 + b.rng.Float64())}}
	case bool:
		return &commonpb.AnyValue{Value: &commonpb.AnyValue_BoolValue{BoolValue: v}}
	case string:
		switch v {
		case "$session":
			v = b.session
		case "$user":
			v = b.user
		}
		return &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: v}}
	}
	return &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: fmt.Sprint(v)}}
}

func nanos(t time.Time) uint64 { return uint64(t.UnixNano()) }

func ms(n int64) time.Duration { return time.Duration(n) * time.Millisecond }

func scope() *commonpb.InstrumentationScope {
	return &commonpb.InstrumentationScope{Name: "telemetrysim"}
}

func (b *batch) traces(p Preset, res *resourcepb.Resource) *colltracepb.ExportTraceServiceRequest {
	ids := make([][]byte, len(p.Spans))
	spans := make([]*tracepb.Span, len(p.Spans))
	for i, shape := range p.Spans {
		ids[i] = b.bytes(8)
		start := b.at.Add(ms(shape.OffsetMs))
		spans[i] = &tracepb.Span{
			TraceId: b.traceID, SpanId: ids[i], Name: shape.Name, Kind: shape.Kind,
			StartTimeUnixNano: nanos(start), EndTimeUnixNano: nanos(start.Add(ms(b.vary(shape.DurationMs)))),
			Attributes: b.attributes(shape.Attrs), Status: &tracepb.Status{Code: tracepb.Status_STATUS_CODE_OK},
		}
		if shape.Parent > 0 {
			spans[i].ParentSpanId = ids[shape.Parent-1]
		}
		for _, ev := range shape.Events {
			spans[i].Events = append(spans[i].Events, &tracepb.Span_Event{Name: ev.Name,
				TimeUnixNano: nanos(start.Add(ms(ev.OffsetMs))), Attributes: b.attributes(ev.Attrs)})
		}
		if shape.Error != "" {
			spans[i].Status = &tracepb.Status{Code: tracepb.Status_STATUS_CODE_ERROR, Message: shape.Error}
			spans[i].Events = append(spans[i].Events, &tracepb.Span_Event{Name: "exception", TimeUnixNano: spans[i].EndTimeUnixNano,
				Attributes: b.attributes([]Attr{{"exception.message", shape.Error}})})
		}
	}
	return &colltracepb.ExportTraceServiceRequest{ResourceSpans: []*tracepb.ResourceSpans{{
		Resource: res, ScopeSpans: []*tracepb.ScopeSpans{{Scope: scope(), Spans: spans}},
	}}}
}

func (b *batch) logs(p Preset, res *resourcepb.Resource) *colllogspb.ExportLogsServiceRequest {
	records := make([]*logspb.LogRecord, 0, len(p.Logs))
	for _, shape := range p.Logs {
		at := nanos(b.at.Add(ms(shape.OffsetMs)))
		records = append(records, &logspb.LogRecord{
			TimeUnixNano: at, ObservedTimeUnixNano: at, SeverityNumber: shape.Severity,
			SeverityText: strings.TrimPrefix(shape.Severity.String(), "SEVERITY_NUMBER_"),
			Body:         &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: shape.Body}},
			Attributes:   b.attributes(shape.Attrs), TraceId: b.traceID, SpanId: b.bytes(8),
		})
	}
	return &colllogspb.ExportLogsServiceRequest{ResourceLogs: []*logspb.ResourceLogs{{
		Resource: res, ScopeLogs: []*logspb.ScopeLogs{{Scope: scope(), LogRecords: records}},
	}}}
}

var histogramBounds = []float64{5, 10, 25, 50, 100, 250, 500, 1000}

func (b *batch) metrics(p Preset, res *resourcepb.Resource) *collmetricspb.ExportMetricsServiceRequest {
	out := make([]*metricspb.Metric, 0, len(p.Metrics))
	for _, shape := range p.Metrics {
		m := &metricspb.Metric{Name: shape.Name, Unit: shape.Unit}
		attrs := b.attributes(shape.Attrs)
		switch shape.Kind {
		case MetricSum:
			m.Data = &metricspb.Metric_Sum{Sum: &metricspb.Sum{
				AggregationTemporality: metricspb.AggregationTemporality_AGGREGATION_TEMPORALITY_CUMULATIVE, IsMonotonic: true,
				DataPoints: []*metricspb.NumberDataPoint{{
					StartTimeUnixNano: nanos(b.start), TimeUnixNano: nanos(b.at), Attributes: attrs,
					Value: &metricspb.NumberDataPoint_AsDouble{AsDouble: shape.Base*float64(b.index+1) + b.rng.Float64()},
				}},
			}}
		case MetricGauge:
			m.Data = &metricspb.Metric_Gauge{Gauge: &metricspb.Gauge{DataPoints: []*metricspb.NumberDataPoint{{
				TimeUnixNano: nanos(b.at), Attributes: attrs,
				Value: &metricspb.NumberDataPoint_AsDouble{AsDouble: shape.Base * (0.5 + b.rng.Float64())},
			}}}}
		case MetricHistogram:
			m.Data = &metricspb.Metric_Histogram{Histogram: b.histogram(shape.Base, attrs)}
		}
		out = append(out, m)
	}
	return &collmetricspb.ExportMetricsServiceRequest{ResourceMetrics: []*metricspb.ResourceMetrics{{
		Resource: res, ScopeMetrics: []*metricspb.ScopeMetrics{{Scope: scope(), Metrics: out}},
	}}}
}

// histogram is a delta of 10 to 20 exponential draws around base.
func (b *batch) histogram(base float64, attrs []*commonpb.KeyValue) *metricspb.Histogram {
	counts := make([]uint64, len(histogramBounds)+1)
	n := 10 + b.rng.IntN(11)
	sum, lo, hi := 0.0, math.Inf(1), 0.0
	for range n {
		v := b.rng.ExpFloat64() * base
		sum, lo, hi = sum+v, min(lo, v), max(hi, v)
		counts[sort.SearchFloat64s(histogramBounds, v)]++
	}
	return &metricspb.Histogram{
		AggregationTemporality: metricspb.AggregationTemporality_AGGREGATION_TEMPORALITY_DELTA,
		DataPoints: []*metricspb.HistogramDataPoint{{
			StartTimeUnixNano: nanos(b.at.Add(-100 * time.Millisecond)), TimeUnixNano: nanos(b.at),
			Count: uint64(n), Sum: &sum, Min: &lo, Max: &hi,
			BucketCounts: counts, ExplicitBounds: histogramBounds, Attributes: attrs,
		}},
	}
}

// marshal encodes msg. OTLP JSON wants hex ids and numeric enums; protojson
// writes base64 ids and unstable whitespace, so its output is re-encoded with
// encoding/json, which also sorts keys: same message, same bytes.
func marshal(msg proto.Message, enc Encoding) ([]byte, error) {
	if enc != EncodingJSON {
		return proto.MarshalOptions{Deterministic: true}.Marshal(msg)
	}
	raw, err := protojson.MarshalOptions{UseEnumNumbers: true}.Marshal(msg)
	if err != nil {
		return nil, err
	}
	// Compact drops protojson's deliberately unstable whitespace, so the same message gives the
	// same bytes; rewriting ids in place avoids decoding the whole document (seedgen's hot path).
	var compact bytes.Buffer
	compact.Grow(len(raw))
	if err := json.Compact(&compact, raw); err != nil {
		return nil, err
	}
	return hexIDs(compact.Bytes()), nil
}

var idKeys = [][]byte{[]byte(`"traceId`), []byte(`"spanId`), []byte(`"parentSpanId`)}

// hexIDs rewrites every OTLP id field's base64 value as hex, as OTLP/JSON wants. An id inside a
// string value has escaped quotes, so it never matches; a value that is not base64 is kept.
func hexIDs(doc []byte) []byte {
	marker := []byte(`Id":"`)
	out := make([]byte, 0, len(doc)+len(doc)/8)
	for {
		at := bytes.Index(doc, marker)
		if at < 0 {
			return append(out, doc...)
		}
		head, start := doc[:at+2], at+len(marker)
		end := bytes.IndexByte(doc[start:], '"')
		isID := slices.ContainsFunc(idKeys, func(key []byte) bool { return bytes.HasSuffix(head, key) })
		raw, err := base64.StdEncoding.DecodeString(string(doc[start : start+max(end, 0)]))
		if end < 0 || !isID || err != nil {
			out, doc = append(out, doc[:start]...), doc[start:]
			continue
		}
		out = hex.AppendEncode(append(out, doc[:start]...), raw)
		doc = doc[start+end:]
	}
}

// fuzzCase is one batch under mutation: its message, encoded body and type.
type fuzzCase struct {
	spec        BatchSpec
	rng         *rand.Rand
	msg         proto.Message
	body        []byte
	contentType string
}

type mutator struct {
	name  string
	apply func(c *fuzzCase) error
}

var mutators = []mutator{
	{"truncate", func(c *fuzzCase) error {
		if len(c.body) > 1 {
			c.body = c.body[:1+c.rng.IntN(len(c.body)-1)]
		}
		return nil
	}},
	{"flip-bytes", func(c *fuzzCase) error {
		for range 1 + c.rng.IntN(8) {
			i := c.rng.IntN(len(c.body))
			c.body[i] ^= byte(1 + c.rng.IntN(255))
		}
		return nil
	}},
	{"wrong-content-type", func(c *fuzzCase) error {
		c.contentType = contentType(EncodingJSON)
		if c.spec.Encoding == EncodingJSON {
			c.contentType = contentType(EncodingProtobuf)
		}
		return nil
	}},
	{"huge-attribute", func(c *fuzzCase) error {
		res := resourceOf(c.msg)
		res.Attributes = append(res.Attributes, &commonpb.KeyValue{Key: "telemetrysim.fuzz.padding", Value: &commonpb.AnyValue{
			Value: &commonpb.AnyValue_StringValue{StringValue: strings.Repeat("x", (64+c.rng.IntN(448))<<10)},
		}})
		body, err := marshal(c.msg, c.spec.Encoding)
		c.body = body
		return err
	}},
	{"empty-body", func(c *fuzzCase) error {
		c.body = nil
		return nil
	}},
}

func resourceOf(msg proto.Message) *resourcepb.Resource {
	switch m := msg.(type) {
	case *colllogspb.ExportLogsServiceRequest:
		return m.GetResourceLogs()[0].GetResource()
	case *collmetricspb.ExportMetricsServiceRequest:
		return m.GetResourceMetrics()[0].GetResource()
	case *colltracepb.ExportTraceServiceRequest:
		return m.GetResourceSpans()[0].GetResource()
	}
	return &resourcepb.Resource{}
}

// FuzzCase builds the spec's batch and applies the mutator its seed picks.
// The id is "<preset>/<seed>/<index>/<mutator>": ParseMutationID and the
// run's start rebuild the same bytes, so a failing case replays.
func FuzzCase(spec BatchSpec) (string, Payload, error) {
	msg := message(spec)
	body, err := marshal(msg, spec.Encoding)
	if err != nil {
		return "", Payload{}, err
	}
	c := &fuzzCase{spec: spec, rng: stream(spec.Seed, "fuzz:"+spec.Preset.Name, spec.Index), msg: msg, body: body, contentType: contentType(spec.Encoding)}
	m := mutators[c.rng.IntN(len(mutators))]
	if err := m.apply(c); err != nil {
		return "", Payload{}, err
	}
	p, err := finish(spec, c.body, c.contentType)
	return fmt.Sprintf("%s/%d/%d/%s", spec.Preset.Name, spec.Seed, spec.Index, m.name), p, err
}

// ParseMutationID splits a FuzzCase id back into the preset, seed and index.
func ParseMutationID(id string) (Preset, uint64, int, error) {
	parts := strings.Split(id, "/")
	if len(parts) != 4 {
		return Preset{}, 0, 0, fmt.Errorf("mutation id %q is not <preset>/<seed>/<index>/<mutator>", id)
	}
	preset, ok := presetByName(parts[0])
	seed, seedErr := strconv.ParseUint(parts[1], 10, 64)
	index, indexErr := strconv.Atoi(parts[2])
	if !ok || seedErr != nil || indexErr != nil || index < 0 {
		return Preset{}, 0, 0, fmt.Errorf("mutation id %q names no preset, seed and index", id)
	}
	return preset, seed, index, nil
}
