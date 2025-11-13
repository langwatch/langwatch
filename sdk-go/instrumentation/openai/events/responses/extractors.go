package responses

import (
	"encoding/json"
	"fmt"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	"github.com/openai/openai-go/responses"
)

// extractContentFromEasyMessage extracts content from [responses.EasyInputMessageParam].
//
// The content union ([responses.EasyInputMessageContentUnionParam]) can contain either:
//   - OfString: simple string content accessed via [param.Opt.Value]
//   - OfInputItemContentList: list of content parts processed by [Handler.extractContentFromContentPart]
//
// Returns a string representation of all content parts, or empty string if no content found.
func (h *Handler) extractContentFromEasyMessage(message responses.EasyInputMessageParam) string {
	switch {
	case message.Content.OfString.Valid():
		return message.Content.OfString.Value
	case message.Content.OfInputItemContentList != nil:
		var parts []string
		for _, part := range message.Content.OfInputItemContentList {
			partContent := h.extractContentFromContentPart(part)
			if partContent != "" {
				parts = append(parts, partContent)
			}
		}
		if len(parts) > 0 {
			return fmt.Sprintf("%v", parts)
		}
	}
	return ""
}

// extractContentFromInputMessage extracts content from [responses.ResponseInputItemMessageParam].
//
// The Content field is of type [responses.ResponseInputMessageContentListParam], which is a slice of
// [responses.ResponseInputContentUnionParam] representing different content types.
//
// Each content part is processed by [Handler.extractContentFromContentPart] to handle:
//   - Text content
//   - Image content
//   - File content
//
// Returns a string representation of all content parts combined.
func (h *Handler) extractContentFromInputMessage(message responses.ResponseInputItemMessageParam) string {
	var parts []string
	for _, part := range message.Content {
		partContent := h.extractContentFromContentPart(part)
		if partContent != "" {
			parts = append(parts, partContent)
		}
	}
	if len(parts) > 0 {
		return fmt.Sprintf("%v", parts)
	}
	return ""
}

// extractContentFromOutputMessage extracts content from [responses.ResponseOutputMessageParam].
//
// The Content field is a slice of [responses.ResponseOutputMessageContentUnionParam] which can contain:
//   - OfOutputText: text content with optional annotations and logprobs
//   - OfRefusal: refusal message when the model declines to respond
//
// Only returns meaningful text content, not metadata or structured information.
func (h *Handler) extractContentFromOutputMessage(message responses.ResponseOutputMessageParam) string {
	var textParts []string

	for _, part := range message.Content {
		switch {
		case part.OfOutputText != nil:
			if text := part.GetText(); text != nil && *text != "" {
				textParts = append(textParts, *text)
			}
		case part.OfRefusal != nil:
			if refusal := part.GetRefusal(); refusal != nil && *refusal != "" {
				textParts = append(textParts, *refusal)
			}
		}
	}

	// Only return content if there are actual text parts
	if len(textParts) > 0 {
		return fmt.Sprintf("%v", textParts)
	}
	return ""
}

// extractContentFromContentPart extracts content from [responses.ResponseInputContentUnionParam].
//
// This union type from the OpenAI Go SDK can contain:
//   - OfInputText: text content, extracted using [responses.ResponseInputContentUnionParam.GetText]
//   - OfInputImage: image content, extracted using [responses.ResponseInputContentUnionParam.GetImageURL]
//   - OfInputFile: file content, extracted using [responses.ResponseInputContentUnionParam.GetFilename]
//
// For non-text content, returns a formatted string like "[Image: URL=...]" or "[File: filename]".
// Returns empty string if the content part is not recognized or has no extractable events.
func (h *Handler) extractContentFromContentPart(part responses.ResponseInputContentUnionParam) string {
	switch {
	case part.OfInputText != nil:
		if text := part.GetText(); text != nil {
			return *text
		}
	case part.OfInputImage != nil:
		if url := part.GetImageURL(); url != nil {
			return fmt.Sprintf("[Image: URL=%s]", *url)
		}
		return "[Image]"
	case part.OfInputFile != nil:
		if filename := part.GetFilename(); filename != nil {
			return fmt.Sprintf("[File: %s]", *filename)
		}
		return "[File]"
	}
	return ""
}

// extractToolCallsFromOutputMessage extracts tool calls from [responses.ResponseOutputMessageParam].
//
// Note: Based on the OpenAI Responses API structure, tool calls are typically at the root level
// of input items, not nested within individual messages. Output messages primarily contain
// text content and refusals, but not tool calls themselves.
//
// This method is provided for completeness and future compatibility, but typically returns
// an empty slice since tool calls are handled at the root level in ProcessResponsesContent.
//
// Returns a slice of tool call records, or empty slice if no tool calls are found.
func (h *Handler) extractToolCallsFromOutputMessage(message responses.ResponseOutputMessageParam) []events.ToolCallRecord {
	var toolCalls []events.ToolCallRecord

	// Based on the OpenAI Go SDK structure analysis:
	// - ResponseOutputMessageParam.Content contains only OfOutputText and OfRefusal
	// - Tool calls appear at the root level as separate input items (OfFunctionCall, etc.)
	// - This aligns with the comment in ProcessResponsesContent noting that tool calls
	//   at root level would be unexpected if they were nested within messages

	// For now, we return an empty slice since tool calls are handled at the root level.
	// If future API versions include tool calls within output messages, this method
	// can be expanded to extract them from the message structure.

	// Potential future implementation for nested tool calls:
	// for _, contentPart := range message.Content {
	//     if contentPart.OfToolCall != nil {  // hypothetical field
	//         // Extract and convert tool call data
	//     }
	// }

	return toolCalls
}

// marshalToJSON converts any value to a JSON string for logging.
//
// Uses JSON marshaling to capture the full structure of complex items like tool calls,
// outputs, and other specialized content types from the OpenAI responses package.
func (h *Handler) marshalToJSON(item interface{}) string {
	if jsonBytes, err := json.Marshal(item); err == nil {
		return string(jsonBytes)
	}
	return fmt.Sprintf("%+v", item)
}
