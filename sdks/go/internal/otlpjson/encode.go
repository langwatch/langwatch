// Package otlpjson encodes OpenTelemetry spans as an OTLP/JSON
// ExportTraceServiceRequest and sends them over OTLP/HTTP.
//
// It depends only on the standard library and the OpenTelemetry API and SDK,
// so a program that exports through it links neither gRPC nor the generated
// OTLP protobuf packages.
package otlpjson

import (
	"encoding/base64"
	"encoding/json"
	"math"
	"strconv"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/instrumentation"
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

// Marshal encodes spans as an OTLP/JSON ExportTraceServiceRequest. Spans are
// grouped by resource and then by instrumentation scope, in the order they
// first appear; nil spans are skipped.
func Marshal(spans []sdktrace.ReadOnlySpan) ([]byte, error) {
	return json.Marshal(buildRequest(spans))
}

// buildRequest groups spans into resourceSpans/scopeSpans.
func buildRequest(spans []sdktrace.ReadOnlySpan) exportRequest {
	type scopeKey struct {
		resource attribute.Distinct
		scope    instrumentation.Scope
	}
	// Indexes into req.ResourceSpans and into that entry's ScopeSpans.
	resourceIndex := make(map[attribute.Distinct]int)
	scopeIndex := make(map[scopeKey]int)

	req := exportRequest{ResourceSpans: []resourceSpans{}}
	for _, sd := range spans {
		if sd == nil {
			continue
		}
		res := sd.Resource()
		rKey := res.Equivalent()
		ri, ok := resourceIndex[rKey]
		if !ok {
			ri = len(req.ResourceSpans)
			resourceIndex[rKey] = ri
			req.ResourceSpans = append(req.ResourceSpans, resourceSpans{
				Resource:   otlpResource{Attributes: keyValues(res.Attributes())},
				ScopeSpans: []scopeSpans{},
				SchemaURL:  res.SchemaURL(),
			})
		}
		rs := &req.ResourceSpans[ri]

		is := sd.InstrumentationScope()
		sKey := scopeKey{resource: rKey, scope: is}
		si, ok := scopeIndex[sKey]
		if !ok {
			si = len(rs.ScopeSpans)
			scopeIndex[sKey] = si
			rs.ScopeSpans = append(rs.ScopeSpans, scopeSpans{
				Scope: scope{
					Name:       is.Name,
					Version:    is.Version,
					Attributes: keyValues(is.Attributes.ToSlice()),
				},
				Spans:     []span{},
				SchemaURL: is.SchemaURL,
			})
		}
		ss := &rs.ScopeSpans[si]
		ss.Spans = append(ss.Spans, encodeSpan(sd))
	}
	return req
}

// encodeSpan converts one span, matching the official exporter's mapping.
func encodeSpan(sd sdktrace.ReadOnlySpan) span {
	sc := sd.SpanContext()
	out := span{
		TraceID:                sc.TraceID().String(),
		SpanID:                 sc.SpanID().String(),
		TraceState:             sc.TraceState().String(),
		Flags:                  spanFlags(sc.TraceFlags(), sd.Parent()),
		Name:                   sd.Name(),
		Kind:                   spanKind(sd.SpanKind()),
		StartTimeUnixNano:      unixNano(sd.StartTime().UnixNano()),
		EndTimeUnixNano:        unixNano(sd.EndTime().UnixNano()),
		Attributes:             keyValues(sd.Attributes()),
		DroppedAttributesCount: clampUint32(sd.DroppedAttributes()),
		Events:                 events(sd.Events()),
		DroppedEventsCount:     clampUint32(sd.DroppedEvents()),
		Links:                  links(sd.Links()),
		DroppedLinksCount:      clampUint32(sd.DroppedLinks()),
		Status:                 spanStatus(sd.Status()),
	}
	if parent := sd.Parent().SpanID(); parent.IsValid() {
		out.ParentSpanID = parent.String()
	}
	return out
}

func events(es []sdktrace.Event) []event {
	out := make([]event, len(es))
	for i, e := range es {
		out[i] = event{
			TimeUnixNano:           unixNano(e.Time.UnixNano()),
			Name:                   e.Name,
			Attributes:             keyValues(e.Attributes),
			DroppedAttributesCount: clampUint32(e.DroppedAttributeCount),
		}
	}
	return out
}

func links(ls []sdktrace.Link) []link {
	out := make([]link, len(ls))
	for i, l := range ls {
		out[i] = link{
			TraceID:                l.SpanContext.TraceID().String(),
			SpanID:                 l.SpanContext.SpanID().String(),
			TraceState:             l.SpanContext.TraceState().String(),
			Attributes:             keyValues(l.Attributes),
			DroppedAttributesCount: clampUint32(l.DroppedAttributeCount),
			Flags:                  spanFlags(l.SpanContext.TraceFlags(), l.SpanContext),
		}
	}
	return out
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

func spanKind(kind trace.SpanKind) int {
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

func spanStatus(s sdktrace.Status) status {
	code := statusUnset
	switch s.Code {
	case codes.Ok:
		code = statusOk
	case codes.Error:
		code = statusError
	}
	return status{Code: code, Message: s.Description}
}

func keyValues(kvs []attribute.KeyValue) []keyValue {
	out := make([]keyValue, len(kvs))
	for i, kv := range kvs {
		out[i] = keyValue{Key: string(kv.Key), Value: value(kv.Value)}
	}
	return out
}

// value converts an attribute value to an AnyValue.
//
// Byte slices are sent as a base64 stringValue rather than a bytesValue: the
// LangWatch receiver reads an OTLP/JSON body as plain JSON and accepts
// bytesValue only in its protobuf-decoded shapes, so a spec base64 bytesValue
// would fail validation and drop the span.
func value(v attribute.Value) anyValue {
	switch v.Type() {
	case attribute.BOOL:
		b := v.AsBool()
		return anyValue{BoolValue: &b}
	case attribute.INT64:
		return intValue(v.AsInt64())
	case attribute.FLOAT64:
		d := double(v.AsFloat64())
		return anyValue{DoubleValue: &d}
	case attribute.STRING:
		s := v.AsString()
		return anyValue{StringValue: &s}
	case attribute.BYTESLICE:
		s := base64.StdEncoding.EncodeToString(v.AsByteSlice())
		return anyValue{StringValue: &s}
	case attribute.BOOLSLICE:
		bs := v.AsBoolSlice()
		vals := make([]anyValue, len(bs))
		for i := range bs {
			vals[i] = anyValue{BoolValue: &bs[i]}
		}
		return anyValue{ArrayValue: &arrayValue{Values: vals}}
	case attribute.INT64SLICE:
		is := v.AsInt64Slice()
		vals := make([]anyValue, len(is))
		for i, n := range is {
			vals[i] = intValue(n)
		}
		return anyValue{ArrayValue: &arrayValue{Values: vals}}
	case attribute.FLOAT64SLICE:
		fs := v.AsFloat64Slice()
		vals := make([]anyValue, len(fs))
		for i, f := range fs {
			d := double(f)
			vals[i] = anyValue{DoubleValue: &d}
		}
		return anyValue{ArrayValue: &arrayValue{Values: vals}}
	case attribute.STRINGSLICE:
		ss := v.AsStringSlice()
		vals := make([]anyValue, len(ss))
		for i := range ss {
			vals[i] = anyValue{StringValue: &ss[i]}
		}
		return anyValue{ArrayValue: &arrayValue{Values: vals}}
	case attribute.SLICE:
		items := v.AsSlice()
		vals := make([]anyValue, len(items))
		for i, item := range items {
			vals[i] = value(item)
		}
		return anyValue{ArrayValue: &arrayValue{Values: vals}}
	default:
		return anyValue{}
	}
}

// intValue encodes an int64 as OTLP/JSON's decimal string.
func intValue(n int64) anyValue {
	s := strconv.FormatInt(n, 10)
	return anyValue{IntValue: &s}
}

func clampUint32(v int) uint32 {
	if v < 0 {
		return 0
	}
	if int64(v) > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(v)
}
