package otlpjson

import (
	"bytes"
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

var (
	testTraceID  = trace.TraceID{0x0a, 0x0b, 0x0c, 0x0d, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}
	testSpanID   = trace.SpanID{1, 2, 3, 4, 5, 6, 7, 8}
	testParentID = trace.SpanID{8, 7, 6, 5, 4, 3, 2, 1}
)

// decoded is the OTLP/JSON request as a generic tree, so assertions read
// the wire shape rather than the encoder's own types.
type decoded = map[string]any

func marshalAndDecode(t *testing.T, spans ...sdktrace.ReadOnlySpan) decoded {
	t.Helper()
	raw, err := Marshal(spans)
	require.NoError(t, err)
	var out decoded
	require.NoError(t, json.Unmarshal(raw, &out))
	return out
}

func path(t *testing.T, v any, keys ...any) any {
	t.Helper()
	for _, k := range keys {
		switch key := k.(type) {
		case string:
			m, ok := v.(map[string]any)
			require.Truef(t, ok, "expected an object at %q", key)
			v = m[key]
		case int:
			s, ok := v.([]any)
			require.Truef(t, ok, "expected an array at index %d", key)
			require.Greater(t, len(s), key)
			v = s[key]
		}
	}
	return v
}

func attr(t *testing.T, attrs any, key string) map[string]any {
	t.Helper()
	for _, kv := range attrs.([]any) {
		m := kv.(map[string]any)
		if m["key"] == key {
			return m["value"].(map[string]any)
		}
	}
	t.Fatalf("attribute %q not found", key)
	return nil
}

func richSpan() tracetest.SpanStub {
	start := time.Unix(1_700_000_000, 123)
	return tracetest.SpanStub{
		Name: "llm.chat",
		SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
			TraceID:    testTraceID,
			SpanID:     testSpanID,
			TraceFlags: trace.FlagsSampled,
		}),
		Parent: trace.NewSpanContext(trace.SpanContextConfig{
			TraceID: testTraceID,
			SpanID:  testParentID,
			Remote:  true,
		}),
		SpanKind:  trace.SpanKindClient,
		StartTime: start,
		EndTime:   start.Add(time.Second),
		Attributes: []attribute.KeyValue{
			attribute.String("langwatch.input", `{"q":"hi"}`),
			attribute.Bool("flag", true),
			attribute.Int64("tokens", math.MaxInt64),
			attribute.Float64("cost", 0.25),
			attribute.Float64("nan", math.NaN()),
			attribute.StringSlice("tags", []string{"a", "b"}),
			attribute.Int64Slice("ints", []int64{1, 2}),
		},
		Events: []sdktrace.Event{{
			Name:       "evaluation",
			Time:       start.Add(time.Millisecond),
			Attributes: []attribute.KeyValue{attribute.String("score", "1")},
		}},
		Links: []sdktrace.Link{{
			SpanContext: trace.NewSpanContext(trace.SpanContextConfig{
				TraceID: testTraceID,
				SpanID:  testParentID,
			}),
		}},
		Status:               sdktrace.Status{Code: codes.Error, Description: "boom"},
		InstrumentationScope: instrumentation.Scope{Name: "github.com/langwatch/langwatch/sdks/go", Version: "1.2.3"},
		Resource:             resource.NewSchemaless(attribute.String("service.name", "svc")),
	}
}

func TestMarshal_SpanFields(t *testing.T) {
	req := marshalAndDecode(t, richSpan().Snapshot())

	rs := path(t, req, "resourceSpans", 0)
	assert.Equal(t, "svc", attr(t, path(t, rs, "resource", "attributes"), "service.name")["stringValue"])

	ss := path(t, rs, "scopeSpans", 0)
	assert.Equal(t, "github.com/langwatch/langwatch/sdks/go", path(t, ss, "scope", "name"))
	assert.Equal(t, "1.2.3", path(t, ss, "scope", "version"))

	sp := path(t, ss, "spans", 0).(map[string]any)
	t.Run("ids are lower-case hex", func(t *testing.T) {
		assert.Equal(t, testTraceID.String(), sp["traceId"])
		assert.Equal(t, testSpanID.String(), sp["spanId"])
		assert.Equal(t, testParentID.String(), sp["parentSpanId"])
	})
	t.Run("timestamps are decimal strings", func(t *testing.T) {
		assert.Equal(t, "1700000000000000123", sp["startTimeUnixNano"])
		assert.Equal(t, "1700000001000000123", sp["endTimeUnixNano"])
	})
	t.Run("kind and status use OTLP's integer codes", func(t *testing.T) {
		assert.EqualValues(t, 3, sp["kind"], "client")
		assert.EqualValues(t, 2, path(t, sp, "status", "code"), "OTLP ERROR is 2, unlike codes.Error")
		assert.Equal(t, "boom", path(t, sp, "status", "message"))
	})
	t.Run("flags carry trace flags and the remote-parent bits", func(t *testing.T) {
		assert.EqualValues(t, 0x01|0x100|0x200, sp["flags"])
	})
	t.Run("attribute values take their OTLP/JSON shapes", func(t *testing.T) {
		attrs := sp["attributes"]
		assert.Equal(t, `{"q":"hi"}`, attr(t, attrs, "langwatch.input")["stringValue"])
		assert.Equal(t, true, attr(t, attrs, "flag")["boolValue"])
		assert.Equal(t, "9223372036854775807", attr(t, attrs, "tokens")["intValue"], "int64 travels as a string")
		assert.Equal(t, 0.25, attr(t, attrs, "cost")["doubleValue"])
		assert.Equal(t, "NaN", attr(t, attrs, "nan")["doubleValue"])
		assert.Equal(t, "b", path(t, attr(t, attrs, "tags"), "arrayValue", "values", 1, "stringValue"))
		assert.Equal(t, "2", path(t, attr(t, attrs, "ints"), "arrayValue", "values", 1, "intValue"))
	})
	t.Run("events and links are carried", func(t *testing.T) {
		assert.Equal(t, "evaluation", path(t, sp, "events", 0, "name"))
		assert.Equal(t, "1700000000001000123", path(t, sp, "events", 0, "timeUnixNano"))
		assert.Equal(t, testParentID.String(), path(t, sp, "links", 0, "spanId"))
	})
}

func TestMarshal_RootSpanOmitsParent(t *testing.T) {
	stub := richSpan()
	stub.Parent = trace.SpanContext{}
	sp := path(t, marshalAndDecode(t, stub.Snapshot()), "resourceSpans", 0, "scopeSpans", 0, "spans", 0).(map[string]any)
	_, has := sp["parentSpanId"]
	assert.False(t, has)
	assert.EqualValues(t, 0x01|0x100, sp["flags"], "a missing parent is not remote")
}

func TestMarshal_GroupsByResourceAndScope(t *testing.T) {
	a := richSpan()
	b := richSpan()
	b.Name = "same scope"
	c := richSpan()
	c.Name = "other scope"
	c.InstrumentationScope = instrumentation.Scope{Name: "other"}
	d := richSpan()
	d.Name = "other resource"
	d.Resource = resource.NewSchemaless(attribute.String("service.name", "other"))

	req := marshalAndDecode(t, a.Snapshot(), b.Snapshot(), c.Snapshot(), nil, d.Snapshot())

	resources := path(t, req, "resourceSpans").([]any)
	require.Len(t, resources, 2)
	scopes := path(t, resources[0], "scopeSpans").([]any)
	require.Len(t, scopes, 2, "first resource holds two scopes")
	assert.Len(t, path(t, scopes[0], "spans"), 2)
	assert.Equal(t, "other scope", path(t, scopes[1], "spans", 0, "name"))
	assert.Equal(t, "other resource", path(t, resources[1], "scopeSpans", 0, "spans", 0, "name"))
}

func TestMarshal_Empty(t *testing.T) {
	raw, err := Marshal(nil)
	require.NoError(t, err)
	assert.JSONEq(t, `{"resourceSpans":[]}`, string(raw))
}

func TestMarshal_BytesTravelAsBase64String(t *testing.T) {
	stub := richSpan()
	stub.Attributes = []attribute.KeyValue{attribute.ByteSlice("blob", []byte{0xff, 0x00})}
	sp := path(t, marshalAndDecode(t, stub.Snapshot()), "resourceSpans", 0, "scopeSpans", 0, "spans", 0)
	v := attr(t, path(t, sp, "attributes"), "blob")
	assert.Equal(t, "/wA=", v["stringValue"])
	_, has := v["bytesValue"]
	assert.False(t, has)
}

func TestEncode_WritesWhatMarshalReturns(t *testing.T) {
	spans := []sdktrace.ReadOnlySpan{richSpan().Snapshot()}
	want, err := Marshal(spans)
	require.NoError(t, err)

	var buf bytes.Buffer
	require.NoError(t, Encode(&buf, spans))
	assert.Equal(t, string(want)+"\n", buf.String())
}
