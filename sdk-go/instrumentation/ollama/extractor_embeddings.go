package ollama

import (
	"encoding/json"
	"strings"

	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// embeddingsExtractor handles Ollama's native embeddings endpoints: the current
// /api/embed (request input + dimensions, response model + embeddings[][] +
// prompt_eval_count) and the legacy /api/embeddings (request prompt, response a
// bare embedding[]). Embeddings never stream.
type embeddingsExtractor struct{}

func (embeddingsExtractor) Name() string { return "embeddings" }

func (embeddingsExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
	if strings.Contains(pathHint, "/api/embed") {
		// Matches both /api/embed and /api/embeddings.
		return true
	}
	if _, hasMessages := body["messages"]; hasMessages {
		return false
	}
	// /api/embed carries input; the legacy /api/embeddings carries prompt — but a
	// top-level prompt is also the generate shape, so prompt alone is left to the
	// generate extractor and only the input form is claimed here by shape.
	return otelhttp.HasKey(body, "input")
}

func (embeddingsExtractor) MatchesResponse(objectField, contentType string) bool {
	return false
}

// embeddingsRequest is the subset of an Ollama embeddings request we read. Both
// the new input form and the legacy prompt form are accepted.
type embeddingsRequest struct {
	Model      string          `json:"model"`
	Input      json.RawMessage `json:"input"`
	Prompt     string          `json:"prompt"`
	Dimensions *int            `json:"dimensions"`
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
	if req.Dimensions != nil {
		span.SetAttributes(semconv.GenAIEmbeddingsDimensionCount(*req.Dimensions))
	}

	if capture.CaptureInput() {
		recordEmbeddingsInput(span, req)
	}

	// Embeddings never stream.
	return false
}

// embeddingsResponse is the subset of an Ollama embeddings response we read.
// /api/embed returns model + embeddings[][] + prompt_eval_count; the legacy
// /api/embeddings returns only a bare embedding[].
type embeddingsResponse struct {
	Model           string      `json:"model"`
	Embeddings      [][]float32 `json:"embeddings"`
	Embedding       []float64   `json:"embedding"`
	PromptEvalCount int         `json:"prompt_eval_count"`
	TotalDuration   int64       `json:"total_duration"`
	LoadDuration    int64       `json:"load_duration"`
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

	// /api/embed reports prompt_eval_count (input tokens); embeddings have no
	// output tokens. The legacy /api/embeddings reports no usage at all.
	recordUsage(span, metricsPayload{
		PromptEvalCount: resp.PromptEvalCount,
		TotalDuration:   resp.TotalDuration,
		LoadDuration:    resp.LoadDuration,
	})

	// The embedding vectors are large and rarely useful in a trace; record only
	// their count as the output when output capture is enabled.
	if capture.CaptureOutput() {
		if count := embeddingsCount(resp); count > 0 {
			span.SetAttributes(langwatch.AttributeGenAIResponseEmbeddingsCount.Int(count))
		}
	}
}

func (embeddingsExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	// Embeddings never stream; the interface still requires an accumulator.
	return otelhttp.NoopAccumulator{}
}

// embeddingsCount returns the number of embedding vectors in either response
// shape (the /api/embed batch or the legacy single /api/embeddings vector).
func embeddingsCount(resp embeddingsResponse) int {
	if len(resp.Embeddings) > 0 {
		return len(resp.Embeddings)
	}
	if len(resp.Embedding) > 0 {
		return 1
	}
	return 0
}

// recordEmbeddingsInput records the embeddings input as the span input: a bare
// string (or the legacy prompt) becomes input text; an array form is recorded as
// JSON.
func recordEmbeddingsInput(span *langwatch.Span, req embeddingsRequest) {
	if len(req.Input) > 0 {
		var single string
		if err := json.Unmarshal(req.Input, &single); err == nil {
			span.SetInputText(single)
			return
		}
		var arr any
		if err := json.Unmarshal(req.Input, &arr); err == nil {
			span.SetInputJSON(arr)
			return
		}
	}
	if req.Prompt != "" {
		span.SetInputText(req.Prompt)
	}
}
