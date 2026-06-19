package bedrock

import (
	"encoding/json"
	"log"

	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"go.opentelemetry.io/otel/attribute"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// selectHandler dispatches by the typed operation-input shape to the handler for
// that operation. Returns nil for operations we do not instrument.
func selectHandler(params any) operationHandler {
	switch params.(type) {
	case *bedrockruntimeConverseInput:
		return converseHandler{}
	case *bedrockruntimeConverseStreamInput:
		return converseStreamHandler{}
	case *bedrockruntimeInvokeModelInput:
		return invokeModelHandler{}
	default:
		return nil
	}
}

// derefString returns the value of a *string, or "" when nil.
func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// int32Ptr converts a *int32 to a *int (LangWatch's metric/usage field type),
// preserving nil.
func int32Ptr(v *int32) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

// float32Ptr converts a *float32 to a *float64, preserving nil.
func float32Ptr(v *float32) *float64 {
	if v == nil {
		return nil
	}
	f := float64(*v)
	return &f
}

// recordInferenceConfig maps a Converse/ConverseStream InferenceConfiguration
// onto the gen_ai.request.* params.
func recordInferenceConfig(span *langwatch.Span, ic *types.InferenceConfiguration) {
	if ic == nil {
		return
	}
	span.SetGenAIRequestParams(langwatch.GenAIRequestParams{
		Temperature:   float32Ptr(ic.Temperature),
		TopP:          float32Ptr(ic.TopP),
		MaxTokens:     int32Ptr(ic.MaxTokens),
		StopSequences: ic.StopSequences,
	})
}

// recordTokenUsage records a Converse/ConverseStream TokenUsage via BOTH the
// gen_ai.usage.* attributes (SetGenAIUsage) AND the LangWatch span metrics
// (SetMetrics), wiring cache read -> CacheReadInputTokens and cache write ->
// CacheCreationInputTokens for cost/metric rollups.
func recordTokenUsage(span *langwatch.Span, usage *types.TokenUsage) {
	if usage == nil {
		return
	}

	input := int32Ptr(usage.InputTokens)
	output := int32Ptr(usage.OutputTokens)
	total := int32Ptr(usage.TotalTokens)
	cacheRead := int32Ptr(usage.CacheReadInputTokens)
	cacheWrite := int32Ptr(usage.CacheWriteInputTokens)

	span.SetGenAIUsage(langwatch.GenAIUsage{
		InputTokens:       input,
		OutputTokens:      output,
		TotalTokens:       total,
		CachedInputTokens: cacheRead,
	})

	span.SetMetrics(langwatch.SpanMetrics{
		PromptTokens:             input,
		CompletionTokens:         output,
		CacheReadInputTokens:     cacheRead,
		CacheCreationInputTokens: cacheWrite,
	})
}

// recordLatency records the server-side request latency (the Converse
// Metrics.LatencyMs) as gen_ai.server.request.duration in seconds — the GenAI
// semantic-convention metric name, recorded here as a span attribute.
func recordLatency(span *langwatch.Span, latencyMs int64) {
	span.SetAttributes(attribute.Float64("gen_ai.server.request.duration", float64(latencyMs)/1000.0))
}

// messagesToChat converts a slice of Converse types.Message into LangWatch
// ChatMessages, expanding each content block into text or rich content parts.
func messagesToChat(messages []types.Message) []langwatch.ChatMessage {
	out := make([]langwatch.ChatMessage, 0, len(messages))
	for _, msg := range messages {
		out = append(out, messageToChat(msg.Role, msg.Content))
	}
	return out
}

// messageToChat converts a single Converse role + content-block slice into a
// LangWatch ChatMessage. A single text block collapses to a plain string
// Content; anything richer is expanded into multimodal parts.
func messageToChat(role types.ConversationRole, content []types.ContentBlock) langwatch.ChatMessage {
	chatRole := conversationRole(role)

	// Fast path: a single text block becomes a plain-string message.
	if len(content) == 1 {
		if text, ok := content[0].(*types.ContentBlockMemberText); ok {
			return langwatch.TextMessage(chatRole, text.Value)
		}
	}

	parts := make([]langwatch.ChatRichContent, 0, len(content))
	for _, block := range content {
		if part, ok := contentBlockToPart(block); ok {
			parts = append(parts, part)
		}
	}
	if len(parts) == 0 {
		return langwatch.ChatMessage{Role: chatRole}
	}
	return langwatch.MultiContentMessage(chatRole, parts...)
}

// contentBlockToPart converts a single Converse ContentBlock union member into a
// LangWatch rich-content part. Returns false for blocks with no meaningful
// textual representation.
func contentBlockToPart(block types.ContentBlock) (langwatch.ChatRichContent, bool) {
	switch b := block.(type) {
	case *types.ContentBlockMemberText:
		return langwatch.TextPart(b.Value), true

	case *types.ContentBlockMemberImage:
		mime := imageMimeType(b.Value.Format)
		return langwatch.ChatRichContent{
			Type:     langwatch.ChatContentTypeBinary,
			MimeType: mime,
		}, true

	case *types.ContentBlockMemberDocument:
		return langwatch.ChatRichContent{
			Type:     langwatch.ChatContentTypeBinary,
			MimeType: documentMimeType(b.Value.Format),
			Filename: derefString(b.Value.Name),
		}, true

	case *types.ContentBlockMemberToolUse:
		return langwatch.ChatRichContent{
			Type:       langwatch.ChatContentTypeToolCall,
			ToolName:   derefString(b.Value.Name),
			ToolCallID: derefString(b.Value.ToolUseId),
			Args:       marshalDocument(b.Value.Input),
		}, true

	case *types.ContentBlockMemberToolResult:
		return langwatch.ChatRichContent{
			Type:       langwatch.ChatContentTypeToolResult,
			ToolCallID: derefString(b.Value.ToolUseId),
			Result:     toolResultContent(b.Value.Content),
		}, true

	case *types.ContentBlockMemberReasoningContent:
		if text := reasoningText(b.Value); text != "" {
			return langwatch.TextPart(text), true
		}
	}
	return langwatch.ChatRichContent{}, false
}

// toolResultContent renders the content blocks of a tool result into a value
// suitable for the rich-content Result field (text concatenation, or the JSON
// document, when present).
func toolResultContent(blocks []types.ToolResultContentBlock) any {
	var text string
	for _, block := range blocks {
		switch b := block.(type) {
		case *types.ToolResultContentBlockMemberText:
			text += b.Value
		case *types.ToolResultContentBlockMemberJson:
			return marshalDocument(b.Value)
		}
	}
	if text != "" {
		return text
	}
	return nil
}

// reasoningText extracts the visible reasoning text from a ReasoningContentBlock.
func reasoningText(block types.ReasoningContentBlock) string {
	if rt, ok := block.(*types.ReasoningContentBlockMemberReasoningText); ok {
		return derefString(rt.Value.Text)
	}
	return ""
}

// systemText concatenates the text of the Converse system content blocks into a
// single instruction string.
func systemText(blocks []types.SystemContentBlock) string {
	var out string
	for _, block := range blocks {
		if text, ok := block.(*types.SystemContentBlockMemberText); ok {
			if out != "" {
				out += "\n"
			}
			out += text.Value
		}
	}
	return out
}

// conversationRole maps a Converse ConversationRole onto a LangWatch ChatRole.
func conversationRole(role types.ConversationRole) langwatch.ChatRole {
	switch role {
	case types.ConversationRoleUser:
		return langwatch.ChatRoleUser
	case types.ConversationRoleAssistant:
		return langwatch.ChatRoleAssistant
	case types.ConversationRoleSystem:
		return langwatch.ChatRoleSystem
	default:
		return langwatch.ChatRoleUnknown
	}
}

// imageMimeType maps a Converse ImageFormat to a MIME type.
func imageMimeType(format types.ImageFormat) string {
	if format == "" {
		return "image/*"
	}
	return "image/" + string(format)
}

// documentMimeType maps a Converse DocumentFormat to a MIME type, best-effort.
func documentMimeType(format types.DocumentFormat) string {
	if format == "" {
		return "application/octet-stream"
	}
	return "application/" + string(format)
}

// marshalDocument renders a smithy document (e.g. a tool-use input) to its JSON
// string form, returning "" on error.
func marshalDocument(doc document.Interface) string {
	if doc == nil {
		return ""
	}
	raw, err := doc.MarshalSmithyDocument()
	if err != nil {
		logError("failed to marshal smithy document: %v", err)
		return ""
	}
	return string(raw)
}

// marshalJSON is the package's JSON marshaller (indirected for testability).
func marshalJSON(v any) ([]byte, error) {
	return json.Marshal(v)
}

// logError provides consistent error logging across the package.
func logError(format string, args ...any) {
	log.Default().Printf("[bedrock-instrumentation] "+format, args...)
}
