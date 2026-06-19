// Package otelhttp is the shared base for LangWatch's HTTP-level GenAI
// instrumentations. It traces an LLM HTTP call — as either an OpenAI/Anthropic
// Stainless option.Middleware (via Config.Handle) or an injected
// http.RoundTripper (via Config.RoundTripper) — passing request and response
// bodies *through* to the caller while capturing a bounded copy off the
// critical path for attribute extraction.
//
// Provider packages (openai-compatible, anthropic, gemini, …) supply a set of
// Extractors that read the provider's wire shapes and record gen_ai.* / langwatch.*
// attributes via the LangWatch span helpers. The base owns the span lifecycle,
// the byte-exact body pass-through, the SSE streaming reconstruction and the
// shape-based dispatch; the providers own only the per-shape attribute mapping.
package otelhttp

import (
	"encoding/json"
	"log"

	"go.opentelemetry.io/otel/attribute"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// JSONObject is a decoded JSON object used for cheap shape sniffing.
type JSONObject = map[string]any

// logf logs an instrumentation diagnostic. Instrumentation must never fail the
// caller's request, so problems are logged and swallowed.
func logf(format string, args ...any) {
	log.Default().Printf("[langwatch-otelhttp] "+format, args...)
}

// ParseBody unmarshals raw JSON into a generic object for shape sniffing.
// Returns nil, false when the payload is not a JSON object.
func ParseBody(raw []byte) (JSONObject, bool) {
	var data JSONObject
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, false
	}
	return data, true
}

// PeekObjectField reads the top-level "object" discriminator off a JSON body
// without fully decoding it. Returns "" if absent or unparseable.
func PeekObjectField(raw []byte) string {
	var probe struct {
		Object string `json:"object"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return ""
	}
	return probe.Object
}

// HasKey reports whether data contains key with a non-nil value.
func HasKey(data JSONObject, key string) bool {
	v, ok := data[key]
	return ok && v != nil
}

// GetString safely extracts a string field.
func GetString(data JSONObject, key string) (string, bool) {
	v, ok := data[key].(string)
	return v, ok
}

// GetBool safely extracts a bool field.
func GetBool(data JSONObject, key string) (bool, bool) {
	v, ok := data[key].(bool)
	return v, ok
}

// GetInt safely extracts an integer field (JSON numbers decode as float64).
func GetInt(data JSONObject, key string) (int, bool) {
	if v, ok := data[key].(float64); ok {
		return int(v), true
	}
	v, ok := data[key].(int)
	return v, ok
}

// GetFloat64 safely extracts a float field.
func GetFloat64(data JSONObject, key string) (float64, bool) {
	v, ok := data[key].(float64)
	return v, ok
}

// RequestStreams reports whether a request body asked for a streamed response
// (a top-level "stream": true).
func RequestStreams(raw []byte) bool {
	body, ok := ParseBody(raw)
	if !ok {
		return false
	}
	v, ok := GetBool(body, "stream")
	return ok && v
}

// SetJSONAttribute marshals data to JSON and records it as a string attribute,
// passing strings through unencoded. Marshalling failures are logged and skipped.
func SetJSONAttribute(span *langwatch.Span, key string, data any) {
	if data == nil {
		return
	}
	if str, ok := data.(string); ok {
		span.SetAttributes(attribute.String(key, str))
		return
	}
	jsonBytes, err := json.Marshal(data)
	if err != nil {
		logf("failed to marshal %s to JSON: %v", key, err)
		return
	}
	span.SetAttributes(attribute.String(key, string(jsonBytes)))
}

// ToChatMessages round-trips an arbitrary provider message collection through
// JSON into LangWatch chat messages. Because langwatch.ChatMessage uses the
// standard role/content/tool_calls field names, most providers' wire shapes map
// cleanly. Returns false when the payload cannot be represented as chat messages
// so the caller can fall back to a JSON value.
func ToChatMessages(messages any) ([]langwatch.ChatMessage, bool) {
	jsonBytes, err := json.Marshal(messages)
	if err != nil {
		return nil, false
	}
	var chatMessages []langwatch.ChatMessage
	if err := json.Unmarshal(jsonBytes, &chatMessages); err != nil {
		return nil, false
	}
	return chatMessages, len(chatMessages) > 0
}
