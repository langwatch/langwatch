package ollama

import (
	"encoding/json"
	"strings"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/langwatch/langwatch/sdks/go/instrumentation/otelhttp"
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
		recordGenerateOutput(span, generateOutput{
			response:  resp.Response,
			thinking:  resp.Thinking,
			toolCalls: resp.ToolCalls,
		})
	}
}

func (generateExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &generateStreamAccumulator{}
}

// generateOutput is the assistant output of one /api/generate call, assembled
// either from the single response body or from the accumulated stream.
type generateOutput struct {
	response  string
	thinking  string
	toolCalls []json.RawMessage
}

// recordGenerateOutput records the generate response output as a single
// assistant message: the text response, the reasoning text a thinking model
// returns under "thinking", and any tool calls, kept structurally. Mirrors the
// chat path, which carries thinking as ReasoningContent.
func recordGenerateOutput(span *langwatch.Span, out generateOutput) {
	calls := decodeToolCalls(out.toolCalls)
	if out.response == "" && out.thinking == "" && len(calls) == 0 {
		return
	}
	msg := langwatch.ChatMessage{Role: langwatch.ChatRoleAssistant, ToolCalls: calls}
	if out.response != "" {
		msg.Content = out.response
	}
	if out.thinking != "" {
		msg.ReasoningContent = out.thinking
	}
	span.SetGenAIOutputMessages([]langwatch.ChatMessage{msg})
}

// generateStreamAccumulator reconstructs an Ollama /api/generate NDJSON stream.
// Each line is a GenerateResponse fragment carrying a "response" text chunk; the
// final line has done:true with done_reason and the token counts.
type generateStreamAccumulator struct {
	model        string
	doneReason   string
	response     strings.Builder
	thinking     strings.Builder
	toolCalls    []json.RawMessage
	metrics      metricsPayload
	sawAnyOutput bool
}

func (a *generateStreamAccumulator) IsTerminal(string) bool { return false } // NDJSON ends at EOF.

func (a *generateStreamAccumulator) Consume(line string) {
	var chunk struct {
		Model      string            `json:"model"`
		Response   string            `json:"response"`
		Thinking   string            `json:"thinking"`
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
	if chunk.Thinking != "" {
		// Reasoning counts as output: a thinking model can stream only thinking
		// chunks before the final line, and Finish would otherwise discard them.
		a.thinking.WriteString(chunk.Thinking)
		a.sawAnyOutput = true
	}
	if len(chunk.ToolCalls) > 0 {
		a.toolCalls = append(a.toolCalls, chunk.ToolCalls...)
		a.sawAnyOutput = true
	}
	a.metrics.merge(chunk.metricsPayload)
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
		recordGenerateOutput(span, generateOutput{
			response:  a.response.String(),
			thinking:  a.thinking.String(),
			toolCalls: a.toolCalls,
		})
	}
}
