package otlpreceiver

import (
	"testing"

	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
	resourcepb "go.opentelemetry.io/proto/otlp/resource/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/proto"
)

// attrs builds an OTLP attribute list from string pairs — the only shape the
// correlation and classification tests care about.
func attrs(pairs ...string) []*commonpb.KeyValue {
	if len(pairs)%2 != 0 {
		panic("attrs: odd number of arguments")
	}
	out := make([]*commonpb.KeyValue, 0, len(pairs)/2)
	for i := 0; i < len(pairs); i += 2 {
		out = append(out, &commonpb.KeyValue{
			Key:   pairs[i],
			Value: &commonpb.AnyValue{Value: &commonpb.AnyValue_StringValue{StringValue: pairs[i+1]}},
		})
	}
	return out
}

func traceRequest(resourceAttrs []*commonpb.KeyValue, spans ...*tracepb.Span) *coltracepb.ExportTraceServiceRequest {
	return &coltracepb.ExportTraceServiceRequest{
		ResourceSpans: []*tracepb.ResourceSpans{{
			Resource:   &resourcepb.Resource{Attributes: resourceAttrs},
			ScopeSpans: []*tracepb.ScopeSpans{{Spans: spans}},
		}},
	}
}

func span(name string, spanAttrs []*commonpb.KeyValue) *tracepb.Span {
	return &tracepb.Span{
		TraceId:           []byte{0x5b, 0x8e, 0xff, 0xf7, 0x98, 0x03, 0x81, 0x03, 0xd2, 0x69, 0xb6, 0x33, 0x81, 0x3f, 0xc6, 0x0c},
		SpanId:            []byte{0xee, 0xe1, 0x9b, 0x7e, 0xc3, 0xc1, 0xb1, 0x74},
		Name:              name,
		Kind:              tracepb.Span_SPAN_KIND_CLIENT,
		StartTimeUnixNano: 1_700_000_000_000_000_000,
		EndTimeUnixNano:   1_700_000_001_500_000_000,
		Attributes:        spanAttrs,
		Status:            &tracepb.Status{Code: tracepb.Status_STATUS_CODE_OK},
	}
}

// otlpJSON is a realistic OTLP/JSON export: hex ids (NOT base64 — the one place
// OTLP/JSON departs from the protobuf JSON mapping), camelCase keys, numeric
// enums, uint64-as-string.
const otlpJSON = `{
  "resourceSpans": [{
    "resource": {
      "attributes": [
        {"key": "langy.conversation_id", "value": {"stringValue": "conv-json"}},
        {"key": "service.name", "value": {"stringValue": "langyagent"}}
      ]
    },
    "scopeSpans": [{
      "spans": [{
        "traceId": "5b8efff798038103d269b633813fc60c",
        "spanId": "eee19b7ec3c1b174",
        "parentSpanId": "1112131415161718",
        "name": "chat gpt-5-mini",
        "kind": 3,
        "startTimeUnixNano": "1700000000000000000",
        "endTimeUnixNano": "1700000001500000000",
        "attributes": [
          {"key": "gen_ai.request.model", "value": {"stringValue": "gpt-5-mini"}},
          {"key": "gen_ai.usage.input_tokens", "value": {"intValue": "120"}}
        ],
        "status": {"code": 2, "message": "rate limited"}
      }]
    }]
  }]
}`

func TestDecodeTraces(t *testing.T) {
	protoBody, err := proto.Marshal(traceRequest(
		attrs(AttrConversationID, "conv-proto"),
		span("chat gpt-5-mini", attrs("gen_ai.request.model", "gpt-5-mini")),
	))
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}

	tests := []struct {
		name           string
		body           []byte
		contentType    string
		wantEvents     int
		wantConvID     string
		wantTraceID    string
		wantSpanID     string
		wantKind       Kind
		wantSpanKind   string
		wantStatusCode StatusCode
	}{
		{
			name:           "protobuf payload",
			body:           protoBody,
			contentType:    "application/x-protobuf",
			wantEvents:     1,
			wantConvID:     "conv-proto",
			wantTraceID:    "5b8efff798038103d269b633813fc60c",
			wantSpanID:     "eee19b7ec3c1b174",
			wantKind:       KindLLM,
			wantSpanKind:   "client",
			wantStatusCode: StatusOK,
		},
		{
			name:           "json payload with hex ids",
			body:           []byte(otlpJSON),
			contentType:    "application/json",
			wantEvents:     1,
			wantConvID:     "conv-json",
			wantTraceID:    "5b8efff798038103d269b633813fc60c",
			wantSpanID:     "eee19b7ec3c1b174",
			wantKind:       KindLLM,
			wantSpanKind:   "client",
			wantStatusCode: StatusError,
		},
		{
			name:           "json payload sniffed without a content type",
			body:           []byte(otlpJSON),
			contentType:    "",
			wantEvents:     1,
			wantConvID:     "conv-json",
			wantTraceID:    "5b8efff798038103d269b633813fc60c",
			wantSpanID:     "eee19b7ec3c1b174",
			wantKind:       KindLLM,
			wantSpanKind:   "client",
			wantStatusCode: StatusError,
		},
		{
			name:           "protobuf payload with charset parameter on the content type",
			body:           protoBody,
			contentType:    "application/x-protobuf; charset=utf-8",
			wantEvents:     1,
			wantConvID:     "conv-proto",
			wantTraceID:    "5b8efff798038103d269b633813fc60c",
			wantSpanID:     "eee19b7ec3c1b174",
			wantKind:       KindLLM,
			wantSpanKind:   "client",
			wantStatusCode: StatusOK,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req, err := decodeTraces(tc.body, tc.contentType)
			if err != nil {
				t.Fatalf("decodeTraces: %v", err)
			}
			events := eventsFrom(req, false)
			if len(events) != tc.wantEvents {
				t.Fatalf("got %d events, want %d", len(events), tc.wantEvents)
			}
			got := events[0]
			if got.ConversationID != tc.wantConvID {
				t.Errorf("conversationId = %q, want %q", got.ConversationID, tc.wantConvID)
			}
			if got.TraceID != tc.wantTraceID {
				t.Errorf("traceId = %q, want %q", got.TraceID, tc.wantTraceID)
			}
			if got.SpanID != tc.wantSpanID {
				t.Errorf("spanId = %q, want %q", got.SpanID, tc.wantSpanID)
			}
			if got.Kind != tc.wantKind {
				t.Errorf("kind = %q, want %q", got.Kind, tc.wantKind)
			}
			if got.SpanKind != tc.wantSpanKind {
				t.Errorf("spanKind = %q, want %q", got.SpanKind, tc.wantSpanKind)
			}
			if got.Status.Code != tc.wantStatusCode {
				t.Errorf("status = %q, want %q", got.Status.Code, tc.wantStatusCode)
			}
			if got.DurationMS != 1500 {
				t.Errorf("durationMs = %v, want 1500", got.DurationMS)
			}
		})
	}
}

// TestDecodeTracesJSONSnakeCase pins the other legal OTLP/JSON spelling: proto
// field names rather than protojson's camelCase.
func TestDecodeTracesJSONSnakeCase(t *testing.T) {
	body := `{"resource_spans":[{"resource":{"attributes":[
		{"key":"langy.conversation_id","value":{"stringValue":"conv-snake"}}]},
		"scope_spans":[{"spans":[{
			"trace_id":"5b8efff798038103d269b633813fc60c",
			"span_id":"eee19b7ec3c1b174",
			"name":"tool.read",
			"start_time_unix_nano":"1700000000000000000",
			"end_time_unix_nano":"1700000000500000000"
		}]}]}]}`

	req, err := decodeTraces([]byte(body), "application/json")
	if err != nil {
		t.Fatalf("decodeTraces: %v", err)
	}
	events := eventsFrom(req, false)
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if events[0].ConversationID != "conv-snake" {
		t.Errorf("conversationId = %q, want conv-snake", events[0].ConversationID)
	}
	if events[0].TraceID != "5b8efff798038103d269b633813fc60c" {
		t.Errorf("traceId = %q, want the hex id", events[0].TraceID)
	}
}

func TestDecodeTracesRejectsGarbage(t *testing.T) {
	if _, err := decodeTraces([]byte("{not json"), "application/json"); err == nil {
		t.Fatal("expected an error decoding malformed json")
	}
}

func TestEventsFromCorrelation(t *testing.T) {
	tests := []struct {
		name          string
		resourceAttrs []*commonpb.KeyValue
		spanAttrs     []*commonpb.KeyValue
		wantEvents    int
		wantConvID    string
		wantTurnID    string
	}{
		{
			name:          "conversation id on the resource is the normal case",
			resourceAttrs: attrs(AttrConversationID, "conv-1"),
			spanAttrs:     attrs("gen_ai.request.model", "gpt-5-mini"),
			wantEvents:    1,
			wantConvID:    "conv-1",
			wantTurnID:    "",
		},
		{
			name:          "turn id is passed through when a producer sets it",
			resourceAttrs: attrs(AttrConversationID, "conv-1", AttrTurnID, "turn-9"),
			wantEvents:    1,
			wantConvID:    "conv-1",
			wantTurnID:    "turn-9",
		},
		{
			name:       "span attributes are the fallback when the resource is untagged",
			spanAttrs:  attrs(AttrConversationID, "conv-2", AttrTurnID, "turn-2"),
			wantEvents: 1,
			wantConvID: "conv-2",
			wantTurnID: "turn-2",
		},
		{
			name:          "resource wins over the span on conflict",
			resourceAttrs: attrs(AttrConversationID, "conv-resource"),
			spanAttrs:     attrs(AttrConversationID, "conv-span"),
			wantEvents:    1,
			wantConvID:    "conv-resource",
		},
		{
			name:          "no conversation id anywhere never reaches the sink",
			resourceAttrs: attrs("service.name", "langyagent"),
			spanAttrs:     attrs("gen_ai.request.model", "gpt-5-mini"),
			wantEvents:    0,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			events := eventsFrom(traceRequest(tc.resourceAttrs, span("chat", tc.spanAttrs)), false)
			if len(events) != tc.wantEvents {
				t.Fatalf("got %d events, want %d", len(events), tc.wantEvents)
			}
			if tc.wantEvents == 0 {
				return
			}
			if events[0].ConversationID != tc.wantConvID {
				t.Errorf("conversationId = %q, want %q", events[0].ConversationID, tc.wantConvID)
			}
			if events[0].TurnID != tc.wantTurnID {
				t.Errorf("turnId = %q, want %q", events[0].TurnID, tc.wantTurnID)
			}
		})
	}
}

func TestEventsFromMergesResourceAttributesUnderSpanAttributes(t *testing.T) {
	events := eventsFrom(traceRequest(
		attrs(AttrConversationID, "conv-1", "service.name", "langyagent"),
		span("chat", attrs("gen_ai.request.model", "gpt-5-mini")),
	), false)
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}

	got := events[0].Attributes
	for key, want := range map[string]string{
		"service.name":         "langyagent",
		"gen_ai.request.model": "gpt-5-mini",
		AttrConversationID:     "conv-1",
	} {
		if got[key] != want {
			t.Errorf("attributes[%q] = %v, want %q", key, got[key], want)
		}
	}
}

// TestEventsFromLangwatchCLISpan is the forward-looking case: a `langwatch` CLI
// span carries langwatch.* attributes and progress span-events, and must land in
// the same Event with no special-casing at all.
func TestEventsFromLangwatchCLISpan(t *testing.T) {
	s := span("langwatch traces list", attrs("langwatch.resource", "traces", "langwatch.verb", "list"))
	s.Events = []*tracepb.Span_Event{{
		Name:         "progress",
		TimeUnixNano: 1_700_000_000_500_000_000,
		Attributes:   attrs("langwatch.progress.message", "fetching page 2"),
	}}

	events := eventsFrom(traceRequest(attrs(AttrConversationID, "conv-cli"), s), false)
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	got := events[0]
	if got.Kind != KindOther {
		t.Errorf("kind = %q, want %q (no bespoke taxonomy for CLI spans)", got.Kind, KindOther)
	}
	if got.Attributes["langwatch.verb"] != "list" {
		t.Errorf("langwatch.verb = %v, want list", got.Attributes["langwatch.verb"])
	}
	if len(got.Events) != 1 || got.Events[0].Name != "progress" {
		t.Fatalf("span events = %+v, want one progress event", got.Events)
	}
	if got.Events[0].Attributes["langwatch.progress.message"] != "fetching page 2" {
		t.Errorf("progress attributes = %v, want the message", got.Events[0].Attributes)
	}
}
