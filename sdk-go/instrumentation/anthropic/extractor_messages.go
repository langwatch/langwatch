package anthropic

import (
	"encoding/json"
	"strings"

	"github.com/anthropics/anthropic-sdk-go"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// messagesExtractor handles the Anthropic Messages API (/v1/messages).
//
// Request discriminator: a messages[] array plus the required max_tokens field
// (which together distinguish it from the OpenAI-compatible chat shape and from
// the legacy /v1/complete endpoint). Response discriminator: the JSON body's
// "type" field is "message". The Messages stream is a sequence of TYPED SSE
// events (message_start, content_block_delta, message_delta, message_stop, …)
// with NO [DONE] sentinel — the base ends the stream on EOF.
type messagesExtractor struct{}

func (messagesExtractor) Name() string { return "messages" }

func (messagesExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
	if isMessagesPath(pathHint) {
		return true
	}
	// Shape fallback (e.g. a proxied path): the Messages request is the only
	// Anthropic body carrying both messages[] and the required max_tokens.
	return otelhttp.HasKey(body, "messages") && otelhttp.HasKey(body, "max_tokens")
}

func (messagesExtractor) MatchesResponse(objectField, contentType string) bool {
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false // streaming dispatch is decided from the request shape
	}
	// Anthropic Messages responses carry no top-level "object" field — their
	// discriminator is "type":"message", which the base does not peek — so the
	// base's PeekObjectField yields "". Accept the empty discriminator (the real
	// Anthropic case) as well as a literal "message" for defensiveness. This is
	// the sole extractor, so the base's fallback would select it regardless;
	// matching explicitly keeps the dispatch honest if more shapes are added.
	return objectField == "" || objectField == "message"
}

func (messagesExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var params anthropic.MessageNewParams
	if err := json.Unmarshal(raw, &params); err != nil {
		// Fall back to a best-effort generic mapping so a span is still useful.
		return extractRequestGeneric(span, raw, capture)
	}

	span.SetType(langwatch.SpanTypeLLM)

	if params.Model != "" {
		span.SetRequestModel(string(params.Model))
		span.SetName("messages." + string(params.Model))
	}

	reqParams := langwatch.GenAIRequestParams{}
	if params.MaxTokens > 0 {
		reqParams.MaxTokens = langwatch.Int(int(params.MaxTokens))
	}
	if params.Temperature.Valid() {
		reqParams.Temperature = langwatch.Float64(params.Temperature.Value)
	}
	if params.TopP.Valid() {
		reqParams.TopP = langwatch.Float64(params.TopP.Value)
	}
	if params.TopK.Valid() {
		reqParams.TopK = langwatch.Float64(float64(params.TopK.Value))
	}
	if len(params.StopSequences) > 0 {
		reqParams.StopSequences = params.StopSequences
	}
	span.SetGenAIRequestParams(reqParams)

	if len(params.Tools) > 0 {
		otelhttp.SetJSONAttribute(span, "gen_ai.request.tools", params.Tools)
	}

	// The Anthropic system prompt is a top-level field, not a message; record it
	// as gen_ai.system_instructions (gated as input content).
	if instructions := systemText(params.System); instructions != "" && capture.CaptureInput() {
		span.SetGenAISystemInstructions(instructions)
	}

	if capture.CaptureInput() && len(params.Messages) > 0 {
		if msgs, ok := otelhttp.ToChatMessages(params.Messages); ok {
			span.SetGenAIInputMessages(msgs)
		} else {
			span.SetInputJSON(params.Messages)
		}
	}

	streaming := otelhttp.RequestStreams(raw)
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(streaming))
	return streaming
}

func (messagesExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var msg anthropic.Message
	if err := json.Unmarshal(raw, &msg); err != nil {
		extractResponseGeneric(span, raw, capture)
		return
	}
	recordMessageResult(span, msg, capture)
}

func (messagesExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &messagesStreamAccumulator{}
}

// recordMessageResult records the response attributes shared by the buffered
// Messages response. id, model, stop_reason, the full usage breakdown and the
// text content are all captured; output content is gated by capture.
func recordMessageResult(span *langwatch.Span, msg anthropic.Message, capture langwatch.DataCaptureMode) {
	if msg.ID != "" {
		span.SetAttributes(semconv.GenAIResponseID(msg.ID))
	}
	if msg.Model != "" {
		span.SetResponseModel(string(msg.Model))
	}
	if msg.StopReason != "" {
		span.SetGenAIResponseFinishReasons(string(msg.StopReason))
	}

	recordUsage(span, usage{
		inputTokens:              msg.Usage.InputTokens,
		outputTokens:             msg.Usage.OutputTokens,
		cacheReadInputTokens:     msg.Usage.CacheReadInputTokens,
		cacheCreationInputTokens: msg.Usage.CacheCreationInputTokens,
	})

	if capture.CaptureOutput() {
		// Record the assistant response as structured chat messages when it
		// carries tool_use blocks (the common agent case), so they are not
		// discarded; otherwise keep the plain-text path for pure-text responses.
		if parts, hasToolUse := messageContentParts(msg.Content); hasToolUse {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{{
				Role:    langwatch.ChatRoleAssistant,
				Content: parts,
			}})
		} else if text := messageText(msg.Content); text != "" {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, text)})
		}
	}
}

// messageText concatenates the text from a Message's content blocks.
func messageText(content []anthropic.ContentBlockUnion) string {
	var b strings.Builder
	for _, block := range content {
		if block.Type == "text" {
			b.WriteString(block.Text)
		}
	}
	return b.String()
}

// messageContentParts expands a Message's content blocks into LangWatch rich
// content parts, mapping text blocks to text parts and tool_use blocks to
// tool_call parts. hasToolUse reports whether any tool_use block was present, so
// the caller keeps the plain-text path for pure-text responses.
func messageContentParts(content []anthropic.ContentBlockUnion) (parts []langwatch.ChatRichContent, hasToolUse bool) {
	for _, block := range content {
		switch block.Type {
		case "text":
			if block.Text != "" {
				parts = append(parts, langwatch.TextPart(block.Text))
			}
		case "tool_use":
			hasToolUse = true
			parts = append(parts, langwatch.ChatRichContent{
				Type:       langwatch.ChatContentTypeToolCall,
				ToolName:   block.Name,
				ToolCallID: block.ID,
				Args:       string(block.Input),
			})
		}
	}
	return parts, hasToolUse
}

// systemText flattens the Anthropic system prompt (an array of text blocks)
// into a single string.
func systemText(system []anthropic.TextBlockParam) string {
	switch len(system) {
	case 0:
		return ""
	case 1:
		return system[0].Text
	default:
		var b strings.Builder
		for i, block := range system {
			if i > 0 {
				b.WriteString("\n")
			}
			b.WriteString(block.Text)
		}
		return b.String()
	}
}

// extractRequestGeneric is the best-effort fallback when the typed request body
// fails to unmarshal: it records the model and streaming flag from the raw JSON.
func extractRequestGeneric(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	span.SetType(langwatch.SpanTypeLLM)
	body, ok := otelhttp.ParseBody(raw)
	if !ok {
		return false
	}
	if model, ok := otelhttp.GetString(body, "model"); ok && model != "" {
		span.SetRequestModel(model)
		span.SetName("messages." + model)
	}
	if maxTokens, ok := otelhttp.GetInt(body, "max_tokens"); ok && maxTokens > 0 {
		span.SetGenAIRequestParams(langwatch.GenAIRequestParams{MaxTokens: langwatch.Int(maxTokens)})
	}
	if capture.CaptureInput() {
		if messages, ok := body["messages"]; ok && messages != nil {
			if msgs, ok := otelhttp.ToChatMessages(messages); ok {
				span.SetGenAIInputMessages(msgs)
			} else {
				span.SetInputJSON(messages)
			}
		}
	}
	streaming := otelhttp.RequestStreams(raw)
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(streaming))
	return streaming
}

// extractResponseGeneric is the best-effort fallback when the typed response
// body fails to unmarshal.
func extractResponseGeneric(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	body, ok := otelhttp.ParseBody(raw)
	if !ok {
		return
	}
	if id, ok := otelhttp.GetString(body, "id"); ok && id != "" {
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := otelhttp.GetString(body, "model"); ok && model != "" {
		span.SetResponseModel(model)
	}
	if stopReason, ok := otelhttp.GetString(body, "stop_reason"); ok && stopReason != "" {
		span.SetGenAIResponseFinishReasons(stopReason)
	}
}

// usage is the Anthropic token usage in a flat shape shared by the buffered and
// streamed code paths.
type usage struct {
	inputTokens              int64
	outputTokens             int64
	cacheReadInputTokens     int64
	cacheCreationInputTokens int64
}

// recordUsage records the full Anthropic usage breakdown via every channel the
// server reads: the gen_ai.usage.* attributes (SetGenAIUsage), the LangWatch
// metrics blob (SetMetrics) and the raw cache-creation attribute the server's
// canonicalisation layer reads. Anthropic does not return a total, so it is
// synthesized as input+output+cache_read+cache_creation — cache-read and
// cache-creation are real input tokens, so excluding them understates usage.
func recordUsage(span *langwatch.Span, u usage) {
	genUsage := langwatch.GenAIUsage{}
	metrics := langwatch.SpanMetrics{}

	if u.inputTokens > 0 {
		genUsage.InputTokens = langwatch.Int(int(u.inputTokens))
		metrics.PromptTokens = langwatch.Int(int(u.inputTokens))
	}
	if u.outputTokens > 0 {
		genUsage.OutputTokens = langwatch.Int(int(u.outputTokens))
		metrics.CompletionTokens = langwatch.Int(int(u.outputTokens))
	}
	if total := u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens; total > 0 {
		genUsage.TotalTokens = langwatch.Int(int(total))
	}
	if u.cacheReadInputTokens > 0 {
		genUsage.CachedInputTokens = langwatch.Int(int(u.cacheReadInputTokens))
		metrics.CacheReadInputTokens = langwatch.Int(int(u.cacheReadInputTokens))
	}
	if u.cacheCreationInputTokens > 0 {
		metrics.CacheCreationInputTokens = langwatch.Int(int(u.cacheCreationInputTokens))
		// The server canonicalisation reads the raw attribute too.
		span.SetAttributes(attribute.Int("gen_ai.usage.cache_creation.input_tokens", int(u.cacheCreationInputTokens)))
	}

	span.SetGenAIUsage(genUsage)
	span.SetMetrics(metrics)
}
