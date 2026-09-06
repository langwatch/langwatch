package openaiformat

import (
	"encoding/json"
	"strings"

	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/langwatch/langwatch/sdks/go/instrumentation/otelhttp"
)

// ChatExtractor handles the Chat Completions API (/v1/chat/completions) and the
// legacy text Completions API (/v1/completions). Discriminators: the request
// carries a messages[] array (chat) or a top-level prompt (legacy); the
// response object is "chat.completion" / "text_completion" and stream chunks are
// "chat.completion.chunk" / "text_completion".
//
// The wire format is OpenAI's JSON, so we parse it directly with the otelhttp
// helpers rather than depending on any client's typed structs.
type ChatExtractor struct{}

func (ChatExtractor) Name() string { return "chat" }

func (ChatExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
	// The defining shape is a messages[] array. The path hint claims both the
	// chat and the legacy text-completion endpoints; the legacy completions
	// request carries a top-level prompt instead of messages.
	if _, ok := body["messages"].([]any); ok {
		return true
	}
	if strings.Contains(pathHint, "chat/completions") {
		return true
	}
	if strings.HasSuffix(strings.TrimRight(pathHint, "/"), "/completions") {
		return otelhttp.HasKey(body, "prompt") || otelhttp.HasKey(body, "model")
	}
	return false
}

func (ChatExtractor) MatchesResponse(objectField, contentType string) bool {
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false // streaming dispatch is decided from the request shape
	}
	return objectField == "chat.completion" || objectField == "text_completion"
}

// chatRequest is the subset of an OpenAI chat/legacy-completions request we read.
type chatRequest struct {
	Model            string          `json:"model"`
	Messages         json.RawMessage `json:"messages"`
	Prompt           any             `json:"prompt"`
	Temperature      *float64        `json:"temperature"`
	TopP             *float64        `json:"top_p"`
	MaxTokens        *int            `json:"max_tokens"`
	MaxCompletionTok *int            `json:"max_completion_tokens"`
	FrequencyPenalty *float64        `json:"frequency_penalty"`
	PresencePenalty  *float64        `json:"presence_penalty"`
	Seed             *int            `json:"seed"`
	N                *int            `json:"n"`
	ReasoningEffort  string          `json:"reasoning_effort"`
	Stop             json.RawMessage `json:"stop"`
	Tools            json.RawMessage `json:"tools"`
	Stream           bool            `json:"stream"`
}

func (ChatExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var req chatRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return GenericExtractor{}.ExtractRequest(span, raw, capture)
	}

	if req.Model != "" {
		span.SetRequestModel(req.Model)
		span.SetName("chat." + req.Model)
	}

	span.SetGenAIRequestParams(chatRequestParams(req))

	if len(req.Tools) > 0 {
		otelhttp.SetJSONAttribute(span, string(langwatch.AttributeGenAIRequestTools), json.RawMessage(req.Tools))
	}

	if capture.CaptureInput() {
		recordChatInput(span, req)
	}

	return req.Stream
}

// chatRequestParams maps the sampling/decoding fields of a chat or legacy
// completions request onto the LangWatch request params. Absent wire fields stay
// unset so they are not recorded.
func chatRequestParams(req chatRequest) langwatch.GenAIRequestParams {
	reqParams := langwatch.GenAIRequestParams{}
	if req.Temperature != nil {
		reqParams.Temperature = req.Temperature
	}
	if req.TopP != nil {
		reqParams.TopP = req.TopP
	}
	// max_tokens is the legacy field; max_completion_tokens supersedes it.
	if req.MaxCompletionTok != nil {
		reqParams.MaxTokens = req.MaxCompletionTok
	} else if req.MaxTokens != nil {
		reqParams.MaxTokens = req.MaxTokens
	}
	if req.FrequencyPenalty != nil {
		reqParams.FrequencyPenalty = req.FrequencyPenalty
	}
	if req.PresencePenalty != nil {
		reqParams.PresencePenalty = req.PresencePenalty
	}
	if req.Seed != nil {
		reqParams.Seed = req.Seed
	}
	if req.N != nil {
		reqParams.ChoiceCount = req.N
	}
	if req.ReasoningEffort != "" {
		reqParams.ReasoningEffort = req.ReasoningEffort
	}
	if stop := stopSequences(req.Stop); len(stop) > 0 {
		reqParams.StopSequences = stop
	}
	return reqParams
}

// recordChatInput records the request input as chat messages (chat completions)
// or as a JSON value (legacy completions prompt).
func recordChatInput(span *langwatch.Span, req chatRequest) {
	if len(req.Messages) > 0 {
		var messages []any
		if err := json.Unmarshal(req.Messages, &messages); err == nil && len(messages) > 0 {
			if msgs, ok := otelhttp.ToChatMessages(messages); ok {
				span.SetGenAIInputMessages(msgs)
				return
			}
			span.SetInputJSON(messages)
			return
		}
	}
	if req.Prompt != nil {
		span.SetInput(req.Prompt)
	}
}

// chatResponse is the subset of an OpenAI chat/legacy-completions response we read.
type chatResponse struct {
	ID                string        `json:"id"`
	Model             string        `json:"model"`
	SystemFingerprint string        `json:"system_fingerprint"`
	Choices           []chatChoice  `json:"choices"`
	Usage             *usagePayload `json:"usage"`
}

// chatChoice is a single candidate of a chat/legacy-completions response. With
// n > 1 the response carries several, each an independent candidate.
type chatChoice struct {
	FinishReason string `json:"finish_reason"`
	Message      struct {
		Content   string             `json:"content"`
		ToolCalls []chatRespToolCall `json:"tool_calls"`
	} `json:"message"`
	// Legacy text completions carry the text directly on the choice.
	Text string `json:"text"`
}

// toChatMessage maps a chat choice onto its assistant message, keeping the
// choice's tool calls attached to it. ok is false when the choice carries no
// chat content at all — a legacy /completions choice (whose answer is on Text)
// or an empty candidate — so the caller records nothing for it.
func (c chatChoice) toChatMessage() (langwatch.ChatMessage, bool) {
	if len(c.Message.ToolCalls) == 0 {
		if c.Message.Content == "" {
			return langwatch.ChatMessage{}, false
		}
		return langwatch.TextMessage(langwatch.ChatRoleAssistant, c.Message.Content), true
	}
	toolCalls := make([]langwatch.ToolCall, 0, len(c.Message.ToolCalls))
	for _, tc := range c.Message.ToolCalls {
		toolCalls = append(toolCalls, tc.toLangwatch())
	}
	return langwatch.ChatMessage{
		Role:      langwatch.ChatRoleAssistant,
		Content:   c.Message.Content,
		ToolCalls: toolCalls,
	}, true
}

// chatRespToolCall is a single tool call in an OpenAI chat response message.
type chatRespToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// toLangwatch maps the OpenAI tool-call wire shape onto a LangWatch ToolCall.
func (c chatRespToolCall) toLangwatch() langwatch.ToolCall {
	return langwatch.ToolCall{
		ID:   c.ID,
		Type: c.Type,
		Function: langwatch.FunctionCall{
			Name:      c.Function.Name,
			Arguments: c.Function.Arguments,
		},
	}
}

func (ChatExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp chatResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		GenericExtractor{}.ExtractNonStreaming(span, raw, capture)
		return
	}

	if resp.ID != "" {
		span.SetAttributes(semconv.GenAIResponseID(resp.ID))
	}
	if resp.Model != "" {
		span.SetResponseModel(resp.Model)
	}
	if resp.SystemFingerprint != "" {
		span.SetAttributes(semconv.OpenAIResponseSystemFingerprint(resp.SystemFingerprint))
	}

	recordUsage(span, resp.Usage)

	var finishReasons []string
	// chatMessages holds one assistant message per choice, so an n > 1 response
	// keeps its candidates distinct and each candidate keeps its own tool calls.
	// legacyText accumulates the legacy /completions answer carried directly on
	// the choice: that is arbitrary (non-chat) output text, a different sink.
	var chatMessages []langwatch.ChatMessage
	var legacyText strings.Builder
	for _, choice := range resp.Choices {
		if choice.FinishReason != "" {
			finishReasons = append(finishReasons, choice.FinishReason)
		}
		if msg, ok := choice.toChatMessage(); ok {
			chatMessages = append(chatMessages, msg)
		}
		legacyText.WriteString(choice.Text)
	}
	span.SetGenAIResponseFinishReasons(finishReasons...)

	if capture.CaptureOutput() {
		if len(chatMessages) > 0 {
			span.SetGenAIOutputMessages(chatMessages)
		}
		// The legacy /completions answer is not a chat message; record it as
		// arbitrary output text.
		if legacyText.Len() > 0 {
			span.SetOutputText(legacyText.String())
		}
	}
}

func (ChatExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &chatStreamAccumulator{}
}

// The streamed counterpart (chatStreamAccumulator and its helpers) lives in
// extractor_chat_stream.go.
