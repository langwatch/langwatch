// Package otlphttp encodes OpenTelemetry spans as an OTLP/protobuf
// ExportTraceServiceRequest and sends them over OTLP/HTTP. The protobuf is
// written by hand from the opentelemetry-proto field numbers, so the package
// depends only on the standard library and the OpenTelemetry API and SDK, and
// links neither gRPC nor the generated OTLP protobuf packages.
package otlphttp

import (
	"encoding/binary"
	"math"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/instrumentation"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// OTLP span flag bits (opentelemetry-proto trace/v1 SpanFlags).
const (
	flagContextHasIsRemote uint32 = 0x100
	flagContextIsRemote    uint32 = 0x200
)

// OTLP status codes. They differ from codes.Code, where Error is 1 and Ok 2.
const (
	statusUnset = 0
	statusOk    = 1
	statusError = 2
)

// Marshal encodes spans as an OTLP/protobuf ExportTraceServiceRequest.
func Marshal(spans []sdktrace.ReadOnlySpan) []byte {
	return AppendRequest(nil, spans)
}

// AppendRequest appends the request for spans to b. Spans are grouped by
// resource and then by instrumentation scope, in the order they first appear;
// nil spans are skipped.
func AppendRequest(b []byte, spans []sdktrace.ReadOnlySpan) []byte {
	for _, rg := range group(spans) {
		b = appendMessage(b, 1, func(b []byte) []byte { return appendResourceSpans(b, rg) })
	}
	return b
}

type resourceGroup struct {
	resource *resource.Resource
	scopes   []scopeGroup
}

type scopeGroup struct {
	scope instrumentation.Scope
	spans []sdktrace.ReadOnlySpan
}

func group(spans []sdktrace.ReadOnlySpan) []resourceGroup {
	type scopeKey struct {
		resource attribute.Distinct
		scope    instrumentation.Scope
	}
	resourceIndex := make(map[attribute.Distinct]int)
	scopeIndex := make(map[scopeKey]int)

	var out []resourceGroup
	for _, sd := range spans {
		if sd == nil {
			continue
		}
		res := sd.Resource()
		rKey := res.Equivalent()
		ri, ok := resourceIndex[rKey]
		if !ok {
			ri = len(out)
			resourceIndex[rKey] = ri
			out = append(out, resourceGroup{resource: res})
		}
		rg := &out[ri]

		sKey := scopeKey{resource: rKey, scope: sd.InstrumentationScope()}
		si, ok := scopeIndex[sKey]
		if !ok {
			si = len(rg.scopes)
			scopeIndex[sKey] = si
			rg.scopes = append(rg.scopes, scopeGroup{scope: sKey.scope})
		}
		rg.scopes[si].spans = append(rg.scopes[si].spans, sd)
	}
	return out
}

// ResourceSpans: 1 resource (Resource: 1 attributes), 2 scope_spans, 3 schema_url.
func appendResourceSpans(b []byte, rg resourceGroup) []byte {
	b = appendMessage(b, 1, func(b []byte) []byte { return appendKeyValues(b, 1, rg.resource.Attributes()) })
	for _, sg := range rg.scopes {
		b = appendMessage(b, 2, func(b []byte) []byte { return appendScopeSpans(b, sg) })
	}
	return appendStringField(b, 3, rg.resource.SchemaURL())
}

// ScopeSpans: 1 scope, 2 spans, 3 schema_url.
func appendScopeSpans(b []byte, sg scopeGroup) []byte {
	b = appendMessage(b, 1, func(b []byte) []byte { return appendScope(b, sg.scope) })
	for _, sd := range sg.spans {
		b = appendMessage(b, 2, func(b []byte) []byte { return appendSpan(b, sd) })
	}
	return appendStringField(b, 3, sg.scope.SchemaURL)
}

// InstrumentationScope: 1 name, 2 version, 3 attributes.
func appendScope(b []byte, s instrumentation.Scope) []byte {
	b = appendStringField(b, 1, s.Name)
	b = appendStringField(b, 2, s.Version)
	return appendKeyValues(b, 3, s.Attributes.ToSlice())
}

// appendSpan writes a Span, matching the official exporter's mapping: 1
// trace_id, 2 span_id, 3 trace_state, 4 parent_span_id, 5 name, 6 kind, 7/8
// start/end time, 9-14 attributes, events, links and their dropped counts, 15
// status, 16 flags.
func appendSpan(b []byte, sd sdktrace.ReadOnlySpan) []byte {
	sc := sd.SpanContext()
	traceID, spanID := sc.TraceID(), sc.SpanID()
	b = appendBytesField(b, 1, traceID[:])
	b = appendBytesField(b, 2, spanID[:])
	b = appendStringField(b, 3, sc.TraceState().String())
	if parent := sd.Parent().SpanID(); parent.IsValid() {
		b = appendBytesField(b, 4, parent[:])
	}
	b = appendStringField(b, 5, sd.Name())
	b = appendVarintField(b, 6, spanKind(sd.SpanKind()))
	b = appendFixed64Field(b, 7, unixNano(sd.StartTime().UnixNano()))
	b = appendFixed64Field(b, 8, unixNano(sd.EndTime().UnixNano()))
	b = appendKeyValues(b, 9, sd.Attributes())
	b = appendVarintField(b, 10, clampUint32(sd.DroppedAttributes()))
	for _, e := range sd.Events() {
		b = appendMessage(b, 11, func(b []byte) []byte { return appendEvent(b, e) })
	}
	b = appendVarintField(b, 12, clampUint32(sd.DroppedEvents()))
	for _, l := range sd.Links() {
		b = appendMessage(b, 13, func(b []byte) []byte { return appendLink(b, l) })
	}
	b = appendVarintField(b, 14, clampUint32(sd.DroppedLinks()))
	b = appendMessage(b, 15, func(b []byte) []byte { return appendStatus(b, sd.Status()) })
	return appendFixed32Field(b, 16, spanFlags(sc.TraceFlags(), sd.Parent()))
}

// Event: 1 time_unix_nano, 2 name, 3 attributes, 4 dropped_attributes_count.
func appendEvent(b []byte, e sdktrace.Event) []byte {
	b = appendFixed64Field(b, 1, unixNano(e.Time.UnixNano()))
	b = appendStringField(b, 2, e.Name)
	b = appendKeyValues(b, 3, e.Attributes)
	return appendVarintField(b, 4, clampUint32(e.DroppedAttributeCount))
}

// Link: 1 trace_id, 2 span_id, 3 trace_state, 4 attributes, 5
// dropped_attributes_count, 6 flags.
func appendLink(b []byte, l sdktrace.Link) []byte {
	traceID, spanID := l.SpanContext.TraceID(), l.SpanContext.SpanID()
	b = appendBytesField(b, 1, traceID[:])
	b = appendBytesField(b, 2, spanID[:])
	b = appendStringField(b, 3, l.SpanContext.TraceState().String())
	b = appendKeyValues(b, 4, l.Attributes)
	b = appendVarintField(b, 5, clampUint32(l.DroppedAttributeCount))
	return appendFixed32Field(b, 6, spanFlags(l.SpanContext.TraceFlags(), l.SpanContext))
}

// Status: 2 message, 3 code.
func appendStatus(b []byte, s sdktrace.Status) []byte {
	b = appendStringField(b, 2, s.Description)
	return appendVarintField(b, 3, statusCode(s.Code))
}

// appendKeyValues writes each KeyValue (1 key, 2 value) as field num.
func appendKeyValues(b []byte, num int, kvs []attribute.KeyValue) []byte {
	for _, kv := range kvs {
		b = appendMessage(b, num, func(b []byte) []byte {
			b = appendStringField(b, 1, string(kv.Key))
			return appendMessage(b, 2, func(b []byte) []byte { return appendAnyValue(b, kv.Value) })
		})
	}
	return b
}

// appendAnyValue writes the AnyValue oneof: 1 string, 2 bool, 3 int, 4
// double, 5 array, 7 bytes. A oneof member is written even when it holds its
// zero value, so the receiver can tell false or "" from unset.
func appendAnyValue(b []byte, v attribute.Value) []byte {
	switch v.Type() {
	case attribute.STRING:
		return appendOneofString(b, 1, v.AsString())
	case attribute.BOOL:
		var n uint64
		if v.AsBool() {
			n = 1
		}
		return appendOneofVarint(b, 2, n)
	case attribute.INT64:
		return appendOneofVarint(b, 3, uint64(v.AsInt64()))
	case attribute.FLOAT64:
		return appendOneofDouble(b, 4, v.AsFloat64())
	case attribute.BYTESLICE:
		return appendOneofString(b, 7, string(v.AsByteSlice()))
	case attribute.BOOLSLICE:
		return appendArray(b, v.AsBoolSlice(), attribute.BoolValue)
	case attribute.INT64SLICE:
		return appendArray(b, v.AsInt64Slice(), attribute.Int64Value)
	case attribute.FLOAT64SLICE:
		return appendArray(b, v.AsFloat64Slice(), attribute.Float64Value)
	case attribute.STRINGSLICE:
		return appendArray(b, v.AsStringSlice(), attribute.StringValue)
	case attribute.SLICE:
		return appendArray(b, v.AsSlice(), func(v attribute.Value) attribute.Value { return v })
	default:
		return b
	}
}

// appendArray writes AnyValue field 5, an ArrayValue (1 values) of items.
func appendArray[T any](b []byte, items []T, conv func(T) attribute.Value) []byte {
	return appendMessage(b, 5, func(b []byte) []byte {
		for _, item := range items {
			b = appendMessage(b, 1, func(b []byte) []byte { return appendAnyValue(b, conv(item)) })
		}
		return b
	})
}

func appendOneofString(b []byte, num int, v string) []byte {
	b = binary.AppendUvarint(appendTag(b, num, wireBytes), uint64(len(v)))
	return append(b, v...)
}

func appendOneofVarint(b []byte, num int, v uint64) []byte {
	return binary.AppendUvarint(appendTag(b, num, wireVarint), v)
}

func appendOneofDouble(b []byte, num int, v float64) []byte {
	return binary.LittleEndian.AppendUint64(appendTag(b, num, wireFixed64), math.Float64bits(v))
}

// spanFlags carries the W3C trace flags in the low byte and records whether
// the parent (or linked) context was remote.
func spanFlags(tf trace.TraceFlags, parent trace.SpanContext) uint32 {
	flags := uint32(tf) | flagContextHasIsRemote
	if parent.IsRemote() {
		flags |= flagContextIsRemote
	}
	return flags
}

func spanKind(kind trace.SpanKind) uint64 {
	switch kind {
	case trace.SpanKindInternal:
		return 1
	case trace.SpanKindServer:
		return 2
	case trace.SpanKindClient:
		return 3
	case trace.SpanKindProducer:
		return 4
	case trace.SpanKindConsumer:
		return 5
	default:
		return 0
	}
}

func statusCode(c codes.Code) uint64 {
	switch c {
	case codes.Ok:
		return statusOk
	case codes.Error:
		return statusError
	default:
		return statusUnset
	}
}

// unixNano clamps instants before the epoch to zero, as the official
// exporter does.
func unixNano(ns int64) uint64 {
	if ns < 0 {
		return 0
	}
	return uint64(ns)
}

func clampUint32(v int) uint64 {
	if v < 0 {
		return 0
	}
	if int64(v) > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint64(v)
}
