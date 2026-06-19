package ollama

import (
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// genAIOperationFromPath derives the gen_ai.operation.name attribute from an
// Ollama native request URL path. Ollama paths follow /api/{operation}:
// /api/chat → chat, /api/generate → text_completion, /api/embed and the legacy
// /api/embeddings → embeddings.
func genAIOperationFromPath(urlPath string) attribute.KeyValue {
	segments := strings.Split(strings.Trim(urlPath, "/"), "/")

	var operationSegment string
	if len(segments) >= 2 && segments[0] == "api" {
		operationSegment = segments[1]
	} else if len(segments) > 0 {
		operationSegment = segments[len(segments)-1]
	}

	switch operationSegment {
	case "chat":
		return semconv.GenAIOperationNameChat
	case "generate":
		return semconv.GenAIOperationNameTextCompletion
	case "embed", "embeddings":
		return semconv.GenAIOperationNameEmbeddings
	default:
		if operationSegment != "" {
			return semconv.GenAIOperationNameKey.String(operationSegment)
		}
		return semconv.GenAIOperationNameChat
	}
}
