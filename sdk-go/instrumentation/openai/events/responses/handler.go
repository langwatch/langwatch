package responses

import (
	"context"
	"fmt"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	"github.com/openai/openai-go/responses"
	otelog "go.opentelemetry.io/otel/log"
)

// Handler manages event processing specifically for OpenAI Responses API.
type Handler struct {
	logger          otelog.Logger
	genAISystemName string
	recordPolicy    events.RecordPolicy
}

// NewHandler creates a new responses handler with the provided dependencies.
func NewHandler(logger otelog.Logger, genAISystemName string, recordPolicy events.RecordPolicy) *Handler {
	return &Handler{
		logger:          logger,
		genAISystemName: genAISystemName,
		recordPolicy:    recordPolicy,
	}
}

// ProcessResponsesContent handles recording of instructions and input content for OpenAI Responses API.
//
// The reqParams parameter is of type [responses.ResponseNewParams] which represents the parameters
// for creating a new response and contains:
//   - Instructions: optional system instructions for the model
//   - Input: various input types via [responses.ResponseNewParamsInputUnion]
//
// The Input union can contain either:
//   - OfString: simple string content
//   - OfInputItemList: list of [responses.ResponseInputItemUnionParam] items
func (h *Handler) ProcessResponsesContent(ctx context.Context, reqParams responses.ResponseNewParams) {
	if reqParams.Instructions.Valid() {
		h.logger.Emit(ctx, events.SystemMessageRecord(h.genAISystemName, events.SystemMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordSystemInputContent(),
			Content:        reqParams.Instructions.Value,
			Role:           events.SystemMessageRoleInstruction,
		}))
	}

	// Handle different input types from responses.ResponseNewParamsInputUnion
	// This union can contain either a simple string (OfString) or a list of input items (OfInputItemList)
	switch {
	case reqParams.Input.OfString.Valid():
		h.logger.Emit(ctx, events.UserMessageRecord(h.genAISystemName, events.UserMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordUserInputContent(),
			Content:        reqParams.Input.OfString.Value,
			Role:           events.UserMessageRoleUser,
		}))
	case reqParams.Input.OfInputItemList != nil:
		for _, item := range reqParams.Input.OfInputItemList {
			switch {
			// responses.EasyInputMessageParam - simplified message input with role and content
			case item.OfMessage != nil:
				h.processMessage(ctx, *item.OfMessage)

			// responses.ResponseInputItemMessageParam - detailed message input with content list
			case item.OfInputMessage != nil:
				h.processInputMessage(ctx, *item.OfInputMessage)
			// responses.ResponseOutputMessageParam - assistant output message (may contain tool calls)
			case item.OfOutputMessage != nil:
				h.processOutputMessage(ctx, *item.OfOutputMessage)

			// Tool outputs are separate root-level items
			case item.OfFunctionCallOutput != nil:
				h.processToolOutput(ctx, "FunctionCallOutput", item.OfFunctionCallOutput.CallID, item.OfFunctionCallOutput.Output, *item.OfFunctionCallOutput)
			case item.OfComputerCallOutput != nil:
				h.processToolOutput(ctx, "ComputerCallOutput", item.OfComputerCallOutput.CallID, "", *item.OfComputerCallOutput)
			case item.OfLocalShellCallOutput != nil:
				h.processToolOutput(ctx, "LocalShellCallOutput", item.OfLocalShellCallOutput.ID, item.OfLocalShellCallOutput.Output, *item.OfLocalShellCallOutput)

			// MCP items are also root-level
			case item.OfMcpListTools != nil:
				h.processMcpItem(ctx, "MCP ListTools", *item.OfMcpListTools)
			case item.OfMcpApprovalRequest != nil:
				h.processMcpItem(ctx, "MCP ApprovalRequest", *item.OfMcpApprovalRequest)
			case item.OfMcpApprovalResponse != nil:
				h.processMcpItem(ctx, "MCP ApprovalResponse", *item.OfMcpApprovalResponse)
			case item.OfMcpCall != nil:
				h.processMcpItem(ctx, "MCP Call", *item.OfMcpCall)

			// Reasoning is a root-level item, used by reasoning models
			case item.OfReasoning != nil:
				reasoning := *item.OfReasoning
				contentStr := fmt.Sprintf("Reasoning: %s", h.marshalToJSON(reasoning))
				h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
					IncludeContent: h.recordPolicy.GetRecordOutputContent(),
					Content:        contentStr,
					Role:           events.AssistantMessageRoleAssistant,
				}))

			// References are a root-level item, an internal identifier for an item to reference.
			case item.OfItemReference != nil:
				itemRef := *item.OfItemReference
				contentStr := fmt.Sprintf("Reference: %s", h.marshalToJSON(itemRef))
				h.logger.Emit(ctx, events.SystemMessageRecord(h.genAISystemName, events.SystemMessageRecordParams{
					IncludeContent: h.recordPolicy.GetRecordSystemInputContent(),
					Content:        contentStr,
					Role:           events.SystemMessageRoleSystem,
				}))

				// Note: Tool calls (OfFunctionCall, OfFileSearchCall, etc.)
				// should NOT appear at root level!!
				// They should be nested within messages. If we encounter them here, it
				// might indicate an API structure change or misunderstanding.
			}
		}
	}
}

// processMessage processes [responses.EasyInputMessageParam] which represents a simplified
// message input to the model.
//
// The message contains:
//   - Role: one of "user", "assistant", "system", "developer", or "customer"
//   - Content: [responses.EasyInputMessageContentUnionParam] that can be either:
//   - OfString: simple string content
//   - OfInputItemContentList: list of content parts (text, images, files)
//
// Content extraction is handled by [Handler.extractContentFromEasyMessage].
func (h *Handler) processMessage(ctx context.Context, message responses.EasyInputMessageParam) {
	extractedContent := h.extractContentFromEasyMessage(message)

	switch {
	case message.Role == "customer", message.Role == "user":
		h.logger.Emit(ctx, events.UserMessageRecord(h.genAISystemName, events.UserMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordUserInputContent(),
			Content:        extractedContent,
			Role:           events.UserMessageRole(message.Role),
		}))
	case message.Role == "assistant", message.Role == "bot":
		h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordOutputContent(),
			Content:        extractedContent,
			Role:           events.AssistantMessageRole(message.Role),
		}))
	case message.Role == "system", message.Role == "developer":
		h.logger.Emit(ctx, events.SystemMessageRecord(h.genAISystemName, events.SystemMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordSystemInputContent(),
			Content:        extractedContent,
			Role:           events.SystemMessageRole(message.Role),
		}))
	}
}

// processInputMessage processes [responses.ResponseInputItemMessageParam] which represents
// a detailed message input with a role and a list of content items.
//
// This is used for more complex message structures where:
//   - Role: one of "user", "system", "developer", "assistant", "bot"
//   - Content: [responses.ResponseInputMessageContentListParam] (slice of content parts)
//   - Status: optional status like "in_progress", "completed", "incomplete"
//
// Each content part is of type [responses.ResponseInputContentUnionParam] and can contain
// text, images, or files. Content extraction is handled by [Handler.extractContentFromInputMessage].
func (h *Handler) processInputMessage(ctx context.Context, message responses.ResponseInputItemMessageParam) {
	extractedContent := h.extractContentFromInputMessage(message)

	switch {
	case message.Role == "user", message.Role == "customer":
		h.logger.Emit(ctx, events.UserMessageRecord(h.genAISystemName, events.UserMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordUserInputContent(),
			Content:        extractedContent,
			Role:           events.UserMessageRole(message.Role),
		}))
	case message.Role == "assistant", message.Role == "bot":
		h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordOutputContent(),
			Content:        extractedContent,
			Role:           events.AssistantMessageRole(message.Role),
		}))
	case message.Role == "system", message.Role == "developer":
		h.logger.Emit(ctx, events.SystemMessageRecord(h.genAISystemName, events.SystemMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordSystemInputContent(),
			Content:        extractedContent,
			Role:           events.SystemMessageRole(message.Role),
		}))
	}
}

// processOutputMessage processes [responses.ResponseOutputMessageParam] which represents
// an assistant output message with content that can include text, refusal, and nested tool calls.
//
// These messages have role "assistant" and contain the model's response content, including any tool calls.
func (h *Handler) processOutputMessage(ctx context.Context, message responses.ResponseOutputMessageParam) {
	extractedContent := h.extractContentFromOutputMessage(message)
	toolCalls := h.extractToolCallsFromOutputMessage(message)

	h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
		IncludeContent: h.recordPolicy.GetRecordOutputContent(),
		Content:        extractedContent,
		Role:           events.AssistantMessageRole(string(message.Role)),
		ToolCalls:      toolCalls,
	}))
}

// processToolOutput processes various tool output types with a unified approach.
//
// This handles function call outputs, computer call outputs, and shell call outputs
// by providing a consistent interface for tool output processing.
func (h *Handler) processToolOutput(ctx context.Context, outputType, id, output string, fullItem interface{}) {
	var extractedContent string

	switch outputType {
	case "FunctionCallOutput":
		extractedContent = output
		if extractedContent == "" {
			extractedContent = fmt.Sprintf("Function call output: %s", h.marshalToJSON(fullItem))
		}
	case "ComputerCallOutput":
		extractedContent = fmt.Sprintf("Computer tool output: %s", h.marshalToJSON(fullItem))
	case "LocalShellCallOutput":
		extractedContent = output
		fullData := h.marshalToJSON(fullItem)
		if extractedContent == "" || len(fullData) > len(extractedContent)+50 {
			extractedContent = fmt.Sprintf("Shell output: %s\nFull data: %s", output, fullData)
		}
	}

	h.logger.Emit(ctx, events.ToolMessageRecord(h.genAISystemName, events.ToolMessageRecordParams{
		IncludeContent: h.recordPolicy.GetRecordOutputContent(),
		ID:             id,
		Content:        extractedContent,
		Role:           events.ToolMessageRoleTool,
	}))
}

// processMcpItem processes various MCP item types with a unified approach.
//
// This handles MCP list tools, approval requests, approval responses, and calls
// by providing a consistent interface for MCP item processing.
func (h *Handler) processMcpItem(ctx context.Context, itemType string, item interface{}) {
	extractedContent := fmt.Sprintf("%s: %s", itemType, h.marshalToJSON(item))
	h.logger.Emit(ctx, events.ToolMessageRecord(h.genAISystemName, events.ToolMessageRecordParams{
		IncludeContent: h.recordPolicy.GetRecordOutputContent(),
		Content:        extractedContent,
		Role:           events.ToolMessageRoleTool,
	}))
}

// ProcessResponsesOutput processes Responses API output for recording.
//
// This method handles the recording of responses API output content based on the guard settings.
func (h *Handler) ProcessResponsesOutput(ctx context.Context, resp interface{}) {
	if !h.recordPolicy.GetRecordOutputContent() {
		return
	}

	// Use the generic recording approach for responses output
	h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
		IncludeContent: true,
		Content:        h.marshalToJSON(resp),
		Role:           events.AssistantMessageRoleAssistant,
	}))
}

// ProcessStreamingOutput processes streaming output content for recording.
//
// This method handles the recording of streaming output content based on the guard settings.
func (h *Handler) ProcessStreamingOutput(ctx context.Context, extractedContent string) {
	if !h.recordPolicy.GetRecordOutputContent() {
		return
	}

	h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
		IncludeContent: true,
		Content:        extractedContent,
		Role:           events.AssistantMessageRoleAssistant,
	}))
}

// ShouldRecordOutput returns whether output should be recorded based on guard settings.
func (h *Handler) ShouldRecordOutput() bool {
	return h.recordPolicy.GetRecordOutputContent()
}
