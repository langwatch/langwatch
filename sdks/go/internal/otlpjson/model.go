package otlpjson

import (
	"encoding/json"
	"math"
	"strconv"
)

// The types below mirror the OTLP/JSON ExportTraceServiceRequest
// (opentelemetry-proto trace/v1, common/v1): lowerCamelCase names, hex trace
// and span ids, 64-bit integers as decimal strings, enums as integers.

type exportRequest struct {
	ResourceSpans []resourceSpans `json:"resourceSpans"`
}

type resourceSpans struct {
	Resource   otlpResource `json:"resource"`
	ScopeSpans []scopeSpans `json:"scopeSpans"`
	SchemaURL  string       `json:"schemaUrl,omitempty"`
}

type otlpResource struct {
	Attributes []keyValue `json:"attributes"`
}

type scopeSpans struct {
	Scope     scope  `json:"scope"`
	Spans     []span `json:"spans"`
	SchemaURL string `json:"schemaUrl,omitempty"`
}

type scope struct {
	Name       string     `json:"name"`
	Version    string     `json:"version,omitempty"`
	Attributes []keyValue `json:"attributes,omitempty"`
}

type span struct {
	TraceID                string     `json:"traceId"`
	SpanID                 string     `json:"spanId"`
	TraceState             string     `json:"traceState,omitempty"`
	ParentSpanID           string     `json:"parentSpanId,omitempty"`
	Flags                  uint32     `json:"flags"`
	Name                   string     `json:"name"`
	Kind                   int        `json:"kind"`
	StartTimeUnixNano      string     `json:"startTimeUnixNano"`
	EndTimeUnixNano        string     `json:"endTimeUnixNano"`
	Attributes             []keyValue `json:"attributes"`
	DroppedAttributesCount uint32     `json:"droppedAttributesCount"`
	Events                 []event    `json:"events"`
	DroppedEventsCount     uint32     `json:"droppedEventsCount"`
	Links                  []link     `json:"links"`
	DroppedLinksCount      uint32     `json:"droppedLinksCount"`
	Status                 status     `json:"status"`
}

type event struct {
	TimeUnixNano           string     `json:"timeUnixNano"`
	Name                   string     `json:"name"`
	Attributes             []keyValue `json:"attributes"`
	DroppedAttributesCount uint32     `json:"droppedAttributesCount"`
}

type link struct {
	TraceID                string     `json:"traceId"`
	SpanID                 string     `json:"spanId"`
	TraceState             string     `json:"traceState,omitempty"`
	Attributes             []keyValue `json:"attributes"`
	DroppedAttributesCount uint32     `json:"droppedAttributesCount"`
	Flags                  uint32     `json:"flags"`
}

type status struct {
	Message string `json:"message,omitempty"`
	Code    int    `json:"code"`
}

type keyValue struct {
	Key   string   `json:"key"`
	Value anyValue `json:"value"`
}

// anyValue is OTLP's AnyValue: at most one field is set. An unset value
// (attribute.EMPTY) encodes as {}.
type anyValue struct {
	StringValue *string     `json:"stringValue,omitempty"`
	BoolValue   *bool       `json:"boolValue,omitempty"`
	IntValue    *string     `json:"intValue,omitempty"`
	DoubleValue *double     `json:"doubleValue,omitempty"`
	ArrayValue  *arrayValue `json:"arrayValue,omitempty"`
}

type arrayValue struct {
	Values []anyValue `json:"values"`
}

// double is a float64 that encodes NaN and the infinities as the strings
// ProtoJSON uses for them, which encoding/json would otherwise refuse.
type double float64

// MarshalJSON implements json.Marshaler.
func (d double) MarshalJSON() ([]byte, error) {
	f := float64(d)
	switch {
	case math.IsNaN(f):
		return []byte(`"NaN"`), nil
	case math.IsInf(f, 1):
		return []byte(`"Infinity"`), nil
	case math.IsInf(f, -1):
		return []byte(`"-Infinity"`), nil
	}
	return json.Marshal(f)
}

// unixNano renders a nanosecond timestamp as OTLP/JSON's decimal string,
// clamping instants before the epoch to zero as the official exporter does.
func unixNano(ns int64) string {
	if ns < 0 {
		ns = 0
	}
	return strconv.FormatInt(ns, 10)
}
