package otlp

import (
	"context"
	"math"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
	collectortrace "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/langwatch/langwatch/sdks/go/internal/otlphttp"
)

// paritySpans covers every field and attribute type the encoders map.
func paritySpans(t *testing.T) []sdktrace.ReadOnlySpan {
	t.Helper()
	traceID := trace.TraceID{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16}
	state, err := trace.ParseTraceState("lw=1,other=two")
	require.NoError(t, err)
	start := time.Unix(1_700_000_000, 42)
	scope := instrumentation.Scope{
		Name:       "github.com/langwatch/langwatch/sdks/go",
		Version:    "1.2.3",
		SchemaURL:  "https://opentelemetry.io/schemas/1.26.0",
		Attributes: attribute.NewSet(attribute.String("scope.attr", "x")),
	}
	res := resource.NewWithAttributes("https://opentelemetry.io/schemas/1.26.0",
		attribute.String("service.name", "svc"), attribute.Int64("pid", 7))

	rich := tracetest.SpanStub{
		Name: "llm.chat",
		SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
			TraceID: traceID, SpanID: trace.SpanID{1}, TraceFlags: trace.FlagsSampled, TraceState: state,
		}),
		Parent:    trace.NewSpanContext(trace.SpanContextConfig{TraceID: traceID, SpanID: trace.SpanID{2}, Remote: true}),
		SpanKind:  trace.SpanKindClient,
		StartTime: start,
		EndTime:   start.Add(1500 * time.Millisecond),
		Attributes: []attribute.KeyValue{
			attribute.String("langwatch.input", `{"q":"hi"}`),
			attribute.String("langwatch.output", strings.Repeat("long ", 40_000)),
			attribute.String("blank", ""),
			attribute.Bool("on", true),
			attribute.Bool("off", false),
			attribute.Int64("max", math.MaxInt64),
			attribute.Int64("min", math.MinInt64),
			attribute.Int64("zero", 0),
			attribute.Float64("cost", 0.25),
			attribute.Float64("inf", math.Inf(-1)),
			attribute.Float64("nought", 0),
			attribute.ByteSlice("blob", []byte{0xff, 0x00, 0x10}),
			attribute.BoolSlice("bools", []bool{true, false}),
			attribute.Int64Slice("ints", []int64{-1, 0, 1}),
			attribute.Float64Slice("floats", []float64{0.5, 0}),
			attribute.StringSlice("tags", []string{"a", ""}),
			attribute.Slice("mixed", attribute.StringValue("s"), attribute.Int64Value(3),
				attribute.SliceValue(attribute.BoolValue(true))),
		},
		DroppedAttributes: 3,
		Events: []sdktrace.Event{
			{Name: "evaluation", Time: start.Add(time.Millisecond), Attributes: []attribute.KeyValue{attribute.String("score", "1")}, DroppedAttributeCount: 1},
			{Name: "bare", Time: start},
		},
		DroppedEvents: 2,
		Links: []sdktrace.Link{{
			SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
				TraceID: traceID, SpanID: trace.SpanID{3}, TraceState: state, Remote: true, TraceFlags: trace.FlagsSampled,
			}),
			Attributes:            []attribute.KeyValue{attribute.Int64("link.n", 9)},
			DroppedAttributeCount: 4,
		}},
		DroppedLinks:         5,
		Status:               sdktrace.Status{Code: codes.Error, Description: "boom"},
		InstrumentationScope: scope,
		Resource:             res,
	}
	root := tracetest.SpanStub{
		Name:                 "root",
		SpanContext:          trace.NewSpanContext(trace.SpanContextConfig{TraceID: traceID, SpanID: trace.SpanID{4}}),
		SpanKind:             trace.SpanKindServer,
		StartTime:            start,
		EndTime:              start,
		Status:               sdktrace.Status{Code: codes.Ok},
		InstrumentationScope: scope,
		Resource:             res,
	}
	otherScope := root
	otherScope.Name = "other scope"
	otherScope.InstrumentationScope = instrumentation.Scope{Name: "other"}
	otherResource := root
	otherResource.Name = "other resource"
	otherResource.Resource = resource.NewSchemaless(attribute.String("service.name", "other"))
	beforeEpoch := root
	beforeEpoch.Name = "before epoch"
	beforeEpoch.StartTime = time.Unix(-5, 0)
	beforeEpoch.SpanKind = trace.SpanKindUnspecified

	return tracetest.SpanStubs{rich, root, otherScope, otherResource, beforeEpoch}.Snapshots()
}

// The default exporter writes protobuf by hand; this holds it to the bytes
// otlptracehttp sends for the same spans, decoded by the generated types.
func TestDefaultEncoderMatchesOTLPTraceHTTP(t *testing.T) {
	spans := paritySpans(t)

	rec := &protobufReceiver{t: t}
	srv := httptest.NewServer(rec)
	defer srv.Close()
	official, err := otlptracehttp.New(context.Background(), otlptracehttp.WithEndpointURL(srv.URL+"/v1/traces"))
	require.NoError(t, err)
	require.NoError(t, official.ExportSpans(context.Background(), spans))
	require.NoError(t, official.Shutdown(context.Background()))
	require.Len(t, rec.requests, 1)

	var ours collectortrace.ExportTraceServiceRequest
	require.NoError(t, proto.Unmarshal(otlphttp.Marshal(spans), &ours))

	// The one deliberate difference: links carry their trace_state, which
	// otlptracehttp leaves out although OTLP defines it.
	links := ours.GetResourceSpans()[0].GetScopeSpans()[0].GetSpans()[0].GetLinks()
	require.Len(t, links, 1)
	assert.Equal(t, "lw=1,other=two", links[0].GetTraceState())
	links[0].TraceState = ""

	// otlptracehttp collects resources in a map, so their order varies by run.
	sortResources(t, rec.requests[0])
	sortResources(t, &ours)
	if !proto.Equal(rec.requests[0], &ours) {
		want, _ := protojson.Marshal(rec.requests[0])
		got, _ := protojson.Marshal(&ours)
		assert.JSONEq(t, string(want), string(got))
		t.Fatal("encoded request differs from otlptracehttp's")
	}
}

func sortResources(t *testing.T, req *collectortrace.ExportTraceServiceRequest) {
	t.Helper()
	key := func(rs *tracepb.ResourceSpans) string {
		b, err := proto.MarshalOptions{Deterministic: true}.Marshal(rs.GetResource())
		require.NoError(t, err)
		return string(b)
	}
	slices.SortFunc(req.ResourceSpans, func(a, b *tracepb.ResourceSpans) int {
		return strings.Compare(key(a), key(b))
	})
}

func TestDefaultExporterSendsGzippedProtobuf(t *testing.T) {
	rec := &protobufReceiver{t: t}
	srv := httptest.NewServer(rec)
	defer srv.Close()

	exporter, err := langwatch.NewExporter(context.Background(),
		langwatch.WithAPIKey("sk-lw-test"),
		langwatch.WithEndpoint(srv.URL),
	)
	require.NoError(t, err)
	require.NoError(t, exporter.ExportSpans(context.Background(), paritySpans(t)))
	require.NoError(t, exporter.Shutdown(context.Background()))

	require.Len(t, rec.requests, 1)
	assert.Equal(t, "application/x-protobuf", rec.headers[0].Get("Content-Type"))
	assert.Equal(t, "gzip", rec.headers[0].Get("Content-Encoding"))
	assert.Len(t, rec.requests[0].GetResourceSpans(), 2)
}
