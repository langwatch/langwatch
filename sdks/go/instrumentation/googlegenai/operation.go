package googlegenai

import (
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// The Gemini REST API encodes the model and the action in the URL path rather
// than the request body, e.g.
//
//	POST /v1beta/models/gemini-2.5-flash:generateContent
//	POST /v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse
//	POST /v1beta1/projects/p/locations/l/publishers/google/models/gemini-2.5-flash:generateContent  (Vertex)
//
// The final path segment is "{resource}:{action}" where {resource} is the model
// resource (".../models/{model}" or ".../tunedModels/{model}"). operationInfo
// parses the model and action out of that segment so the tracer can record the
// requested model — the request body the extractor sees never carries it.
type operationInfo struct {
	// model is the bare model id (e.g. "gemini-2.5-flash"), without the
	// "models/" resource prefix. Empty when the path is not a model action.
	model string
	// action is the verb after the colon (e.g. "generateContent",
	// "streamGenerateContent", "embedContent"). Empty when absent.
	action string
}

// parseOperation extracts the model and action from a Gemini REST URL path.
func parseOperation(urlPath string) operationInfo {
	// The action is the suffix after the last ':' in the final path segment.
	lastSegment := urlPath
	if i := strings.LastIndexByte(urlPath, '/'); i >= 0 {
		lastSegment = urlPath[i+1:]
	}

	resource := lastSegment
	var action string
	if i := strings.LastIndexByte(lastSegment, ':'); i >= 0 {
		resource = lastSegment[:i]
		action = lastSegment[i+1:]
	}

	// The resource segment for a model action is just the model id, because the
	// "models/" / "tunedModels/" prefix lives in an earlier path segment. Guard
	// against a path that has no model component at all.
	model := resource
	if !pathHasModelResource(urlPath) {
		model = ""
	}

	return operationInfo{model: model, action: action}
}

// pathHasModelResource reports whether the URL path addresses a model resource
// (".../models/..." or ".../tunedModels/...").
func pathHasModelResource(urlPath string) bool {
	return strings.Contains(urlPath, "/models/") ||
		strings.Contains(urlPath, "/tunedModels/")
}

// operationAttrs derives request attributes from the Gemini REST URL path: the
// requested model (gen_ai.request.model) and the operation name
// (gen_ai.operation.name). It is wired as otelhttp.Config.OperationAttrs because
// the Gemini wire body — unlike OpenAI/Anthropic — does not include the model.
func operationAttrs(urlPath string) []attribute.KeyValue {
	op := parseOperation(urlPath)
	var attrs []attribute.KeyValue
	if op.model != "" {
		attrs = append(attrs, semconv.GenAIRequestModelKey.String(op.model))
	}
	if name := operationName(op.action); name != "" {
		attrs = append(attrs, semconv.GenAIOperationNameKey.String(name))
	}
	return attrs
}

// operationName maps a Gemini action verb to a gen_ai.operation.name value. Both
// generateContent and streamGenerateContent map to "generate_content", the
// OTel-semconv operation for Gemini's multimodal content generation.
func operationName(action string) string {
	switch action {
	case "generateContent", "streamGenerateContent":
		return semconv.GenAIOperationNameGenerateContent.Value.AsString()
	case "embedContent", "batchEmbedContents":
		return semconv.GenAIOperationNameEmbeddings.Value.AsString()
	case "countTokens":
		return "count_tokens"
	case "":
		return ""
	default:
		return action
	}
}
