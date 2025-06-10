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

// getStreamingFlag checks if streaming is enabled in the request data.
func getStreamingFlag(reqData jsonData) bool {
	streamVal, ok := getBool(reqData, "stream")
	return ok && streamVal
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

// setStringAttribute safely sets a string attribute if the value is not empty.
func setStringAttribute(span *langwatch.Span, key, value string) {
	if value != "" {
		span.SetAttributes(attribute.String(key, value))
	}
}
