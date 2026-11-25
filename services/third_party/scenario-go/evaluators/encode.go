package evaluators

import (
	"bytes"
	"encoding/json"
	"reflect"

	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	scenario "github.com/langwatch/scenario/go"
	"github.com/langwatch/scenario/go/internal/jsjson"
	"github.com/langwatch/scenario/go/internal/jsstr"
)

// InputMaxChars is the largest inputs value an evaluation result carries,
// in UTF-16 code units like the JS SDK.
const InputMaxChars = 2000

// IsNothing reports whether a mapping value says "found nothing": nil, a nil
// pointer, map or slice, or an empty list.
func IsNothing(v any) bool {
	switch x := v.(type) {
	case nil:
		return true
	case string, bool, float64, int, jsjson.Object:
		return false
	case []any:
		return len(x) == 0
	case []string:
		return len(x) == 0
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Pointer, reflect.Interface, reflect.Map, reflect.Func, reflect.Chan:
		return rv.IsNil()
	case reflect.Slice:
		return rv.Len() == 0
	case reflect.Array:
		return rv.Len() == 0
	}
	return false
}

// normalizeNumber widens Go numbers to float64, the only number jsjson
// writes.
func normalizeNumber(v any) any {
	switch x := v.(type) {
	case int:
		return float64(x)
	case int8:
		return float64(x)
	case int16:
		return float64(x)
	case int32:
		return float64(x)
	case int64:
		return float64(x)
	case uint:
		return float64(x)
	case uint8:
		return float64(x)
	case uint16:
		return float64(x)
	case uint32:
		return float64(x)
	case uint64:
		return float64(x)
	case float32:
		return float64(x)
	}
	return v
}

// appendJSON appends v as JSON.stringify writes it. Values of the shapes the
// state views return (strings, numbers, decoded JSON, messages, spans) are
// written directly; anything else goes through encoding/json.
func appendJSON(b []byte, v any) []byte {
	switch x := normalizeNumber(v).(type) {
	case nil, bool, float64, string, []string, jsjson.Object, jsjson.Raw:
		return jsjson.Append(b, x)
	case []any:
		b = append(b, '[')
		for i, e := range x {
			if i > 0 {
				b = append(b, ',')
			}
			b = appendJSON(b, e)
		}
		return append(b, ']')
	case scenario.Message:
		return scenario.AppendMessageJSON(b, x)
	case []scenario.Message:
		b = append(b, '[')
		for i, m := range x {
			if i > 0 {
				b = append(b, ',')
			}
			b = scenario.AppendMessageJSON(b, m)
		}
		return append(b, ']')
	case sdktrace.ReadOnlySpan:
		return appendSpan(b, x)
	case []sdktrace.ReadOnlySpan:
		b = append(b, '[')
		for i, s := range x {
			if i > 0 {
				b = append(b, ',')
			}
			b = appendSpan(b, s)
		}
		return append(b, ']')
	case map[string]any:
		return appendJSONMarshal(b, x)
	}
	return appendJSONMarshal(b, v)
}

func appendJSONMarshal(b []byte, v any) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return append(b, "null"...)
	}
	return append(b, bytes.TrimRight(buf.Bytes(), "\n")...)
}

// appendSpan writes the fields of a span an evaluator can read: name, ids,
// times in epoch milliseconds, status and attributes.
func appendSpan(b []byte, s sdktrace.ReadOnlySpan) []byte {
	sc := s.SpanContext()
	b = append(b, `{"name":`...)
	b = jsjson.AppendString(b, s.Name())
	b = append(b, `,"traceId":`...)
	b = jsjson.AppendString(b, sc.TraceID().String())
	b = append(b, `,"spanId":`...)
	b = jsjson.AppendString(b, sc.SpanID().String())
	if p := s.Parent(); p.SpanID().IsValid() {
		b = append(b, `,"parentSpanId":`...)
		b = jsjson.AppendString(b, p.SpanID().String())
	}
	b = append(b, `,"startTime":`...)
	b = jsjson.AppendNumber(b, float64(s.StartTime().UnixNano())/1e6)
	b = append(b, `,"endTime":`...)
	b = jsjson.AppendNumber(b, float64(s.EndTime().UnixNano())/1e6)
	b = append(b, `,"status":{"code":`...)
	b = jsjson.AppendNumber(b, float64(s.Status().Code))
	if d := s.Status().Description; d != "" {
		b = append(b, `,"message":`...)
		b = jsjson.AppendString(b, d)
	}
	b = append(b, `},"attributes":{`...)
	for i, kv := range s.Attributes() {
		if i > 0 {
			b = append(b, ',')
		}
		b = jsjson.AppendString(b, string(kv.Key))
		b = append(b, ':')
		b = appendJSON(b, kv.Value.AsInterface())
	}
	return append(b, "}}"...)
}

// stringify is the inputs form of a value: "" for nil, a string as it is,
// anything else as JSON.
func stringify(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	}
	return string(appendJSON(nil, v))
}

func truncate(s string) string {
	if len(s) <= InputMaxChars || jsstr.Len(s) <= InputMaxChars {
		return s
	}
	return jsstr.Prefix(s, InputMaxChars)
}
