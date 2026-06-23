package ollama

import (
	"encoding/json"
	"strings"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// chatExtractor handles Ollama's native chat endpoint (/api/chat). The request
// carries a messages[] array; the response carries a single message object and,
// on the final NDJSON line, done:true with the token counts.
type chatExtractor struct{}

func (chatExtractor) Name() string { return "chat" }

func (chatExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
	if strings.Contains(pathHint, "/api/chat") {
		return true
	}
	_, ok := body["messages"].([]any)
	return ok
}

func (chatExtractor) MatchesResponse(objectField, contentType string) bool {
	// Ollama responses carry no top-level "object" discriminator; non-streaming
	// chat dispatch falls through to the generic fallback only if no extractor
	// claimed the request. The streaming dispatch is decided from the request
	// shape, so this matcher need not recognise stream chunks.
	return false
}

// chatRequest is the subset of an Ollama /api/chat request we read.
type chatRequest struct {
	Model    string          `json:"model"`
	Messages json.RawMessage `json:"messages"`
	Tools    json.RawMessage `json:"tools"`
	Format   json.RawMessage `json:"format"`
	Options  optionsParams   `json:"options"`
	Stream   *bool           `json:"stream"`
}

func (chatExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var req chatRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return genericExtractor{}.ExtractRequest(span, raw, capture)
	}

	if req.Model != "" {
		span.SetRequestModel(req.Model)
		span.SetName("chat." + req.Model)
	}

	span.SetGenAIRequestParams(req.Options.toGenAIRequestParams())

	if len(req.Tools) > 0 {
		otelhttp.SetJSONAttribute(span, string(langwatch.AttributeGenAIRequestTools), json.RawMessage(req.Tools))
	}
	recordFormat(span, req.Format)

	if capture.CaptureInput() && len(req.Messages) > 0 {
		recordMessagesInput(span, req.Messages)
	}

	return streamRequested(req.Stream)
}

// chatResponse is the subset of an Ollama /api/chat response we read. Message is
// kept raw so its tool_calls round-trip structurally into chat_messages.
type chatResponse struct {
	Model      string          `json:"model"`
	Message    json.RawMessage `json:"message"`
	DoneReason string          `json:"done_reason"`
	metricsPayload
}

func (chatExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp chatResponse
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

	if capture.CaptureOutput() && len(resp.Message) > 0 {
		recordMessageOutput(span, resp.Message)
	}
}

func (chatExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &chatStreamAccumulator{}
}

// recordMessagesInput records the chat request messages as chat_messages,
// decoding each Ollama message into a LangWatch ChatMessage so roles, content,
// images and tool_calls are preserved structurally (tool-call arguments become
// the canonical JSON-string Arguments). Falls back to a JSON value when the
// payload cannot be represented as chat messages at all.
func recordMessagesInput(span *langwatch.Span, rawMessages json.RawMessage) {
	var rawList []json.RawMessage
	if err := json.Unmarshal(rawMessages, &rawList); err != nil || len(rawList) == 0 {
		return
	}
	msgs := make([]langwatch.ChatMessage, 0, len(rawList))
	for _, raw := range rawList {
		if msg, ok := decodeInputMessage(raw); ok {
			msgs = append(msgs, msg)
		}
	}
	if len(msgs) == 0 {
		var fallback []any
		if err := json.Unmarshal(rawMessages, &fallback); err == nil {
			span.SetInputJSON(fallback)
		}
		return
	}
	span.SetGenAIInputMessages(msgs)
}

// decodeInputMessage maps an Ollama request message onto a LangWatch
// ChatMessage. Unlike an assistant response message, an input message keeps its
// declared role (system/user/assistant/tool) and carries any images as their
// count (raw image bytes are not inlined into the trace).
func decodeInputMessage(raw json.RawMessage) (langwatch.ChatMessage, bool) {
	var wire struct {
		ollamaMessage
		ToolName   string `json:"tool_name"`
		ToolCallID string `json:"tool_call_id"`
		Images     []any  `json:"images"`
	}
	if err := json.Unmarshal(raw, &wire); err != nil {
		return langwatch.ChatMessage{}, false
	}
	if wire.Role == "" {
		return langwatch.ChatMessage{}, false
	}
	msg := langwatch.ChatMessage{Role: langwatch.ChatRole(wire.Role)}
	if wire.Content != "" {
		msg.Content = wire.Content
	}
	if wire.Thinking != "" {
		msg.ReasoningContent = wire.Thinking
	}
	if wire.ToolCallID != "" {
		msg.ToolCallID = wire.ToolCallID
	}
	if wire.ToolName != "" {
		msg.Name = wire.ToolName
	}
	msg.ToolCalls = decodeToolCalls(wire.ToolCalls)
	return msg, true
}

// recordMessageOutput records a single assistant message as chat_messages,
// preserving any tool_calls structurally rather than flattening to text. The
// message is decoded into a LangWatch ChatMessage so tool-call arguments (a JSON
// object on Ollama's wire) become the canonical JSON-string Arguments field,
// matching the LangWatch chat-message convention.
func recordMessageOutput(span *langwatch.Span, rawMessage json.RawMessage) {
	msg, ok := decodeOllamaMessage(rawMessage)
	if !ok {
		return
	}
	span.SetGenAIOutputMessages([]langwatch.ChatMessage{msg})
}

// ollamaMessage is the wire shape of an Ollama chat message, kept minimal: the
// fields LangWatch records (role, content, thinking, tool_calls). Images are
// raw bytes that bloat a trace, so they are not reconstructed here.
type ollamaMessage struct {
	Role      string            `json:"role"`
	Content   string            `json:"content"`
	Thinking  string            `json:"thinking"`
	ToolCalls []json.RawMessage `json:"tool_calls"`
}

// decodeOllamaMessage maps an Ollama assistant message onto a LangWatch
// ChatMessage, defaulting the role to "assistant" and stringifying tool-call
// arguments. Returns false when the payload is not a usable message object.
func decodeOllamaMessage(raw json.RawMessage) (langwatch.ChatMessage, bool) {
	var wire ollamaMessage
	if err := json.Unmarshal(raw, &wire); err != nil {
		return langwatch.ChatMessage{}, false
	}
	role := wire.Role
	if role == "" {
		role = "assistant"
	}
	msg := langwatch.ChatMessage{Role: langwatch.ChatRole(role)}
	if wire.Content != "" {
		msg.Content = wire.Content
	}
	if wire.Thinking != "" {
		msg.ReasoningContent = wire.Thinking
	}
	msg.ToolCalls = decodeToolCalls(wire.ToolCalls)
	if msg.Content == nil && len(msg.ToolCalls) == 0 && msg.ReasoningContent == "" {
		return langwatch.ChatMessage{}, false
	}
	return msg, true
}

// chatStreamAccumulator reconstructs an Ollama /api/chat NDJSON stream. Each
// line is a ChatResponse fragment carrying message.content; the final line has
// done:true with done_reason and the token counts. Content fragments are
// concatenated, and tool_calls (if any) are captured from the final assistant
// message.
type chatStreamAccumulator struct {
	model        string
	doneReason   string
	content      strings.Builder
	thinking     strings.Builder
	role         string
	toolCalls    []json.RawMessage
	metrics      metricsPayload
	sawAnyOutput bool
}

func (a *chatStreamAccumulator) IsTerminal(string) bool { return false } // NDJSON ends at EOF.

func (a *chatStreamAccumulator) Consume(line string) {
	var chunk struct {
		Model      string `json:"model"`
		DoneReason string `json:"done_reason"`
		Message    struct {
			Role      string            `json:"role"`
			Content   string            `json:"content"`
			Thinking  string            `json:"thinking"`
			ToolCalls []json.RawMessage `json:"tool_calls"`
		} `json:"message"`
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
	if a.role == "" && chunk.Message.Role != "" {
		a.role = chunk.Message.Role
	}
	if chunk.Message.Content != "" {
		a.content.WriteString(chunk.Message.Content)
		a.sawAnyOutput = true
	}
	if chunk.Message.Thinking != "" {
		a.thinking.WriteString(chunk.Message.Thinking)
	}
	if len(chunk.Message.ToolCalls) > 0 {
		a.toolCalls = append(a.toolCalls, chunk.Message.ToolCalls...)
		a.sawAnyOutput = true
	}
	// The final line carries the token counts; merge whenever present.
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

func (a *chatStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.model != "" {
		span.SetResponseModel(a.model)
	}
	if a.doneReason != "" {
		span.SetGenAIResponseFinishReasons(a.doneReason)
	}
	recordUsage(span, a.metrics)

	if capture.CaptureOutput() && a.sawAnyOutput {
		span.SetGenAIOutputMessages([]langwatch.ChatMessage{a.assembledMessage()})
	}
}

// assembledMessage reconstructs the streamed assistant message from the
// accumulated content and tool_calls, so streamed tool_calls land structurally
// just like the non-streaming path.
func (a *chatStreamAccumulator) assembledMessage() langwatch.ChatMessage {
	role := a.role
	if role == "" {
		role = "assistant"
	}
	msg := langwatch.ChatMessage{Role: langwatch.ChatRole(role)}
	if a.content.Len() > 0 {
		msg.Content = a.content.String()
	}
	if a.thinking.Len() > 0 {
		msg.ReasoningContent = a.thinking.String()
	}
	msg.ToolCalls = decodeToolCalls(a.toolCalls)
	return msg
}

// decodeToolCalls maps Ollama tool_call fragments onto LangWatch ToolCalls,
// preserving the function name and arguments. Ollama's arguments are a JSON
// object; LangWatch carries them as the marshalled argument string.
func decodeToolCalls(raw []json.RawMessage) []langwatch.ToolCall {
	if len(raw) == 0 {
		return nil
	}
	out := make([]langwatch.ToolCall, 0, len(raw))
	for _, item := range raw {
		var tc struct {
			ID       string `json:"id"`
			Function struct {
				Name      string          `json:"name"`
				Arguments json.RawMessage `json:"arguments"`
			} `json:"function"`
		}
		if err := json.Unmarshal(item, &tc); err != nil {
			continue
		}
		call := langwatch.ToolCall{
			ID:   tc.ID,
			Type: "function",
			Function: langwatch.FunctionCall{
				Name:      tc.Function.Name,
				Arguments: string(tc.Function.Arguments),
			},
		}
		out = append(out, call)
	}
	return out
}
