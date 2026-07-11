package otlpreceiver

import (
	"encoding/base64"

	commonpb "go.opentelemetry.io/proto/otlp/common/v1"
)

// StrippedContentKeys are the message-content attributes removed from events
// handed to the Sink when Options.StripContent is set. Same list, same reasoning
// as langytracebridge: structural/behavioural signal (span shape, tool names,
// model, token counts, latency, status) is what drives the UI and what we are
// willing to hold; the customer's actual conversation body is not something to
// pass around by default.
//
// It applies to the SINK path only. Upstream forwarding is the customer's own
// project receiving their own content — nothing is stripped there.
var StrippedContentKeys = []string{
	"gen_ai.input.messages",
	"gen_ai.output.messages",
	"gen_ai.prompt",
	"gen_ai.completion",
}

var strippedContentKeySet = func() map[string]struct{} {
	set := make(map[string]struct{}, len(StrippedContentKeys))
	for _, k := range StrippedContentKeys {
		set[k] = struct{}{}
	}
	return set
}()

// flattenAttributes turns an OTLP KeyValue list into a plain Go map, dropping
// content keys when strip is set. Returns nil for an empty result so the Event
// marshals without an empty object.
func flattenAttributes(kvs []*commonpb.KeyValue, strip bool) map[string]any {
	if len(kvs) == 0 {
		return nil
	}
	out := make(map[string]any, len(kvs))
	for _, kv := range kvs {
		if kv == nil || kv.GetKey() == "" {
			continue
		}
		if strip {
			if _, drop := strippedContentKeySet[kv.GetKey()]; drop {
				continue
			}
		}
		out[kv.GetKey()] = anyValue(kv.GetValue())
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// mergeAttributes overlays span attributes onto resource attributes. The span
// wins on conflict — it is the more specific statement about that span.
func mergeAttributes(resource, span map[string]any) map[string]any {
	if len(resource) == 0 {
		return span
	}
	if len(span) == 0 {
		return resource
	}
	out := make(map[string]any, len(resource)+len(span))
	for k, v := range resource {
		out[k] = v
	}
	for k, v := range span {
		out[k] = v
	}
	return out
}

// anyValue converts an OTLP AnyValue into its natural Go/JSON shape. Bytes
// become base64 (they have no other honest JSON representation); an unset or
// unknown variant becomes nil rather than an error — a value we cannot read is
// not a reason to drop the span it hangs off.
func anyValue(v *commonpb.AnyValue) any {
	if v == nil {
		return nil
	}
	switch val := v.GetValue().(type) {
	case *commonpb.AnyValue_StringValue:
		return val.StringValue
	case *commonpb.AnyValue_BoolValue:
		return val.BoolValue
	case *commonpb.AnyValue_IntValue:
		return val.IntValue
	case *commonpb.AnyValue_DoubleValue:
		return val.DoubleValue
	case *commonpb.AnyValue_BytesValue:
		return base64.StdEncoding.EncodeToString(val.BytesValue)
	case *commonpb.AnyValue_ArrayValue:
		items := val.ArrayValue.GetValues()
		out := make([]any, 0, len(items))
		for _, item := range items {
			out = append(out, anyValue(item))
		}
		return out
	case *commonpb.AnyValue_KvlistValue:
		entries := val.KvlistValue.GetValues()
		out := make(map[string]any, len(entries))
		for _, kv := range entries {
			out[kv.GetKey()] = anyValue(kv.GetValue())
		}
		return out
	default:
		return nil
	}
}

// stringAttr reads a string attribute, tolerating its absence.
func stringAttr(attrs map[string]any, key string) string {
	s, _ := attrs[key].(string)
	return s
}
