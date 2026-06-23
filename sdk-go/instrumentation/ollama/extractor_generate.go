package ollama

import (
	"encoding/json"
	"strings"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// generateExtractor handles Ollama's native text-completion endpoint
// (/api/generate). The request carries a top-level prompt (and no messages[]);
// the response carries the generated text under "response".
type generateExtractor struct{}

func (generateExtractor) Name() string { return "generate" }

func (generateExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
	if strings.Contains(pathHint, "/api/generate") {
		return true
	}
	// The legacy /api/embeddings request also carries a top-level prompt, so it
	// must be left to the embeddings extractor.
	if strings.Contains(pathHint, "/api/embed") {
		return false
	}
	if _, hasMessages := body["messages"]; hasMessages {
		return false
	}
	return otelhttp.HasKey(body, "prompt")
}

func (generateExtractor) MatchesResponse(objectField, contentType string) bool {
	// Ollama responses carry no "object" discriminator; non-streaming generate
	// dispatch is decided from the request shape.
	return false
}

// generateRequest is the subset of an Ollama /api/generate request we read.
type generateRequest struct {
	Model   string          `json:"model"`
	Prompt  string          `json:"prompt"`
	System  string          `json:"system"`
	Suffix  string          `json:"suffix"`
	Format  json.RawMessage `json:"format"`
	Options optionsParams   `json:"options"`
	Stream  *bool           `json:"stream"`
}

func (generateExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var req generateRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return genericExtractor{}.ExtractRequest(span, raw, capture)
	}

	if req.Model != "" {
		span.SetRequestModel(req.Model)
		span.SetName("text_completion." + req.Model)
	}

	span.SetGenAIRequestParams(req.Options.toGenAIRequestParams())
	recordFormat(span, req.Format)

	if capture.CaptureInput() && req.Prompt != "" {
		span.SetInputText(req.Prompt)
	}

	return streamRequested(req.Stream)
}

// generateResponse is the subset of an Ollama /api/generate response we read.
type generateResponse struct {
	Model      string            `json:"model"`
	Response   string            `json:"response"`
	Thinking   string            `json:"thinking"`
	DoneReason string            `json:"done_reason"`
	ToolCalls  []json.RawMessage `json:"tool_calls"`
	metricsPayload
}

func (generateExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp generateResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		genericExtractor{}.ExtractNonStreaming(span, raw, capture)
		return
	}

	if resp.Model != "" {
		span.SetResponseModel(resp.Model)
	}
	if resp.DoneReason != "" {
		span.SetGenAIResponseFinishReasons(resp.DoneReason)
	}

	recordUsage(span, resp.metricsPayload)

	if capture.CaptureOutput() {
		recordGenerateOutput(span, resp.Response, resp.ToolCalls)
	}
}

func (generateExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &generateStreamAccumulator{}
}

// recordGenerateOutput records the generate response output: the text response,
// or — when the model emitted tool calls — an assistant chat message carrying
// them structurally alongside any text.
func recordGenerateOutput(span *langwatch.Span, response string, toolCalls []json.RawMessage) {
	if calls := decodeToolCalls(toolCalls); len(calls) > 0 {
		msg := langwatch.ChatMessage{Role: langwatch.ChatRoleAssistant, ToolCalls: calls}
		if response != "" {
			msg.Content = response
		}
		span.SetGenAIOutputMessages([]langwatch.ChatMessage{msg})
		return
	}
	if response != "" {
		span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, response)})
	}
}

// generateStreamAccumulator reconstructs an Ollama /api/generate NDJSON stream.
// Each line is a GenerateResponse fragment carrying a "response" text chunk; the
// final line has done:true with done_reason and the token counts.
type generateStreamAccumulator struct {
	model        string
	doneReason   string
	response     strings.Builder
	toolCalls    []json.RawMessage
	metrics      metricsPayload
	sawAnyOutput bool
}

func (a *generateStreamAccumulator) IsTerminal(string) bool { return false } // NDJSON ends at EOF.

func (a *generateStreamAccumulator) Consume(line string) {
	var chunk struct {
		Model      string            `json:"model"`
		Response   string            `json:"response"`
		DoneReason string            `json:"done_reason"`
		ToolCalls  []json.RawMessage `json:"tool_calls"`
		metricsPayload
	}
	if err := json.Unmarshal([]byte(line), &chunk); err != nil {
		return
	}

	if a.model == "" && chunk.Model != "" {
		a.model = chunk.Model
	}
	if chunk.DoneReason != "" {
		a.doneReason = chunk.DoneReason
	}
	if chunk.Response != "" {
		a.response.WriteString(chunk.Response)
		a.sawAnyOutput = true
	}
	if len(chunk.ToolCalls) > 0 {
		a.toolCalls = append(a.toolCalls, chunk.ToolCalls...)
		a.sawAnyOutput = true
	}
	if chunk.PromptEvalCount > 0 {
		a.metrics.PromptEvalCount = chunk.PromptEvalCount
	}
	if chunk.EvalCount > 0 {
		a.metrics.EvalCount = chunk.EvalCount
	}
	if chunk.TotalDuration > 0 {
		a.metrics.TotalDuration = chunk.TotalDuration
	}
	if chunk.LoadDuration > 0 {
		a.metrics.LoadDuration = chunk.LoadDuration
	}
	if chunk.PromptEvalDuration > 0 {
		a.metrics.PromptEvalDuration = chunk.PromptEvalDuration
	}
	if chunk.EvalDuration > 0 {
		a.metrics.EvalDuration = chunk.EvalDuration
	}
}

func (a *generateStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.model != "" {
		span.SetResponseModel(a.model)
	}
	if a.doneReason != "" {
		span.SetGenAIResponseFinishReasons(a.doneReason)
	}
	recordUsage(span, a.metrics)

	if capture.CaptureOutput() && a.sawAnyOutput {
		recordGenerateOutput(span, a.response.String(), a.toolCalls)
	}
}
