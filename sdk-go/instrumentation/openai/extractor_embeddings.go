package openai

import (
	"encoding/json"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	openai "github.com/openai/openai-go/v3"
)

// embeddingsExtractor handles the Embeddings API (/v1/embeddings).
// Discriminators: the request carries `input` together with embeddings-only
// fields (`encoding_format`/`dimensions`) and no messages[]/max_output_tokens;
// the response object is "list" with data[].embedding. Embeddings never stream.
type embeddingsExtractor struct{}

func (embeddingsExtractor) name() string { return "embeddings" }

func (embeddingsExtractor) matchesRequest(body map[string]any, pathHint string) bool {
	if strings.Contains(pathHint, "embeddings") {
		return true
	}
	if _, hasMessages := body["messages"]; hasMessages {
		return false
	}
	if !hasKey(body, "input") {
		return false
	}
	// Embeddings carry encoding_format/dimensions and never the generation-only
	// max_output_tokens; that combination distinguishes them from Responses.
	if hasKey(body, "max_output_tokens") || hasKey(body, "instructions") {
		return false
	}
	return hasKey(body, "encoding_format") || hasKey(body, "dimensions")
}

func (embeddingsExtractor) matchesResponse(objectField, contentType string) bool {
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false
	}
	return objectField == "list"
}

func (embeddingsExtractor) extractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var params openai.EmbeddingNewParams
	if err := json.Unmarshal(raw, &params); err != nil {
		logError("Failed to parse Embeddings request body JSON: %v", err)
		return genericExtractor{}.extractRequest(span, raw, capture)
	}

	span.SetRequestModel(string(params.Model))
	span.SetName("embeddings." + string(params.Model))

	if params.EncodingFormat != "" {
		span.SetAttributes(semconv.GenAIRequestEncodingFormats(string(params.EncodingFormat)))
	}
	if params.Dimensions.Valid() {
		span.SetAttributes(semconv.GenAIEmbeddingsDimensionCount(int(params.Dimensions.Value)))
	}

	if capture.CaptureInput() {
		recordEmbeddingsInput(span, params.Input)
	}

	// Embeddings never stream.
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(false))
	return false
}

func (embeddingsExtractor) extractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp openai.CreateEmbeddingResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		logError("Failed to parse Embeddings response body JSON: %v", err)
		genericExtractor{}.extractNonStreaming(span, raw, capture)
		return
	}

	span.SetResponseModel(resp.Model)

	usage := langwatch.GenAIUsage{}
	if resp.Usage.PromptTokens > 0 {
		usage.InputTokens = langwatch.Int(int(resp.Usage.PromptTokens))
	}
	if resp.Usage.TotalTokens > 0 {
		usage.TotalTokens = langwatch.Int(int(resp.Usage.TotalTokens))
	}
	span.SetGenAIUsage(usage)

	// The embedding vectors themselves are large and rarely useful in a trace;
	// record only their count as the output when output capture is enabled.
	if capture.CaptureOutput() && len(resp.Data) > 0 {
		span.SetAttributes(attribute.Int("gen_ai.response.embeddings_count", len(resp.Data)))
	}
}

func (embeddingsExtractor) newStreamAccumulator() streamAccumulator {
	// Embeddings never stream; this accumulator is therefore never used, but the
	// interface requires it.
	return noopStreamAccumulator{}
}

// recordEmbeddingsInput records the embeddings input (a string or an array of
// strings/tokens) as the span input.
func recordEmbeddingsInput(span *langwatch.Span, input openai.EmbeddingNewParamsInputUnion) {
	if input.OfString.Valid() {
		span.SetInputText(input.OfString.Value)
		return
	}
	if len(input.OfArrayOfStrings) > 0 {
		span.SetInputJSON(input.OfArrayOfStrings)
		return
	}
	if len(input.OfArrayOfTokens) > 0 {
		span.SetInputJSON(input.OfArrayOfTokens)
		return
	}
	if len(input.OfArrayOfTokenArrays) > 0 {
		span.SetInputJSON(input.OfArrayOfTokenArrays)
	}
}

// noopStreamAccumulator is a streamAccumulator that does nothing, for shapes
// that never stream.
type noopStreamAccumulator struct{}

func (noopStreamAccumulator) consume(string)                                    {}
func (noopStreamAccumulator) isTerminal(string) bool                            { return false }
func (noopStreamAccumulator) finish(*langwatch.Span, langwatch.DataCaptureMode) {}
