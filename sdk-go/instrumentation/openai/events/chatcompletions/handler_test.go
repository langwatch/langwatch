package chatcompletions

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	"github.com/openai/openai-go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/log/noop"
)

// TestNewHandler tests the creation of a new chat completions handler
func TestNewHandler(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()

	handler := NewHandler(logger, "openai", policy)

	require.NotNil(t, handler)
	assert.Equal(t, "openai", handler.genAISystemName)
	assert.Equal(t, policy, handler.recordPolicy)
}

// TestProcessChatCompletionsContent_EmptyMessages tests processing with no messages
func TestProcessChatCompletionsContent_EmptyMessages(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()

	handler := NewHandler(logger, "openai", policy)

	params := openai.ChatCompletionNewParams{
		Model:    openai.ChatModelGPT4o,
		Messages: []openai.ChatCompletionMessageParamUnion{},
	}

	// Should not panic with empty messages
	handler.ProcessChatCompletionsContent(context.Background(), params)
}

// TestProcessChatCompletionsContent_UserMessage tests processing user messages
func TestProcessChatCompletionsContent_UserMessage(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()
	policy.SetRecordUserInputContent(true)

	handler := NewHandler(logger, "openai", policy)

	params := openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4o,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.UserMessage("Hello, how are you?"),
		},
	}

	// Should not panic
	handler.ProcessChatCompletionsContent(context.Background(), params)
}

// TestProcessChatCompletionsContent_SystemMessage tests processing system messages
func TestProcessChatCompletionsContent_SystemMessage(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()
	policy.SetRecordSystemInputContent(true)

	handler := NewHandler(logger, "openai", policy)

	params := openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4o,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
		},
	}

	// Should not panic
	handler.ProcessChatCompletionsContent(context.Background(), params)
}

// TestProcessChatCompletionsContent_AssistantMessage tests processing assistant messages
func TestProcessChatCompletionsContent_AssistantMessage(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()
	policy.SetRecordOutputContent(true)

	handler := NewHandler(logger, "openai", policy)

	params := openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4o,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.AssistantMessage("I'm doing well, thank you for asking!"),
		},
	}

	// Should not panic
	handler.ProcessChatCompletionsContent(context.Background(), params)
}

// TestProcessChatCompletionsContent_MixedMessages tests processing mixed message types
func TestProcessChatCompletionsContent_MixedMessages(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()
	policy.SetRecordUserInputContent(true)
	policy.SetRecordSystemInputContent(true)
	policy.SetRecordOutputContent(true)

	handler := NewHandler(logger, "openai", policy)

	params := openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4o,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, how are you?"),
			openai.AssistantMessage("I'm doing well, thank you for asking!"),
		},
	}

	// Should not panic
	handler.ProcessChatCompletionsContent(context.Background(), params)
}

// TestProcessChatCompletionOutput tests processing chat completion output
func TestProcessChatCompletionOutput(t *testing.T) {
	tests := []struct {
		name         string
		recordOutput bool
	}{
		{
			name:         "should process when recording enabled",
			recordOutput: true,
		},
		{
			name:         "should skip when recording disabled",
			recordOutput: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger := noop.NewLoggerProvider().Logger("test")
			policy := events.NewProtectedContentRecordPolicy()
			policy.SetRecordOutputContent(tt.recordOutput)

			handler := NewHandler(logger, "openai", policy)

			resp := map[string]interface{}{
				"id": "chatcmpl-123",
				"choices": []map[string]interface{}{
					{
						"message": map[string]interface{}{
							"role":    "assistant",
							"content": "Hello there!",
						},
					},
				},
			}

			// Should not panic
			handler.ProcessChatCompletionOutput(context.Background(), resp)
		})
	}
}

// TestProcessStreamingOutput tests processing streaming output
func TestProcessStreamingOutput(t *testing.T) {
	tests := []struct {
		name         string
		recordOutput bool
	}{
		{
			name:         "should process when recording enabled",
			recordOutput: true,
		},
		{
			name:         "should skip when recording disabled",
			recordOutput: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger := noop.NewLoggerProvider().Logger("test")
			policy := events.NewProtectedContentRecordPolicy()
			policy.SetRecordOutputContent(tt.recordOutput)

			handler := NewHandler(logger, "openai", policy)

			// Should not panic
			handler.ProcessStreamingOutput(context.Background(), "streaming content chunk")
		})
	}
}

// TestShouldRecordOutput tests output recording policy
func TestShouldRecordOutput(t *testing.T) {
	tests := []struct {
		name           string
		recordOutput   bool
		expectedResult bool
	}{
		{
			name:           "should record output when enabled",
			recordOutput:   true,
			expectedResult: true,
		},
		{
			name:           "should not record output when disabled",
			recordOutput:   false,
			expectedResult: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger := noop.NewLoggerProvider().Logger("test")
			policy := events.NewProtectedContentRecordPolicy()
			policy.SetRecordOutputContent(tt.recordOutput)

			handler := NewHandler(logger, "openai", policy)

			assert.Equal(t, tt.expectedResult, handler.ShouldRecordOutput())
		})
	}
}
