package gopenai

import (
	"encoding/json"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// embeddingsExtractor handles the Embeddings API (/v1/embeddings).
// Discriminators: the request carries `input` together with embeddings-only
// fields (`encoding_format`/`dimensions`) and no messages[]; the response object
// is "list" with data[].embedding. Embeddings never stream.
type embeddingsExtractor struct{}

func (embeddingsExtractor) Name() string { return "embeddings" }

func (embeddingsExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
	if strings.Contains(pathHint, "embeddings") {
		return true
	}
	if _, hasMessages := body["messages"]; hasMessages {
		return false
	}
	if !otelhttp.HasKey(body, "input") {
		return false
	}
	// Embeddings carry encoding_format/dimensions; that distinguishes them from a
	// legacy completions request that also lacks messages.
	return otelhttp.HasKey(body, "encoding_format") || otelhttp.HasKey(body, "dimensions")
}

func (embeddingsExtractor) MatchesResponse(objectField, contentType string) bool {
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false
	}
	return objectField == "list"
}

// embeddingsRequest is the subset of an OpenAI embeddings request we read.
type embeddingsRequest struct {
	Model          string          `json:"model"`
	Input          json.RawMessage `json:"input"`
	EncodingFormat string          `json:"encoding_format"`
	Dimensions     *int            `json:"dimensions"`
}

func (embeddingsExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var req embeddingsRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return genericExtractor{}.ExtractRequest(span, raw, capture)
	}

	if req.Model != "" {
		span.SetRequestModel(req.Model)
		span.SetName("embeddings." + req.Model)
	}

	if req.EncodingFormat != "" {
		span.SetAttributes(semconv.GenAIRequestEncodingFormats(req.EncodingFormat))
	}
	if req.Dimensions != nil {
		span.SetAttributes(semconv.GenAIEmbeddingsDimensionCount(*req.Dimensions))
	}

	if capture.CaptureInput() && len(req.Input) > 0 {
		recordEmbeddingsInput(span, req.Input)
	}

	// Embeddings never stream.
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(false))
	return false
}

// embeddingsResponse is the subset of an OpenAI embeddings response we read.
type embeddingsResponse struct {
	Model string `json:"model"`
	Data  []struct {
		Index int `json:"index"`
	} `json:"data"`
	Usage *usagePayload `json:"usage"`
}

func (embeddingsExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp embeddingsResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		genericExtractor{}.ExtractNonStreaming(span, raw, capture)
		return
	}

	if resp.Model != "" {
		span.SetResponseModel(resp.Model)
	}

	// Embeddings report prompt_tokens and total_tokens (no completion tokens).
	recordUsage(span, resp.Usage)

	// The embedding vectors themselves are large and rarely useful in a trace;
	// record only their count as the output when output capture is enabled.
	if capture.CaptureOutput() && len(resp.Data) > 0 {
		span.SetAttributes(attribute.Int("gen_ai.response.embeddings_count", len(resp.Data)))
	}
}

func (embeddingsExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	// Embeddings never stream; this accumulator is therefore never used, but the
	// interface requires it.
	return otelhttp.NoopAccumulator{}
}

// recordEmbeddingsInput records the embeddings input (a string or an array of
// strings/tokens) as the span input. A bare string becomes input text; any
// array form is recorded as JSON.
func recordEmbeddingsInput(span *langwatch.Span, raw json.RawMessage) {
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		span.SetInputText(single)
		return
	}
	var arr any
	if err := json.Unmarshal(raw, &arr); err == nil {
		span.SetInputJSON(arr)
	}
}
