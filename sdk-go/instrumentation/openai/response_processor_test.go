package openai

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// TestResponsesAPINonStreamResponse tests that Responses API non-streaming response attributes are correctly extracted
func TestResponsesAPINonStreamResponse(t *testing.T) {
	// Create a mock span
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	originalTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(originalTracerProvider)

	tracer := langwatch.Tracer("test", trace.WithInstrumentationVersion("test"))
	_, span := tracer.Start(context.Background(), "test-span")

	// Test response data with Responses API structure
	respData := jsonData{
		"id":         "resp_123",
		"object":     "response",
		"created_at": 1234567890,
		"model":      "gpt-4",
		"status":     "completed",
		"output": map[string]interface{}{
			"role":    "assistant",
			"content": "Hello! I'm here to help you with your questions.",
			"tool_calls": []interface{}{
				map[string]interface{}{
					"id":   "call_123",
					"type": "function",
					"function": map[string]interface{}{
						"name":      "get_weather",
						"arguments": `{"location": "New York"}`,
					},
				},
			},
		},
		"usage": map[string]interface{}{
			"prompt_tokens":     15,
			"completion_tokens": 25,
			"total_tokens":      40,
		},
		"metadata": map[string]interface{}{
			"session_id": "test-session",
		},
	}

	processor := NewResponseProcessor(false)
	processor.setNonStreamResponseAttributes(span, respData)

	// End the span to ensure it's exported
	span.End()

	// Verify attributes were set
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)

	attrs := make(map[string]interface{})
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.AsInterface()
	}

	// Check standard response attributes
	assert.Equal(t, "resp_123", attrs["gen_ai.response.id"])
	assert.Equal(t, "gpt-4", attrs["gen_ai.response.model"])
	assert.Equal(t, int64(15), attrs["gen_ai.usage.input_tokens"])
	assert.Equal(t, int64(25), attrs["gen_ai.usage.output_tokens"])

	// Check Responses API specific attributes
	assert.Equal(t, "completed", attrs["gen_ai.response.status"])
	assert.Equal(t, "Hello! I'm here to help you with your questions.", attrs["gen_ai.response.output_content"])
	assert.Equal(t, "assistant", attrs["gen_ai.response.output_role"])
	assert.Contains(t, attrs["gen_ai.response.tool_calls"].(string), "get_weather")
	assert.Contains(t, attrs["gen_ai.response.metadata"].(string), "session_id")
}

// TestResponsesAPIStreamResponse tests that Responses API streaming response attributes are correctly extracted
func TestResponsesAPIStreamResponse(t *testing.T) {
	// Create a mock span
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	originalTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(originalTracerProvider)

	tracer := langwatch.Tracer("test", trace.WithInstrumentationVersion("test"))
	_, span := tracer.Start(context.Background(), "test-span")

	processor := NewResponseProcessor(true)
	state := &StreamProcessingState{}

	// Test first chunk with metadata
	chunk1 := jsonData{
		"id":    "resp_stream_123",
		"model": "gpt-4",
		"output": map[string]interface{}{
			"delta": map[string]interface{}{
				"content": "Hello",
			},
		},
		"status": "in_progress",
	}

	processor.setStreamEventAttributes(span, chunk1, state)

	// Test second chunk with more content
	chunk2 := jsonData{
		"output": map[string]interface{}{
			"delta": map[string]interface{}{
				"content": " there!",
			},
		},
	}

	processor.setStreamEventAttributes(span, chunk2, state)

	// Test completion chunk
	chunk3 := jsonData{
		"status": "completed",
		"usage": map[string]interface{}{
			"prompt_tokens":     10,
			"completion_tokens": 8,
			"total_tokens":      18,
		},
	}

	processor.setStreamEventAttributes(span, chunk3, state)

	// Set aggregated attributes
	processor.setAggregatedStreamAttributes(span, state)

	// End the span to ensure it's exported
	span.End()

	// Verify attributes were set
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)

	attrs := make(map[string]interface{})
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.AsInterface()
	}

	// Check stream response attributes
	assert.Equal(t, "resp_stream_123", attrs["gen_ai.response.id"])
	assert.Equal(t, "gpt-4", attrs["gen_ai.response.model"])
	assert.Equal(t, "completed", attrs["gen_ai.response.status"])
	assert.Equal(t, int64(10), attrs["gen_ai.usage.input_tokens"])
	assert.Equal(t, int64(8), attrs["gen_ai.usage.output_tokens"])

	// Check finish reasons include the completion status
	finishReasons, ok := attrs["gen_ai.response.finish_reasons"]
	assert.True(t, ok)
	assert.Contains(t, finishReasons, "completed")

	// Check that content was accumulated
	assert.Equal(t, "Hello there!", state.AccumulatedOutput.String())
}

// TestResponsesAPIDirectOutputContent tests streaming with direct output content (not in delta)
func TestResponsesAPIDirectOutputContent(t *testing.T) {
	// Create a mock span
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	originalTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(originalTracerProvider)

	tracer := langwatch.Tracer("test", trace.WithInstrumentationVersion("test"))
	_, span := tracer.Start(context.Background(), "test-span")
	defer span.End()

	processor := NewResponseProcessor(true)
	state := &StreamProcessingState{}

	// Test chunk with direct content in output (alternative streaming format)
	chunk := jsonData{
		"output": map[string]interface{}{
			"content": "Direct content",
		},
		"status": "completed",
	}

	processor.setStreamEventAttributes(span, chunk, state)
	processor.setAggregatedStreamAttributes(span, state)

	// Check that direct content was captured
	assert.Equal(t, "Direct content", state.AccumulatedOutput.String())
}

// TestResponsesAPIStatusHandling tests various status values
func TestResponsesAPIStatusHandling(t *testing.T) {
	// Create a mock span
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	originalTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(originalTracerProvider)

	tracer := langwatch.Tracer("test", trace.WithInstrumentationVersion("test"))

	tests := []struct {
		name         string
		status       string
		expectFinish bool
	}{
		{"completed status", "completed", true},
		{"failed status", "failed", true},
		{"cancelled status", "cancelled", true},
		{"in_progress status", "in_progress", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, span := tracer.Start(context.Background(), "test-span")
			defer span.End()

			processor := NewResponseProcessor(false)
			state := &StreamProcessingState{}

			chunk := jsonData{
				"status": tt.status,
			}

			processor.setStreamEventAttributes(span, chunk, state)

			if tt.expectFinish {
				assert.Contains(t, state.FinishReasons, tt.status)
			} else {
				assert.NotContains(t, state.FinishReasons, tt.status)
			}
		})
	}
}
