package chatcompletions

import (
	"context"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	"github.com/openai/openai-go"
	otelog "go.opentelemetry.io/otel/log"
)

// Handler manages event processing specifically for OpenAI Chat Completions API.
type Handler struct {
	logger          otelog.Logger
	genAISystemName string
	recordPolicy    events.RecordPolicy
}

// NewHandler creates a new chat completions handler with the provided dependencies.
func NewHandler(logger otelog.Logger, genAISystemName string, recordPolicy events.RecordPolicy) *Handler {
	return &Handler{
		logger:          logger,
		genAISystemName: genAISystemName,
		recordPolicy:    recordPolicy,
	}
}

// ProcessChatCompletionsContent handles recording of message content for OpenAI Chat Completions API.
//
// The reqParams parameter is of type [openai.ChatCompletionNewParams] which represents the parameters
// for creating a new chat completion and contains:
//   - Messages: slice of chat completion messages
//   - Model: the model to use for completion
//   - Tools: optional tools available to the model
//
// Each message in Messages is of type [openai.ChatCompletionMessageParamUnion] and can contain
// different message types (user, assistant, system, tool) with various content formats.
func (h *Handler) ProcessChatCompletionsContent(ctx context.Context, reqParams openai.ChatCompletionNewParams) {
	if len(reqParams.Messages) == 0 {
		return
	}

	for _, message := range reqParams.Messages {
		h.processChatCompletionMessage(ctx, message)
	}
}

// processChatCompletionMessage processes individual chat completion messages.
//
// The message parameter is of type [openai.ChatCompletionMessageParamUnion] which can be:
//   - OfUser: user input message
//   - OfAssistant: assistant response message
//   - OfSystem: system instruction message
//   - OfDeveloper: developer instruction message
//   - OfTool: tool execution result message
//   - OfFunction: function call result message (legacy)
func (h *Handler) processChatCompletionMessage(ctx context.Context, message openai.ChatCompletionMessageParamUnion) {
	switch {
	case message.OfUser != nil:
		userMsg := *message.OfUser
		basicContent := h.extractBasicContent(userMsg.Content)
		h.logger.Emit(ctx, events.UserMessageRecord(h.genAISystemName, events.UserMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordUserInputContent(),
			Content:        basicContent,
			Role:           events.UserMessageRole(string(userMsg.Role)),
		}))

	case message.OfAssistant != nil:
		assistantMsg := *message.OfAssistant
		basicContent := h.extractBasicContent(assistantMsg.Content)
		toolCalls := h.extractToolCallsFromAssistantMessage(assistantMsg)
		h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordOutputContent(),
			Content:        basicContent,
			Role:           events.AssistantMessageRole(string(assistantMsg.Role)),
			ToolCalls:      toolCalls,
		}))

	case message.OfSystem != nil:
		systemMsg := *message.OfSystem
		basicContent := h.extractBasicContent(systemMsg.Content)
		h.logger.Emit(ctx, events.SystemMessageRecord(h.genAISystemName, events.SystemMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordSystemInputContent(),
			Content:        basicContent,
			Role:           events.SystemMessageRole(string(systemMsg.Role)),
		}))

	case message.OfDeveloper != nil:
		developerMsg := *message.OfDeveloper
		basicContent := h.extractBasicContent(developerMsg.Content)
		h.logger.Emit(ctx, events.SystemMessageRecord(h.genAISystemName, events.SystemMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordSystemInputContent(),
			Content:        basicContent,
			Role:           events.SystemMessageRole(string(developerMsg.Role)),
		}))

	case message.OfTool != nil:
		toolMsg := *message.OfTool
		basicContent := h.extractBasicContent(toolMsg.Content)
		h.logger.Emit(ctx, events.ToolMessageRecord(h.genAISystemName, events.ToolMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordOutputContent(),
			ID:             toolMsg.ToolCallID,
			Content:        basicContent,
			Role:           events.ToolMessageRoleTool,
		}))

	case message.OfFunction != nil:
		funcMsg := *message.OfFunction
		basicContent := h.extractBasicContent(funcMsg.Content)
		h.logger.Emit(ctx, events.ToolMessageRecord(h.genAISystemName, events.ToolMessageRecordParams{
			IncludeContent: h.recordPolicy.GetRecordOutputContent(),
			Content:        basicContent,
			Role:           events.ToolMessageRoleTool,
		}))
	}
}

// ProcessChatCompletionOutput processes Chat Completion API output for recording.
//
// This method handles the recording of chat completion output content based on the guard settings.
func (h *Handler) ProcessChatCompletionOutput(ctx context.Context, resp interface{}) {
	if !h.recordPolicy.GetRecordOutputContent() {
		return
	}

	// Extract content from the response based on its type
	var content string
	if chatResp, ok := resp.(openai.ChatCompletion); ok {
		// Extract content from the first choice's message
		if len(chatResp.Choices) > 0 && chatResp.Choices[0].Message.Content != "" {
			content = chatResp.Choices[0].Message.Content
		} else {
			// Fallback to JSON if no direct content found
			content = h.marshalToJSON(resp)
		}
	} else {
		// Fallback to JSON for unknown response types
		content = h.marshalToJSON(resp)
	}

	h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
		IncludeContent: true,
		Content:        content,
		Role:           events.AssistantMessageRoleAssistant,
	}))
}

// ProcessStreamingOutput processes streaming output content for recording.
//
// This method handles the recording of streaming output content based on the guard settings.
func (h *Handler) ProcessStreamingOutput(ctx context.Context, contentStr string) {
	if !h.recordPolicy.GetRecordOutputContent() {
		return
	}

	h.logger.Emit(ctx, events.AssistantMessageRecord(h.genAISystemName, events.AssistantMessageRecordParams{
		IncludeContent: true,
		Content:        contentStr,
		Role:           events.AssistantMessageRoleAssistant,
	}))
}

// ShouldRecordOutput returns whether output should be recorded based on guard settings.
func (h *Handler) ShouldRecordOutput() bool {
	return h.recordPolicy.GetRecordOutputContent()
}
