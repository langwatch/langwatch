package openaiformat

import (
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// GenAIOperationFromPath derives the gen_ai.operation.name attribute from an
// OpenAI-compatible request URL path. OpenAI paths follow /v1/{operation}/...;
// Azure OpenAI paths follow /openai/deployments/{deployment-id}/{operation}.
//
// Both the openai and gopenai instrumentations route their OperationAttrs hook
// through this single mapper so the operation attribute is identical across
// clients.
func GenAIOperationFromPath(urlPath string) attribute.KeyValue {
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

// OperationAttrs derives the request operation attributes from the URL path. It
// is the otelhttp Config.OperationAttrs hook both OpenAI-format instrumentations
// install.
func OperationAttrs(urlPath string) []attribute.KeyValue {
	return []attribute.KeyValue{GenAIOperationFromPath(urlPath)}
}
