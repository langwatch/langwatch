package responses

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	responseshandler "github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events/responses"
	"github.com/openai/openai-go/responses"
	"go.opentelemetry.io/otel/attribute"
	otelog "go.opentelemetry.io/otel/log"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

// ResponseProcessor handles Responses API response processing
type ResponseProcessor struct {
	contentHandler *responseshandler.Handler
	logger         otelog.Logger
	slogger        *slog.Logger
}

// NewResponseProcessor creates a new Responses response processor
func NewResponseProcessor(contentRecordPolicy events.RecordPolicy, logger otelog.Logger, slogger *slog.Logger) *ResponseProcessor {
	return &ResponseProcessor{
		contentHandler: responseshandler.NewHandler(logger, "", contentRecordPolicy), // genAISystemName not needed for response processing
		logger:         logger,
		slogger:        slogger,
	}
}

// ProcessNonStreaming handles non-streaming Responses API responses
func (p *ResponseProcessor) ProcessNonStreaming(ctx context.Context, resp *http.Response, span *langwatch.Span) (io.ReadCloser, error) {
	if resp.Body == nil || resp.Body == http.NoBody {
		return resp.Body, nil
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		p.logError("Failed to read Responses API response body: %v", err)
		return nil, err
	}

	// Restore the response body so the client can read it
	resp.Body = io.NopCloser(bytes.NewBuffer(respBody))

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		return resp.Body, nil
	}

	var responsesResp responses.Response
	if err := json.Unmarshal(respBody, &responsesResp); err == nil && responsesResp.Object == "response" {
		p.setNonStreamingAttributes(span, responsesResp)
		p.contentHandler.ProcessResponsesOutput(ctx, responsesResp)
	} else {
		p.logError("Failed to parse Responses API response: %v", err)
	}

	return resp.Body, nil
}

// ProcessStreaming handles streaming Responses API responses
func (p *ResponseProcessor) ProcessStreaming(ctx context.Context, resp *http.Response, span *langwatch.Span) (io.ReadCloser, error) {
	// Set streaming attribute immediately
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(true))

	// End the span immediately since we're not doing background processing
	// The telemetry is captured from the request and initial response setup
	defer span.End()

	// For streaming, we just return the response body as-is
	// The OpenAI client will handle the SSE parsing
	return resp.Body, nil
}

// StreamProcessingState holds variables updated during stream processing
type StreamProcessingState struct {
	ID                string
	Model             string
	Status            string
	FinishReasons     []string
	AccumulatedOutput strings.Builder
	UsageDataFound    bool
	InputTokens       int
	OutputTokens      int
	TotalTokens       int
}

// setNonStreamingAttributes sets attributes for non-streaming Responses API responses
func (p *ResponseProcessor) setNonStreamingAttributes(span *langwatch.Span, resp responses.Response) {
	span.SetAttributes(semconv.GenAIResponseID(resp.ID))
	span.SetAttributes(semconv.GenAIResponseModel(string(resp.Model)))

	if resp.Status != "" {
		span.SetAttributes(attribute.String("gen_ai.response.status", string(resp.Status)))
		// For Responses API, treat certain status values as finish reasons
		if resp.Status == "completed" || resp.Status == "failed" || resp.Status == "cancelled" {
			span.SetAttributes(semconv.GenAIResponseFinishReasons(string(resp.Status)))
		}
	}

	if resp.Usage.InputTokens > 0 {
		span.SetAttributes(semconv.GenAIUsageInputTokens(int(resp.Usage.InputTokens)))
	}
	if resp.Usage.OutputTokens > 0 {
		span.SetAttributes(semconv.GenAIUsageOutputTokens(int(resp.Usage.OutputTokens)))
	}
	if resp.Usage.TotalTokens > 0 {
		span.SetAttributes(attribute.Int("gen_ai.usage.total_tokens", int(resp.Usage.TotalTokens)))
	}
}

// setStreamEventAttributes sets attributes based on a single SSE event
func (p *ResponseProcessor) setStreamEventAttributes(span *langwatch.Span, eventData map[string]interface{}, state *StreamProcessingState) {
	if id, ok := p.getString(eventData, "id"); ok && state.ID == "" {
		state.ID = id
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := p.getString(eventData, "model"); ok && state.Model == "" {
		state.Model = model
		span.SetAttributes(semconv.GenAIResponseModel(model))
	}
	if status, ok := p.getString(eventData, "status"); ok {
		state.Status = status
		span.SetAttributes(attribute.String("gen_ai.response.status", status))
		if status == "completed" || status == "failed" || status == "cancelled" {
			state.FinishReasons = append(state.FinishReasons, status)
		}
	}

	// Handle output content for Responses API
	if output, ok := eventData["output"]; ok {
		if outputData, outputOk := output.(map[string]interface{}); outputOk {
			if content, contentOk := p.getString(outputData, "content"); contentOk && p.contentHandler.ShouldRecordOutput() {
				// Accumulate content for processing at the end
				state.AccumulatedOutput.WriteString(content)
			}

			if delta, deltaOk := outputData["delta"].(map[string]interface{}); deltaOk {
				if content, contentOk := p.getString(delta, "content"); contentOk && p.contentHandler.ShouldRecordOutput() {
					// Accumulate content for processing at the end
					state.AccumulatedOutput.WriteString(content)
				}
			}
		}
	}

	if usage, usageOk := eventData["usage"].(map[string]interface{}); usageOk && !state.UsageDataFound {
		if it, itOk := p.getInt(usage, "input_tokens"); itOk {
			state.InputTokens = it
			span.SetAttributes(semconv.GenAIUsageInputTokens(it))
		}
		if ot, otOk := p.getInt(usage, "output_tokens"); otOk {
			state.OutputTokens = ot
			span.SetAttributes(semconv.GenAIUsageOutputTokens(ot))
		}
		if tt, ttOk := p.getInt(usage, "total_tokens"); ttOk {
			state.TotalTokens = tt
			span.SetAttributes(attribute.Int("gen_ai.usage.total_tokens", tt))
		}
		state.UsageDataFound = true
	}
}

// setAggregatedStreamAttributes sets final attributes after stream processing
func (p *ResponseProcessor) setAggregatedStreamAttributes(ctx context.Context, span *langwatch.Span, state *StreamProcessingState) {
	if len(state.FinishReasons) > 0 {
		uniqueReasons := make(map[string]struct{})
		var finalReasons []string
		for _, r := range state.FinishReasons {
			if _, exists := uniqueReasons[r]; !exists {
				uniqueReasons[r] = struct{}{}
				finalReasons = append(finalReasons, r)
			}
		}
		span.SetAttributes(semconv.GenAIResponseFinishReasons(finalReasons...))
	}

	// Process the accumulated streaming content at the end
	p.contentHandler.ProcessStreamingOutput(ctx, state.AccumulatedOutput.String())
}

// Helper functions
func (p *ResponseProcessor) getString(data map[string]interface{}, key string) (string, bool) {
	if val, ok := data[key]; ok {
		if str, ok := val.(string); ok {
			return str, true
		}
	}
	return "", false
}

func (p *ResponseProcessor) getInt(data map[string]interface{}, key string) (int, bool) {
	if val, ok := data[key]; ok {
		if f, ok := val.(float64); ok {
			return int(f), true
		}
		if i, ok := val.(int); ok {
			return i, true
		}
	}
	return 0, false
}

func (p *ResponseProcessor) logError(format string, args ...interface{}) {
	p.slogger.Error(fmt.Sprintf(format, args...),
		"component", "github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/responses.ResponseProcessor",
	)
}
