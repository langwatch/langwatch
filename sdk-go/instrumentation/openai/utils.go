package openai

import (
	"encoding/json"
	"log"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"go.opentelemetry.io/otel/attribute"
)

// jsonData is a type alias for a map of string keys to interface{} values.
type jsonData = map[string]interface{}

// getString safely extracts a string value from a map.
func getString(data jsonData, key string) (string, bool) {
	val, ok := data[key].(string)
	return val, ok
}

// getFloat64 safely extracts a float64 value from a map.
func getFloat64(data jsonData, key string) (float64, bool) {
	val, ok := data[key].(float64)
	return val, ok
}

// getInt safely extracts an int value from a map.
func getInt(data jsonData, key string) (int, bool) {
	val, ok := data[key].(float64) // JSON numbers are often float64
	if ok {
		return int(val), true
	}

	intVal, okInt := data[key].(int)
	return intVal, okInt
}

// getBool safely extracts a bool value from a map.
func getBool(data jsonData, key string) (bool, bool) {
	val, ok := data[key].(bool)
	return val, ok
}

// hasKey reports whether data contains key with a non-nil value.
func hasKey(data jsonData, key string) bool {
	v, ok := data[key]
	return ok && v != nil
}

// getStreamingFlag checks if streaming is enabled in the request data.
func getStreamingFlag(reqData jsonData) bool {
	streamVal, ok := getBool(reqData, "stream")
	return ok && streamVal
}

// parseBody unmarshals raw JSON into a generic map for cheap shape sniffing.
// Returns nil (and false) when the payload is not a JSON object.
func parseBody(raw []byte) (jsonData, bool) {
	var data jsonData
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, false
	}
	return data, true
}

// peekObjectField reads the top-level "object" discriminator off a JSON body
// without fully unmarshalling it. Returns "" if absent or unparseable.
func peekObjectField(raw []byte) string {
	var probe struct {
		Object string `json:"object"`
	}
	if err := json.Unmarshal(raw, &probe); err != nil {
		return ""
	}
	return probe.Object
}

// logError provides consistent error logging across the package.
func logError(format string, args ...interface{}) {
	log.Default().Printf("[openai-instrumentation] "+format, args...)
}

// setJSONAttribute safely marshals data to JSON and sets it as a span attribute.
// If marshaling fails, it logs the error and skips setting the attribute.
// For simple string values, it sets them directly without JSON encoding.
func setJSONAttribute(span *langwatch.Span, key string, data interface{}) {
	if data == nil {
		return
	}

	// If it's already a string, set it directly without JSON encoding
	if str, ok := data.(string); ok {
		span.SetAttributes(attribute.String(key, str))
		return
	}

	jsonBytes, err := json.Marshal(data)
	if err != nil {
		logError("Failed to marshal %s to JSON: %v", key, err)
		return
	}

	span.SetAttributes(attribute.String(key, string(jsonBytes)))
}

// toChatMessages round-trips an arbitrary OpenAI message collection through JSON
// into LangWatch chat messages. Because langwatch.ChatMessage uses the standard
// role/content/tool_calls field names, the provider's wire shape maps cleanly.
// Returns false (so the caller can fall back to a JSON value) if the payload
// cannot be represented as chat messages.
func toChatMessages(messages any) ([]langwatch.ChatMessage, bool) {
	jsonBytes, err := json.Marshal(messages)
	if err != nil {
		logError("Failed to marshal messages to JSON: %v", err)
		return nil, false
	}

	var chatMessages []langwatch.ChatMessage
	if err := json.Unmarshal(jsonBytes, &chatMessages); err != nil {
		logError("Failed to convert messages to chat messages: %v", err)
		return nil, false
	}

	return chatMessages, len(chatMessages) > 0
}
