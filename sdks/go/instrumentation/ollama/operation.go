package ollama

import (
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
)

// genAIOperationFromPath derives the gen_ai.operation.name attribute from an
// Ollama native request URL path. Ollama paths follow /api/{operation}:
// /api/chat → chat, /api/generate → text_completion, /api/embed and the legacy
// /api/embeddings → embeddings. Anything else — including an empty path — is
// reported as "unknown" rather than guessed at, so a span never claims to be a
// chat it is not.
func genAIOperationFromPath(urlPath string) attribute.KeyValue {
	segments := strings.Split(strings.Trim(urlPath, "/"), "/")

	var operationSegment string
	if len(segments) > 0 && segments[0] == "api" {
		// "/api" and "/api/" carry no operation segment at all; leaving the
		// segment empty reports them as "unknown" rather than as an "api"
		// operation that does not exist.
		if len(segments) >= 2 {
			operationSegment = segments[1]
		}
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
	case "":
		return semconv.GenAIOperationNameKey.String("unknown")
	default:
		return semconv.GenAIOperationNameKey.String(operationSegment)
	}
}
