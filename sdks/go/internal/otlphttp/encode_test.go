package otlphttp

import (
	"math"
	"strings"
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

// msg is a decoded protobuf message, read by field number, so assertions
// check the wire rather than the encoder's own code. exporter/otlp checks the
// same bytes against the generated OTLP types.
type msg []field

func decode(t *testing.T, b []byte) msg {
	t.Helper()
	fields, err := readFields(b)
	require.NoError(t, err)
	return msg(fields)
}

func (m msg) all(n int) []field {
	var out []field
	for _, f := range m {
		if f.number == n {
			out = append(out, f)
		}
	}
	return out
}

func (m msg) has(n int) bool { return len(m.all(n)) > 0 }

func (m msg) get(t *testing.T, n int) field {
	t.Helper()
	fs := m.all(n)
	require.Lenf(t, fs, 1, "field %d", n)
	return fs[0]
}

func (m msg) sub(t *testing.T, n, i int) msg {
	t.Helper()
	fs := m.all(n)
	require.Greaterf(t, len(fs), i, "field %d", n)
	return decode(t, fs[i].data)
}

func (m msg) str(t *testing.T, n int) string {
	t.Helper()
	return string(m.get(t, n).data)
}

// attr returns the AnyValue of the KeyValue named key in repeated field n.
func (m msg) attr(t *testing.T, n int, key string) msg {
	t.Helper()
	for i := range m.all(n) {
		kv := m.sub(t, n, i)
		if kv.str(t, 1) == key {
			return kv.sub(t, 2, 0)
		}
	}
	t.Fatalf("attribute %q not found", key)
	return nil
}

func firstSpan(t *testing.T, spans ...sdktrace.ReadOnlySpan) msg {
	t.Helper()
	return decode(t, Marshal(spans)).sub(t, 1, 0).sub(t, 2, 0).sub(t, 2, 0)
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
			attribute.Int64("negative", -2),
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
	rs := decode(t, Marshal([]sdktrace.ReadOnlySpan{richSpan().Snapshot()})).sub(t, 1, 0)
	assert.Equal(t, "svc", rs.sub(t, 1, 0).attr(t, 1, "service.name").str(t, 1))

	ss := rs.sub(t, 2, 0)
	assert.Equal(t, "github.com/langwatch/langwatch/sdks/go", ss.sub(t, 1, 0).str(t, 1))
	assert.Equal(t, "1.2.3", ss.sub(t, 1, 0).str(t, 2))

	sp := ss.sub(t, 2, 0)
	t.Run("ids are raw bytes", func(t *testing.T) {
		assert.Equal(t, testTraceID[:], sp.get(t, 1).data)
		assert.Equal(t, testSpanID[:], sp.get(t, 2).data)
		assert.Equal(t, testParentID[:], sp.get(t, 4).data)
	})
	t.Run("name and timestamps", func(t *testing.T) {
		assert.Equal(t, "llm.chat", sp.str(t, 5))
		assert.Equal(t, uint64(1700000000000000123), sp.get(t, 7).num)
		assert.Equal(t, uint64(1700000001000000123), sp.get(t, 8).num)
	})
	t.Run("kind and status use OTLP's codes", func(t *testing.T) {
		assert.Equal(t, uint64(3), sp.get(t, 6).num, "client")
		status := sp.sub(t, 15, 0)
		assert.Equal(t, uint64(2), status.get(t, 3).num, "OTLP ERROR is 2, unlike codes.Error")
		assert.Equal(t, "boom", status.str(t, 2))
	})
	t.Run("flags carry trace flags and the remote-parent bits", func(t *testing.T) {
		assert.Equal(t, uint64(0x01|0x100|0x200), sp.get(t, 16).num)
	})
	t.Run("attribute values take their AnyValue fields", func(t *testing.T) {
		assert.JSONEq(t, `{"q":"hi"}`, sp.attr(t, 9, "langwatch.input").str(t, 1))
		assert.Equal(t, uint64(1), sp.attr(t, 9, "flag").get(t, 2).num)
		assert.Equal(t, uint64(math.MaxInt64), sp.attr(t, 9, "tokens").get(t, 3).num)
		assert.Equal(t, int64(-2), int64(sp.attr(t, 9, "negative").get(t, 3).num))
		assert.Equal(t, math.Float64bits(0.25), sp.attr(t, 9, "cost").get(t, 4).num)
		assert.True(t, math.IsNaN(math.Float64frombits(sp.attr(t, 9, "nan").get(t, 4).num)))
		assert.Equal(t, "b", sp.attr(t, 9, "tags").sub(t, 5, 0).sub(t, 1, 1).str(t, 1))
		assert.Equal(t, uint64(2), sp.attr(t, 9, "ints").sub(t, 5, 0).sub(t, 1, 1).get(t, 3).num)
	})
	t.Run("events and links are carried", func(t *testing.T) {
		ev := sp.sub(t, 11, 0)
		assert.Equal(t, "evaluation", ev.str(t, 2))
		assert.Equal(t, uint64(1700000000001000123), ev.get(t, 1).num)
		assert.Equal(t, testParentID[:], sp.sub(t, 13, 0).get(t, 2).data)
	})
}

func TestMarshal_RootSpanOmitsParent(t *testing.T) {
	stub := richSpan()
	stub.Parent = trace.SpanContext{}
	sp := firstSpan(t, stub.Snapshot())
	assert.False(t, sp.has(4))
	assert.Equal(t, uint64(0x01|0x100), sp.get(t, 16).num, "a missing parent is not remote")
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

	req := decode(t, Marshal([]sdktrace.ReadOnlySpan{a.Snapshot(), b.Snapshot(), c.Snapshot(), nil, d.Snapshot()}))

	require.Len(t, req.all(1), 2)
	first := req.sub(t, 1, 0)
	require.Len(t, first.all(2), 2, "first resource holds two scopes")
	assert.Len(t, first.sub(t, 2, 0).all(2), 2)
	assert.Equal(t, "other scope", first.sub(t, 2, 1).sub(t, 2, 0).str(t, 5))
	assert.Equal(t, "other resource", req.sub(t, 1, 1).sub(t, 2, 0).sub(t, 2, 0).str(t, 5))
}

func TestMarshal_Empty(t *testing.T) {
	assert.Empty(t, Marshal(nil))
}

func TestMarshal_BytesTravelAsBytesValue(t *testing.T) {
	stub := richSpan()
	stub.Attributes = []attribute.KeyValue{attribute.ByteSlice("blob", []byte{0xff, 0x00})}
	v := firstSpan(t, stub.Snapshot()).attr(t, 9, "blob")
	assert.Equal(t, []byte{0xff, 0x00}, v.get(t, 7).data)
}

func TestMarshal_ZeroValuedAttributesKeepTheirType(t *testing.T) {
	stub := richSpan()
	stub.Attributes = []attribute.KeyValue{
		attribute.Bool("off", false),
		attribute.String("blank", ""),
		attribute.Int64("zero", 0),
		attribute.Float64("nought", 0),
	}
	sp := firstSpan(t, stub.Snapshot())
	assert.True(t, sp.attr(t, 9, "off").has(2), "false is a bool, not unset")
	assert.True(t, sp.attr(t, 9, "blank").has(1), `"" is a string, not unset`)
	assert.True(t, sp.attr(t, 9, "zero").has(3))
	assert.True(t, sp.attr(t, 9, "nought").has(4))
}

func TestMarshal_LongValuesWidenTheirLength(t *testing.T) {
	long := strings.Repeat("x", 70_000) // a three-byte length prefix
	stub := richSpan()
	stub.Attributes = []attribute.KeyValue{attribute.String("langwatch.output", long)}
	sp := firstSpan(t, stub.Snapshot())
	assert.Equal(t, long, sp.attr(t, 9, "langwatch.output").str(t, 1))
	assert.Equal(t, "llm.chat", sp.str(t, 5))
}

func TestAppendRequest_KeepsWhatTheBufferHeld(t *testing.T) {
	spans := []sdktrace.ReadOnlySpan{richSpan().Snapshot()}
	got := AppendRequest([]byte("prefix"), spans)
	assert.Equal(t, append([]byte("prefix"), Marshal(spans)...), got)
}
