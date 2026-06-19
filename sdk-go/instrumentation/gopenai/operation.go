package gopenai

import (
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// genAIOperationFromPath derives the gen_ai.operation.name attribute from a
// go-openai request URL path. OpenAI paths follow /v1/{operation}/...; Azure
// OpenAI paths follow /openai/deployments/{deployment-id}/{operation}.
func genAIOperationFromPath(urlPath string) attribute.KeyValue {
	segments := strings.Split(strings.Trim(urlPath, "/"), "/")

	var operationSegment string
	for i, segment := range segments {
		if segment == "deployments" && i+2 < len(segments) {
			operationSegment = segments[i+2]
			break
		}
	}
	if operationSegment == "" && len(segments) >= 2 && segments[0] == "v1" {
		operationSegment = segments[1]
	}

	switch operationSegment {
	case "chat":
		return semconv.GenAIOperationNameChat
	case "completions":
		return semconv.GenAIOperationNameTextCompletion
	case "embeddings":
		return semconv.GenAIOperationNameEmbeddings
	case "responses":
		return semconv.GenAIOperationNameKey.String("responses")
	case "audio":
		return semconv.GenAIOperationNameKey.String("audio")
	case "images":
		return semconv.GenAIOperationNameKey.String("images")
	default:
		if operationSegment != "" {
			return semconv.GenAIOperationNameKey.String(operationSegment)
		}
		return semconv.GenAIOperationNameChat
	}
}
