package otlpreceiver

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"mime"
	"strings"
	"time"

	coltracepb "go.opentelemetry.io/proto/otlp/collector/trace/v1"
	tracepb "go.opentelemetry.io/proto/otlp/trace/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// decodeTraces parses an OTLP trace export in either wire format. Both formats
// are mandatory in practice: opencode's plugin is configured http/protobuf, and
// the OTel JS/browser exporters default to http/json — a receiver that only
// speaks one silently loses half its producers.
//
// When the content type is missing or unrecognised we sniff instead of failing:
// a leading `{` means JSON, anything else protobuf.
func decodeTraces(body []byte, contentType string) (*coltracepb.ExportTraceServiceRequest, error) {
	switch normalizeContentType(contentType, body) {
	case contentTypeJSON:
		return decodeTracesJSON(body)
	default:
		req := &coltracepb.ExportTraceServiceRequest{}
		if err := proto.Unmarshal(body, req); err != nil {
			return nil, fmt.Errorf("unmarshal otlp protobuf: %w", err)
		}
		return req, nil
	}
}

const (
	contentTypeProtobuf = "application/x-protobuf"
	contentTypeJSON     = "application/json"
)

// normalizeContentType collapses the several spellings exporters use down to one
// of our two constants.
func normalizeContentType(contentType string, body []byte) string {
	media := contentType
	if parsed, _, err := mime.ParseMediaType(contentType); err == nil {
		media = parsed
	}
	switch strings.ToLower(strings.TrimSpace(media)) {
	case "application/json", "application/x-json":
		return contentTypeJSON
	case "application/x-protobuf", "application/protobuf", "application/octet-stream":
		return contentTypeProtobuf
	}
	if len(body) > 0 && body[0] == '{' {
		return contentTypeJSON
	}
	return contentTypeProtobuf
}

// decodeTracesJSON parses OTLP/JSON. It cannot hand the bytes straight to
// protojson: OTLP/JSON deviates from the canonical protobuf JSON mapping on
// exactly one point — trace/span ids are HEX strings, where protojson expects
// base64 for a `bytes` field. So we rewrite those ids to base64 first, then let
// protojson do all the rest (oneofs, enums-as-names, uint64-as-string), which is
// a great deal of correctness we have no business reimplementing.
func decodeTracesJSON(body []byte) (*coltracepb.ExportTraceServiceRequest, error) {
	var doc any
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("unmarshal otlp json: %w", err)
	}
	rewriteIDsToBase64(doc)

	normalized, err := json.Marshal(doc)
	if err != nil {
		return nil, fmt.Errorf("remarshal otlp json: %w", err)
	}

	req := &coltracepb.ExportTraceServiceRequest{}
	// DiscardUnknown: producers run ahead of our proto version (new semconv
	// fields, new signals). An unknown field is not a reason to drop a batch.
	if err := (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(normalized, req); err != nil {
		return nil, fmt.Errorf("unmarshal otlp json into proto: %w", err)
	}
	return req, nil
}

// idJSONKeys are the fields carrying hex ids in OTLP/JSON, in both the camelCase
// spelling protojson emits and the snake_case proto field names, since either is
// legal on the wire.
var idJSONKeys = map[string]struct{}{
	"traceId":        {},
	"trace_id":       {},
	"spanId":         {},
	"span_id":        {},
	"parentSpanId":   {},
	"parent_span_id": {},
}

// rewriteIDsToBase64 walks a decoded JSON document in place, converting hex ids
// to the base64 protojson wants. A value that is not a plausible hex id (wrong
// length, non-hex) is left exactly as-is — it is most likely already base64 from
// a producer that followed the protobuf JSON mapping literally, and mangling it
// would be worse than passing it through.
func rewriteIDsToBase64(node any) {
	switch typed := node.(type) {
	case map[string]any:
		for key, value := range typed {
			if _, isID := idJSONKeys[key]; isID {
				if s, ok := value.(string); ok {
					if b64, ok := hexIDToBase64(s); ok {
						typed[key] = b64
					}
					continue
				}
			}
			rewriteIDsToBase64(value)
		}
	case []any:
		for _, item := range typed {
			rewriteIDsToBase64(item)
		}
	}
}

// hexIDToBase64 converts a 16-byte trace id or 8-byte span id from hex to
// base64. The length check is what disambiguates hex from base64 (both use a
// subset of the same alphabet): a hex trace id is 32 chars and a hex span id 16,
// whereas their base64 forms are 24 and 12.
func hexIDToBase64(s string) (string, bool) {
	if len(s) != 32 && len(s) != 16 {
		return "", false
	}
	raw, err := hex.DecodeString(s)
	if err != nil {
		return "", false
	}
	return base64.StdEncoding.EncodeToString(raw), true
}

// eventsFrom flattens an OTLP trace export into correlated Events.
//
// Correlation is resource-first: the manager stamps AttrConversationID /
// AttrTurnID onto the worker's RESOURCE, so that is where they normally live. We
// fall back to the span's own attributes for producers that tag per-span
// instead. A span with no conversation id anywhere is skipped — it was still
// forwarded upstream, we simply have no turn to fan it onto.
func eventsFrom(req *coltracepb.ExportTraceServiceRequest, strip bool) []Event {
	if req == nil {
		return nil
	}
	var events []Event

	for _, rs := range req.GetResourceSpans() {
		resourceAttrs := flattenAttributes(rs.GetResource().GetAttributes(), strip)
		resourceConversation := stringAttr(resourceAttrs, AttrConversationID)
		resourceTurn := stringAttr(resourceAttrs, AttrTurnID)

		for _, ss := range rs.GetScopeSpans() {
			for _, span := range ss.GetSpans() {
				spanAttrs := flattenAttributes(span.GetAttributes(), strip)

				conversationID := resourceConversation
				if conversationID == "" {
					conversationID = stringAttr(spanAttrs, AttrConversationID)
				}
				if conversationID == "" {
					continue
				}
				turnID := resourceTurn
				if turnID == "" {
					turnID = stringAttr(spanAttrs, AttrTurnID)
				}

				events = append(events, eventFrom(span, conversationID, turnID,
					mergeAttributes(resourceAttrs, spanAttrs), strip))
			}
		}
	}
	return events
}

func eventFrom(span *tracepb.Span, conversationID, turnID string, attrs map[string]any, strip bool) Event {
	start := unixNano(span.GetStartTimeUnixNano())
	end := unixNano(span.GetEndTimeUnixNano())

	var durationMS float64
	if !start.IsZero() && !end.IsZero() {
		durationMS = float64(end.Sub(start).Nanoseconds()) / float64(time.Millisecond)
	}

	return Event{
		ConversationID: conversationID,
		TurnID:         turnID,
		TraceID:        hex.EncodeToString(span.GetTraceId()),
		SpanID:         hex.EncodeToString(span.GetSpanId()),
		ParentSpanID:   hex.EncodeToString(span.GetParentSpanId()),
		Name:           span.GetName(),
		Kind:           classify(span.GetName(), attrs),
		SpanKind:       spanKindName(span.GetKind()),
		StartTime:      start,
		EndTime:        end,
		DurationMS:     durationMS,
		Status:         statusFrom(span.GetStatus()),
		Attributes:     attrs,
		Events:         spanEventsFrom(span.GetEvents(), strip),
	}
}

func spanEventsFrom(in []*tracepb.Span_Event, strip bool) []SpanEvent {
	if len(in) == 0 {
		return nil
	}
	out := make([]SpanEvent, 0, len(in))
	for _, e := range in {
		out = append(out, SpanEvent{
			Name:       e.GetName(),
			Time:       unixNano(e.GetTimeUnixNano()),
			Attributes: flattenAttributes(e.GetAttributes(), strip),
		})
	}
	return out
}

func statusFrom(status *tracepb.Status) Status {
	switch status.GetCode() {
	case tracepb.Status_STATUS_CODE_OK:
		return Status{Code: StatusOK, Message: status.GetMessage()}
	case tracepb.Status_STATUS_CODE_ERROR:
		return Status{Code: StatusError, Message: status.GetMessage()}
	default:
		return Status{Code: StatusUnset, Message: status.GetMessage()}
	}
}

// spanKindName lower-cases OTel's SPAN_KIND_CLIENT into "client". Unspecified
// becomes "" so it drops out of the JSON entirely.
func spanKindName(kind tracepb.Span_SpanKind) string {
	if kind == tracepb.Span_SPAN_KIND_UNSPECIFIED {
		return ""
	}
	return strings.ToLower(strings.TrimPrefix(kind.String(), "SPAN_KIND_"))
}

func unixNano(ns uint64) time.Time {
	if ns == 0 {
		return time.Time{}
	}
	return time.Unix(0, int64(ns)).UTC()
}
