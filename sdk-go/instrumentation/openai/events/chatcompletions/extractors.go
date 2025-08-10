package chatcompletions

import (
	"encoding/json"
	"fmt"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	"github.com/openai/openai-go"
)

// extractBasicContent extracts content from various chat completion content unions.
// This is a generic helper that works with any content union that has OfString field.
func (h *Handler) extractBasicContent(content interface{}) string {
	// Try to extract string content using reflection-like approach
	// This will work for most content types that have an OfString field
	if getter, ok := content.(interface{ GetString() *string }); ok {
		if str := getter.GetString(); str != nil {
			return *str
		}
	}

	// Fallback to JSON marshaling for complex content
	return h.marshalToJSON(content)
}

// extractToolCallsFromAssistantMessage extracts tool calls from assistant messages.
func (h *Handler) extractToolCallsFromAssistantMessage(message openai.ChatCompletionAssistantMessageParam) []events.ToolCallRecord {
	var toolCalls []events.ToolCallRecord

	for _, toolCall := range message.ToolCalls {
		if toolCall.Function.Name != "" {
			toolCalls = append(toolCalls, events.ToolCallRecord{
				ID:   toolCall.ID,
				Type: "function",
				Function: events.ToolCallFunctionRecord{
					Name:      toolCall.Function.Name,
					Arguments: toolCall.Function.Arguments,
				},
			})
		}
	}

	return toolCalls
}

// marshalToJSON converts any value to a JSON string for logging.
//
// Uses JSON marshaling to capture the full structure of complex items like tool calls,
// outputs, and other specialized content types from the OpenAI chat completions package.
func (h *Handler) marshalToJSON(item interface{}) string {
	if jsonBytes, err := json.Marshal(item); err == nil {
		return string(jsonBytes)
	}
	return fmt.Sprintf("%+v", item)
}
