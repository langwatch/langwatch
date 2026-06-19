package gopenai

import (
	"encoding/json"
	"strings"

	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// chatExtractor handles the Chat Completions API (/v1/chat/completions) and the
// legacy text Completions API (/v1/completions). Discriminators: the request
// carries a messages[] array (chat) or a top-level prompt (legacy); the
// response object is "chat.completion" / "text_completion" and stream chunks are
// "chat.completion.chunk" / "text_completion".
//
// The wire format is OpenAI's JSON, so we parse it directly with the otelhttp
// helpers rather than depending on any client's typed structs.
type chatExtractor struct{}

func (chatExtractor) Name() string { return "chat" }

func (chatExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
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

func (chatExtractor) MatchesResponse(objectField, contentType string) bool {
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

func (chatExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var req chatRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return genericExtractor{}.ExtractRequest(span, raw, capture)
	}

	if req.Model != "" {
		span.SetRequestModel(req.Model)
		span.SetName("chat." + req.Model)
	}

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
	span.SetGenAIRequestParams(reqParams)

	if len(req.Tools) > 0 {
		otelhttp.SetJSONAttribute(span, "gen_ai.request.tools", json.RawMessage(req.Tools))
	}

	if capture.CaptureInput() {
		recordChatInput(span, req)
	}

	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(req.Stream))
	return req.Stream
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
	ID                string `json:"id"`
	Model             string `json:"model"`
	SystemFingerprint string `json:"system_fingerprint"`
	Choices           []struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Content   string             `json:"content"`
			ToolCalls []chatRespToolCall `json:"tool_calls"`
		} `json:"message"`
		// Legacy text completions carry the text directly on the choice.
		Text string `json:"text"`
	} `json:"choices"`
	Usage *usagePayload `json:"usage"`
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

func (chatExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp chatResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		genericExtractor{}.ExtractNonStreaming(span, raw, capture)
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
	// chatOutput accumulates chat-completion assistant message content; legacyText
	// accumulates the legacy /completions answer carried directly on the choice.
	// They route to different sinks: chat content is gen_ai-native chat output,
	// while the legacy completions answer is arbitrary (non-chat) output text.
	var chatOutput strings.Builder
	var legacyText strings.Builder
	var toolCalls []langwatch.ToolCall
	for _, choice := range resp.Choices {
		if choice.FinishReason != "" {
			finishReasons = append(finishReasons, choice.FinishReason)
		}
		chatOutput.WriteString(choice.Message.Content)
		legacyText.WriteString(choice.Text)
		for _, tc := range choice.Message.ToolCalls {
			toolCalls = append(toolCalls, tc.toLangwatch())
		}
	}
	span.SetGenAIResponseFinishReasons(finishReasons...)

	if capture.CaptureOutput() {
		// Record the chat-completion assistant response as gen_ai-native chat
		// messages: structured when it carries tool calls (the common agent case),
		// otherwise a single text assistant message.
		if len(toolCalls) > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
				Role:      langwatch.ChatRoleAssistant,
				Content:   chatOutput.String(),
				ToolCalls: toolCalls,
			}})
		} else if chatOutput.Len() > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, chatOutput.String())})
		}
		// The legacy /completions answer is not a chat message; record it as
		// arbitrary output text.
		if legacyText.Len() > 0 {
			span.SetOutputText(legacyText.String())
		}
	}
}

func (chatExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &chatStreamAccumulator{}
}

// stopSequences flattens the OpenAI stop union (string or []string) into a slice.
func stopSequences(raw json.RawMessage) []string {
	if len(raw) == 0 {
		return nil
	}
	var single string
	if err := json.Unmarshal(raw, &single); err == nil {
		if single == "" {
			return nil
		}
		return []string{single}
	}
	var many []string
	if err := json.Unmarshal(raw, &many); err == nil {
		return many
	}
	return nil
}

// chatStreamAccumulator reconstructs a Chat Completions stream. Each chunk is a
// "chat.completion.chunk" carrying choices[].delta.content; the stream is
// terminated by a "[DONE]" sentinel and usage (when requested via
// stream_options.include_usage) arrives in the final chunk.
type chatStreamAccumulator struct {
	id                string
	model             string
	systemFingerprint string
	finishReasons     []string
	// output accumulates chat-completion delta content (gen_ai-native chat output);
	// legacyText accumulates the legacy /completions streamed answer (non-chat).
	output     strings.Builder
	legacyText strings.Builder
	usage      langwatch.GenAIUsage
	// toolCalls accumulates streamed tool-call fragments keyed by their delta
	// index; toolCallOrder preserves first-seen order for deterministic output.
	toolCalls     map[int]*streamToolCall
	toolCallOrder []int
}

// streamToolCall accumulates the fragments of a single streamed tool call. The
// id/type/name arrive once; the function arguments are streamed incrementally.
type streamToolCall struct {
	id   string
	typ  string
	name string
	args strings.Builder
}

func (a *chatStreamAccumulator) IsTerminal(dataLine string) bool {
	return dataLine == "[DONE]"
}

func (a *chatStreamAccumulator) Consume(dataLine string) {
	var chunk struct {
		ID                string `json:"id"`
		Model             string `json:"model"`
		SystemFingerprint string `json:"system_fingerprint"`
		Choices           []struct {
			Delta struct {
				Content   string `json:"content"`
				ToolCalls []struct {
					Index    int    `json:"index"`
					ID       string `json:"id"`
					Type     string `json:"type"`
					Function struct {
						Name      string `json:"name"`
						Arguments string `json:"arguments"`
					} `json:"function"`
				} `json:"tool_calls"`
			} `json:"delta"`
			// Legacy streamed text completions carry text on the choice.
			Text         string `json:"text"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage *usagePayload `json:"usage"`
	}
	if err := json.Unmarshal([]byte(dataLine), &chunk); err != nil {
		return
	}

	if a.id == "" && chunk.ID != "" {
		a.id = chunk.ID
	}
	if a.model == "" && chunk.Model != "" {
		a.model = chunk.Model
	}
	if a.systemFingerprint == "" && chunk.SystemFingerprint != "" {
		a.systemFingerprint = chunk.SystemFingerprint
	}

	for _, choice := range chunk.Choices {
		a.output.WriteString(choice.Delta.Content)
		a.legacyText.WriteString(choice.Text)
		if choice.FinishReason != "" {
			a.finishReasons = append(a.finishReasons, choice.FinishReason)
		}
		for _, tc := range choice.Delta.ToolCalls {
			acc := a.toolCallAt(tc.Index)
			if tc.ID != "" {
				acc.id = tc.ID
			}
			if tc.Type != "" {
				acc.typ = tc.Type
			}
			if tc.Function.Name != "" {
				acc.name = tc.Function.Name
			}
			acc.args.WriteString(tc.Function.Arguments)
		}
	}

	if chunk.Usage != nil {
		mergeUsage(&a.usage, chunk.Usage)
	}
}

// toolCallAt returns the accumulator for the streamed tool call at index,
// creating it (and remembering its order) on first sight.
func (a *chatStreamAccumulator) toolCallAt(index int) *streamToolCall {
	if a.toolCalls == nil {
		a.toolCalls = make(map[int]*streamToolCall)
	}
	acc, ok := a.toolCalls[index]
	if !ok {
		acc = &streamToolCall{}
		a.toolCalls[index] = acc
		a.toolCallOrder = append(a.toolCallOrder, index)
	}
	return acc
}

// assembledToolCalls renders the accumulated streamed tool calls into LangWatch
// ToolCalls, in first-seen order.
func (a *chatStreamAccumulator) assembledToolCalls() []langwatch.ToolCall {
	if len(a.toolCallOrder) == 0 {
		return nil
	}
	out := make([]langwatch.ToolCall, 0, len(a.toolCallOrder))
	for _, index := range a.toolCallOrder {
		tc := a.toolCalls[index]
		out = append(out, langwatch.ToolCall{
			ID:   tc.id,
			Type: tc.typ,
			Function: langwatch.FunctionCall{
				Name:      tc.name,
				Arguments: tc.args.String(),
			},
		})
	}
	return out
}

func (a *chatStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.id != "" {
		span.SetAttributes(semconv.GenAIResponseID(a.id))
	}
	if a.model != "" {
		span.SetResponseModel(a.model)
	}
	if a.systemFingerprint != "" {
		span.SetAttributes(semconv.OpenAIResponseSystemFingerprint(a.systemFingerprint))
	}
	span.SetGenAIResponseFinishReasons(dedupe(a.finishReasons)...)
	span.SetGenAIUsage(a.usage)
	span.SetMetrics(usageMetrics(a.usage))

	if capture.CaptureOutput() {
		// Record the chat-completion response as gen_ai-native chat messages:
		// structured when tool calls were streamed (the common agent case),
		// otherwise a single text assistant message.
		if toolCalls := a.assembledToolCalls(); len(toolCalls) > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
				Role:      langwatch.ChatRoleAssistant,
				Content:   a.output.String(),
				ToolCalls: toolCalls,
			}})
		} else if a.output.Len() > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, a.output.String())})
		}
		// The legacy /completions streamed answer is not a chat message; record it
		// as arbitrary output text.
		if a.legacyText.Len() > 0 {
			span.SetOutputText(a.legacyText.String())
		}
	}
}

// dedupe returns the unique values of in, preserving first-seen order.
func dedupe(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(in))
	out := make([]string, 0, len(in))
	for _, v := range in {
		if _, ok := seen[v]; ok {
			continue
		}
		seen[v] = struct{}{}
		out = append(out, v)
	}
	return out
}
