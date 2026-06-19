package openai

import (
	"encoding/json"
	"strings"

	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	openai "github.com/openai/openai-go/v3"
)

// chatExtractor handles the Chat Completions API (/v1/chat/completions and the
// legacy /v1/completions). Discriminators: the request carries a messages[]
// array; the response object is "chat.completion" and stream chunks are
// "chat.completion.chunk".
type chatExtractor struct{}

func (chatExtractor) name() string { return "chat" }

func (chatExtractor) matchesRequest(body map[string]any, pathHint string) bool {
	// The defining shape is a messages[] array. The path hint disambiguates the
	// legacy text-completion endpoint, which has neither messages nor input.
	if _, ok := body["messages"].([]any); ok {
		return true
	}
	return strings.Contains(pathHint, "chat/completions")
}

func (chatExtractor) matchesResponse(objectField, contentType string) bool {
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false // streaming dispatch is decided from the request shape
	}
	return objectField == "chat.completion"
}

func (chatExtractor) extractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var params openai.ChatCompletionNewParams
	if err := json.Unmarshal(raw, &params); err != nil {
		logError("Failed to parse Chat Completions request body JSON: %v", err)
		return genericExtractor{}.extractRequest(span, raw, capture)
	}

	span.SetRequestModel(string(params.Model))
	span.SetName("chat." + string(params.Model))

	reqParams := langwatch.GenAIRequestParams{}
	if params.Temperature.Valid() {
		reqParams.Temperature = langwatch.Float64(params.Temperature.Value)
	}
	if params.TopP.Valid() {
		reqParams.TopP = langwatch.Float64(params.TopP.Value)
	}
	// max_tokens is the legacy field; max_completion_tokens supersedes it.
	if params.MaxCompletionTokens.Valid() {
		reqParams.MaxTokens = langwatch.Int(int(params.MaxCompletionTokens.Value))
	} else if params.MaxTokens.Valid() {
		reqParams.MaxTokens = langwatch.Int(int(params.MaxTokens.Value))
	}
	if params.FrequencyPenalty.Valid() {
		reqParams.FrequencyPenalty = langwatch.Float64(params.FrequencyPenalty.Value)
	}
	if params.PresencePenalty.Valid() {
		reqParams.PresencePenalty = langwatch.Float64(params.PresencePenalty.Value)
	}
	if params.Seed.Valid() {
		reqParams.Seed = langwatch.Int(int(params.Seed.Value))
	}
	if params.N.Valid() {
		reqParams.ChoiceCount = langwatch.Int(int(params.N.Value))
	}
	if params.ReasoningEffort != "" {
		reqParams.ReasoningEffort = string(params.ReasoningEffort)
	}
	if stop := chatStopSequences(params.Stop); len(stop) > 0 {
		reqParams.StopSequences = stop
	}
	span.SetGenAIRequestParams(reqParams)

	if len(params.Tools) > 0 {
		setJSONAttribute(span, "gen_ai.request.tools", params.Tools)
	}

	if capture.CaptureInput() && len(params.Messages) > 0 {
		if msgs, ok := toChatMessages(params.Messages); ok {
			span.SetGenAIInputMessages(msgs)
		} else {
			span.SetInputJSON(params.Messages)
		}
	}

	streaming := requestStreams(raw)
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(streaming))
	return streaming
}

func (chatExtractor) extractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp openai.ChatCompletion
	if err := json.Unmarshal(raw, &resp); err != nil {
		logError("Failed to parse Chat Completion response body JSON: %v", err)
		genericExtractor{}.extractNonStreaming(span, raw, capture)
		return
	}

	span.SetAttributes(semconv.GenAIResponseID(resp.ID))
	span.SetResponseModel(resp.Model)
	if resp.SystemFingerprint != "" {
		span.SetAttributes(semconv.OpenAIResponseSystemFingerprint(resp.SystemFingerprint))
	}

	span.SetGenAIUsage(chatUsage(resp.Usage))

	var finishReasons []string
	var output strings.Builder
	var toolCalls []langwatch.ToolCall
	for _, choice := range resp.Choices {
		if choice.FinishReason != "" {
			finishReasons = append(finishReasons, string(choice.FinishReason))
		}
		output.WriteString(choice.Message.Content)
		toolCalls = append(toolCalls, chatToolCalls(choice.Message.ToolCalls)...)
	}
	span.SetGenAIResponseFinishReasons(finishReasons...)

	if capture.CaptureOutput() {
		// Record the assistant response as gen_ai output messages. When the
		// response carries tool calls (the common agent case) they are preserved
		// on the assistant message; otherwise the pure-text response is wrapped in
		// a single assistant message.
		if len(toolCalls) > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
				Role:      langwatch.ChatRoleAssistant,
				Content:   output.String(),
				ToolCalls: toolCalls,
			}})
		} else if output.Len() > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, output.String())})
		}
	}
}

// chatToolCalls maps the openai-go chat tool-call union onto LangWatch
// ToolCalls, keeping only the function variant (id/type/function name+args).
func chatToolCalls(calls []openai.ChatCompletionMessageToolCallUnion) []langwatch.ToolCall {
	if len(calls) == 0 {
		return nil
	}
	out := make([]langwatch.ToolCall, 0, len(calls))
	for _, call := range calls {
		fn := call.AsFunction()
		out = append(out, langwatch.ToolCall{
			ID:   call.ID,
			Type: call.Type,
			Function: langwatch.FunctionCall{
				Name:      fn.Function.Name,
				Arguments: fn.Function.Arguments,
			},
		})
	}
	return out
}

func (chatExtractor) newStreamAccumulator() streamAccumulator {
	return &chatStreamAccumulator{}
}

// chatStopSequences flattens the chat stop union (string or []string) into a slice.
func chatStopSequences(stop openai.ChatCompletionNewParamsStopUnion) []string {
	if stop.OfString.Valid() {
		return []string{stop.OfString.Value}
	}
	return stop.OfStringArray
}

// chatUsage maps the openai-go chat usage (including cached/reasoning token
// details) onto the LangWatch GenAIUsage helper.
func chatUsage(u openai.CompletionUsage) langwatch.GenAIUsage {
	usage := langwatch.GenAIUsage{}
	if u.PromptTokens > 0 {
		usage.InputTokens = langwatch.Int(int(u.PromptTokens))
	}
	if u.CompletionTokens > 0 {
		usage.OutputTokens = langwatch.Int(int(u.CompletionTokens))
	}
	if u.TotalTokens > 0 {
		usage.TotalTokens = langwatch.Int(int(u.TotalTokens))
	}
	if u.PromptTokensDetails.CachedTokens > 0 {
		usage.CachedInputTokens = langwatch.Int(int(u.PromptTokensDetails.CachedTokens))
	}
	if u.CompletionTokensDetails.ReasoningTokens > 0 {
		usage.ReasoningTokens = langwatch.Int(int(u.CompletionTokensDetails.ReasoningTokens))
	}
	return usage
}

// requestStreams reports whether a request body opted into a streaming response.
func requestStreams(raw []byte) bool {
	body, ok := parseBody(raw)
	if !ok {
		return false
	}
	return getStreamingFlag(body)
}

// chatStreamAccumulator reconstructs a Chat Completions stream. Each chunk is a
// "chat.completion.chunk" carrying choices[].delta.content; the stream is
// terminated by a "[DONE]" sentinel and usage (when requested) arrives in the
// final chunk.
type chatStreamAccumulator struct {
	id                string
	model             string
	systemFingerprint string
	finishReasons     []string
	output            strings.Builder
	usage             langwatch.GenAIUsage
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

func (a *chatStreamAccumulator) isTerminal(dataLine string) bool {
	return dataLine == "[DONE]"
}

func (a *chatStreamAccumulator) consume(dataLine string) {
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
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage *struct {
			PromptTokens        int `json:"prompt_tokens"`
			CompletionTokens    int `json:"completion_tokens"`
			TotalTokens         int `json:"total_tokens"`
			PromptTokensDetails struct {
				CachedTokens int `json:"cached_tokens"`
			} `json:"prompt_tokens_details"`
			CompletionTokensDetails struct {
				ReasoningTokens int `json:"reasoning_tokens"`
			} `json:"completion_tokens_details"`
		} `json:"usage"`
	}
	if err := json.Unmarshal([]byte(dataLine), &chunk); err != nil {
		logError("Failed to parse chat stream chunk JSON. Error: %v. Data: %s", err, dataLine)
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
		if chunk.Usage.PromptTokens > 0 {
			a.usage.InputTokens = langwatch.Int(chunk.Usage.PromptTokens)
		}
		if chunk.Usage.CompletionTokens > 0 {
			a.usage.OutputTokens = langwatch.Int(chunk.Usage.CompletionTokens)
		}
		if chunk.Usage.TotalTokens > 0 {
			a.usage.TotalTokens = langwatch.Int(chunk.Usage.TotalTokens)
		}
		if chunk.Usage.PromptTokensDetails.CachedTokens > 0 {
			a.usage.CachedInputTokens = langwatch.Int(chunk.Usage.PromptTokensDetails.CachedTokens)
		}
		if chunk.Usage.CompletionTokensDetails.ReasoningTokens > 0 {
			a.usage.ReasoningTokens = langwatch.Int(chunk.Usage.CompletionTokensDetails.ReasoningTokens)
		}
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

func (a *chatStreamAccumulator) finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
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

	if capture.CaptureOutput() {
		// Record gen_ai output messages. When tool calls were streamed (the common
		// agent case) they are preserved on the assistant message; otherwise the
		// pure-text response is wrapped in a single assistant message.
		if toolCalls := a.assembledToolCalls(); len(toolCalls) > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
				Role:      langwatch.ChatRoleAssistant,
				Content:   a.output.String(),
				ToolCalls: toolCalls,
			}})
		} else if a.output.Len() > 0 {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, a.output.String())})
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
