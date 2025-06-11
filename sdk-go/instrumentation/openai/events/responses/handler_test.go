package responses

import (
	"context"
	"testing"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/responses"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/log/noop"
)

// TestNewHandler tests the creation of a new responses handler
func TestNewHandler(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()

	handler := NewHandler(logger, "openai", policy)

	require.NotNil(t, handler)
	assert.Equal(t, "openai", handler.genAISystemName)
	assert.Equal(t, policy, handler.recordPolicy)
}

// TestProcessResponsesContent_StringInput tests processing with simple string input
func TestProcessResponsesContent_StringInput(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()
	policy.SetRecordUserInputContent(true)

	handler := NewHandler(logger, "openai", policy)

	params := responses.ResponseNewParams{
		Model: "gpt-4o",
		Input: responses.ResponseNewParamsInputUnion{
			OfString: openai.Opt("What is the weather like?"),
		},
	}

	// Should not panic
	handler.ProcessResponsesContent(context.Background(), params)
}

// TestProcessResponsesContent_WithInstructions tests processing with instructions
func TestProcessResponsesContent_WithInstructions(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()
	policy.SetRecordSystemInputContent(true)
	policy.SetRecordUserInputContent(true)

	handler := NewHandler(logger, "openai", policy)

	params := responses.ResponseNewParams{
		Model: "gpt-4o",
		Input: responses.ResponseNewParamsInputUnion{
			OfString: openai.Opt("What is the weather like?"),
		},
		Instructions: openai.Opt("You are a helpful weather assistant"),
	}

	// Should not panic
	handler.ProcessResponsesContent(context.Background(), params)
}

// TestProcessResponsesContent_ComplexInput tests processing with complex input items
func TestProcessResponsesContent_ComplexInput(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()
	policy.SetRecordUserInputContent(true)
	policy.SetRecordSystemInputContent(true)
	policy.SetRecordOutputContent(true)

	handler := NewHandler(logger, "openai", policy)

	// Create a complex input with different message types
	inputItems := []responses.ResponseInputItemUnionParam{
		{
			OfMessage: &responses.EasyInputMessageParam{
				Role: "user",
				Content: responses.EasyInputMessageContentUnionParam{
					OfString: openai.Opt("Hello, how can you help me?"),
				},
			},
		},
		{
			OfMessage: &responses.EasyInputMessageParam{
				Role: "system",
				Content: responses.EasyInputMessageContentUnionParam{
					OfString: openai.Opt("You are a helpful assistant"),
				},
			},
		},
	}

	params := responses.ResponseNewParams{
		Model: "gpt-4o",
		Input: responses.ResponseNewParamsInputUnion{
			OfInputItemList: inputItems,
		},
	}

	// Should not panic
	handler.ProcessResponsesContent(context.Background(), params)
}

// TestProcessResponsesContent_NoInput tests processing with no input
func TestProcessResponsesContent_NoInput(t *testing.T) {
	logger := noop.NewLoggerProvider().Logger("test")
	policy := events.NewProtectedContentRecordPolicy()

	handler := NewHandler(logger, "openai", policy)

	params := responses.ResponseNewParams{
		Model: "gpt-4o",
		// No input provided
	}

	// Should not panic
	handler.ProcessResponsesContent(context.Background(), params)
}

// TestProcessResponsesContent_GuardSettings tests that guard settings are respected
func TestProcessResponsesContent_GuardSettings(t *testing.T) {
	tests := []struct {
		name            string
		recordUser      bool
		recordSystem    bool
		recordOutput    bool
		hasInstructions bool
		hasUserInput    bool
	}{
		{
			name:            "record all",
			recordUser:      true,
			recordSystem:    true,
			recordOutput:    true,
			hasInstructions: true,
			hasUserInput:    true,
		},
		{
			name:            "record none",
			recordUser:      false,
			recordSystem:    false,
			recordOutput:    false,
			hasInstructions: true,
			hasUserInput:    true,
		},
		{
			name:            "record user only",
			recordUser:      true,
			recordSystem:    false,
			recordOutput:    false,
			hasInstructions: true,
			hasUserInput:    true,
		},
		{
			name:            "record system only",
			recordUser:      false,
			recordSystem:    true,
			recordOutput:    false,
			hasInstructions: true,
			hasUserInput:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger := noop.NewLoggerProvider().Logger("test")
			policy := events.NewProtectedContentRecordPolicy()
			policy.SetRecordUserInputContent(tt.recordUser)
			policy.SetRecordSystemInputContent(tt.recordSystem)
			policy.SetRecordOutputContent(tt.recordOutput)

			handler := NewHandler(logger, "openai", policy)

			params := responses.ResponseNewParams{
				Model: "gpt-4o",
			}

			if tt.hasInstructions {
				params.Instructions = openai.Opt("You are a helpful assistant")
			}

			if tt.hasUserInput {
				params.Input = responses.ResponseNewParamsInputUnion{
					OfString: openai.Opt("Test input"),
				}
			}

			// Should not panic regardless of guard settings
			handler.ProcessResponsesContent(context.Background(), params)
		})
	}
}

// TestProcessResponsesOutput tests processing responses output
func TestProcessResponsesOutput(t *testing.T) {
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
				"id":     "resp_123",
				"status": "completed",
				"output": map[string]interface{}{
					"content": "Test response",
				},
			}

			// Should not panic
			handler.ProcessResponsesOutput(context.Background(), resp)
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
			handler.ProcessStreamingOutput(context.Background(), "streaming response chunk")
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
