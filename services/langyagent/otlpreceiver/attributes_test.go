package otlpreceiver

import (
	"reflect"
	"testing"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
)

func TestFlattenAttributesContentStripping(t *testing.T) {
	kvs := attrs(
		"gen_ai.request.model", "gpt-5-mini",
		"gen_ai.input.messages", `[{"role":"user","content":"my secrets"}]`,
		"gen_ai.output.messages", `[{"role":"assistant","content":"reply"}]`,
		"gen_ai.prompt", "raw prompt",
		"gen_ai.completion", "raw completion",
	)

	tests := []struct {
		name        string
		strip       bool
		wantPresent []string
		wantAbsent  []string
	}{
		{
			name:        "strip off keeps content",
			strip:       false,
			wantPresent: append([]string{"gen_ai.request.model"}, StrippedContentKeys...),
		},
		{
			name:        "strip on drops every content key and keeps behavioural signal",
			strip:       true,
			wantPresent: []string{"gen_ai.request.model"},
			wantAbsent:  StrippedContentKeys,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := flattenAttributes(kvs, tc.strip)
			for _, key := range tc.wantPresent {
				if _, ok := got[key]; !ok {
					t.Errorf("attribute %q missing, want present", key)
				}
			}
			for _, key := range tc.wantAbsent {
				if _, ok := got[key]; ok {
					t.Errorf("attribute %q present, want stripped", key)
				}
			}
		})
	}
}

// TestEventsFromStripsContentFromSpanEvents pins that stripping reaches span
// EVENTS too — content hidden in an event attribute is still content.
func TestEventsFromStripsContentFromSpanEvents(t *testing.T) {
	s := span("chat", attrs("gen_ai.prompt", "secret", "gen_ai.request.model", "gpt-5-mini"))
	s.Events = []*tracepb.Span_Event{{
		Name:         "gen_ai.content",
		TimeUnixNano: 1_700_000_000_500_000_000,
		Attributes:   attrs("gen_ai.completion", "secret reply", "gen_ai.system", "openai"),
	}}

	events := eventsFrom(traceRequest(attrs(AttrConversationID, "conv-1"), s), true)
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if _, ok := events[0].Attributes["gen_ai.prompt"]; ok {
		t.Error("gen_ai.prompt survived stripping on the span")
	}
	if _, ok := events[0].Events[0].Attributes["gen_ai.completion"]; ok {
		t.Error("gen_ai.completion survived stripping on the span event")
	}
	if events[0].Events[0].Attributes["gen_ai.system"] != "openai" {
		t.Error("stripping removed non-content signal from the span event")
	}
}

func TestAnyValue(t *testing.T) {
	tests := []struct {
		name  string
		value *commonpb.AnyValue
		want  any
	}{
		{name: "nil", value: nil, want: nil},
		{
			name:  "string",
			value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: "gpt-5-mini"}},
			want:  "gpt-5-mini",
		},
		{
			name:  "int",
			value: &commonpb.AnyValue{Value: &commonpb.AnyValue_IntValue{IntValue: 120}},
			want:  int64(120),
		},
		{
			name:  "double",
			value: &commonpb.AnyValue{Value: &commonpb.AnyValue_DoubleValue{DoubleValue: 1.5}},
			want:  1.5,
		},
		{
			name:  "bool",
			value: &commonpb.AnyValue{Value: &commonpb.AnyValue_BoolValue{BoolValue: true}},
			want:  true,
		},
		{
			name: "array",
			value: &commonpb.AnyValue{Value: &commonpb.AnyValue_ArrayValue{
				ArrayValue: &commonpb.ArrayValue{Values: []*commonpb.AnyValue{
					{Value: &commonpb.AnyValue_StringValue{StringValue: "read"}},
					{Value: &commonpb.AnyValue_StringValue{StringValue: "bash"}},
				}},
			}},
			want: []any{"read", "bash"},
		},
		{
			name: "kvlist",
			value: &commonpb.AnyValue{Value: &commonpb.AnyValue_KvlistValue{
				KvlistValue: &commonpb.KeyValueList{Values: attrs("role", "user")},
			}},
			want: map[string]any{"role": "user"},
		},
		{
			name:  "bytes become base64",
			value: &commonpb.AnyValue{Value: &commonpb.AnyValue_BytesValue{BytesValue: []byte{0x01, 0x02}}},
			want:  "AQI=",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := anyValue(tc.value); !reflect.DeepEqual(got, tc.want) {
				t.Errorf("anyValue() = %#v, want %#v", got, tc.want)
			}
		})
	}
}
