package chatcompletions

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
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events/chatcompletions"
	"github.com/openai/openai-go"
	"go.opentelemetry.io/otel/attribute"
	otelog "go.opentelemetry.io/otel/log"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

// ResponseProcessor handles Chat Completions API response processing
type ResponseProcessor struct {
	contentHandler *chatcompletions.Handler
	logger         otelog.Logger
	slogger        *slog.Logger
}

// NewResponseProcessor creates a new Chat Completions response processor
func NewResponseProcessor(contentRecordPolicy events.RecordPolicy, logger otelog.Logger, slogger *slog.Logger) *ResponseProcessor {
	return &ResponseProcessor{
		contentHandler: chatcompletions.NewHandler(logger, "", contentRecordPolicy), // genAISystemName not needed for response processing
		logger:         logger,
		slogger:        slogger,
	}
}

// ProcessNonStreaming handles non-streaming Chat Completions API responses
func (p *ResponseProcessor) ProcessNonStreaming(ctx context.Context, resp *http.Response, span *langwatch.Span) (io.ReadCloser, error) {
	if resp.Body == nil || resp.Body == http.NoBody {
		return resp.Body, nil
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		p.logError("Failed to read Chat Completions response body: %v", err)
		return nil, err
	}

	// Restore the response body so the client can read it
	resp.Body = io.NopCloser(bytes.NewBuffer(respBody))

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		return resp.Body, nil
	}

	var chatResp openai.ChatCompletion
	if err := json.Unmarshal(respBody, &chatResp); err == nil && chatResp.Object == "chat.completion" {
		p.setNonStreamingAttributes(span, chatResp)
		p.contentHandler.ProcessChatCompletionOutput(ctx, chatResp)
	} else {
		// Try parsing as legacy completions format
		var completion openai.Completion
		if err := json.Unmarshal(respBody, &completion); err == nil && completion.Object == "text_completion" {
			p.setLegacyCompletionAttributes(span, completion)
		} else {
			p.logError("Failed to parse Chat Completion response: %v", err)
		}
	}

	return resp.Body, nil
}

// ProcessStreaming handles streaming Chat Completions API responses
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
	SystemFingerprint string
	FinishReasons     []string
	AccumulatedOutput strings.Builder
	UsageDataFound    bool
	PromptTokens      int
	CompletionTokens  int
	TotalTokens       int
}

// setNonStreamingAttributes sets attributes for non-streaming Chat Completion responses
func (p *ResponseProcessor) setNonStreamingAttributes(span *langwatch.Span, resp openai.ChatCompletion) {
	span.SetAttributes(semconv.GenAIResponseID(resp.ID))
	span.SetAttributes(semconv.GenAIResponseModel(resp.Model))

	if resp.SystemFingerprint != "" {
		span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprint(resp.SystemFingerprint))
	}

	// Set usage information
	if resp.Usage.PromptTokens > 0 {
		span.SetAttributes(semconv.GenAIUsageInputTokens(int(resp.Usage.PromptTokens)))
	}
	if resp.Usage.CompletionTokens > 0 {
		span.SetAttributes(semconv.GenAIUsageOutputTokens(int(resp.Usage.CompletionTokens)))
	}
	if resp.Usage.TotalTokens > 0 {
		span.SetAttributes(attribute.Int("gen_ai.usage.total_tokens", int(resp.Usage.TotalTokens)))
	}

	var finishReasons []string
	for _, choice := range resp.Choices {
		if choice.FinishReason != "" {
			finishReasons = append(finishReasons, string(choice.FinishReason))
		}
	}

	if len(finishReasons) > 0 {
		span.SetAttributes(semconv.GenAIResponseFinishReasons(finishReasons...))
	}
}

// setLegacyCompletionAttributes sets attributes for legacy text completion responses
func (p *ResponseProcessor) setLegacyCompletionAttributes(span *langwatch.Span, resp openai.Completion) {
	span.SetAttributes(semconv.GenAIResponseID(resp.ID))
	span.SetAttributes(semconv.GenAIResponseModel(resp.Model))

	if resp.SystemFingerprint != "" {
		span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprint(resp.SystemFingerprint))
	}

	// Set usage information
	if resp.Usage.PromptTokens > 0 {
		span.SetAttributes(semconv.GenAIUsageInputTokens(int(resp.Usage.PromptTokens)))
	}
	if resp.Usage.CompletionTokens > 0 {
		span.SetAttributes(semconv.GenAIUsageOutputTokens(int(resp.Usage.CompletionTokens)))
	}
	if resp.Usage.TotalTokens > 0 {
		span.SetAttributes(attribute.Int("gen_ai.usage.total_tokens", int(resp.Usage.TotalTokens)))
	}

	var finishReasons []string
	for _, choice := range resp.Choices {
		if choice.FinishReason != "" {
			finishReasons = append(finishReasons, string(choice.FinishReason))
		}
	}

	if len(finishReasons) > 0 {
		span.SetAttributes(semconv.GenAIResponseFinishReasons(finishReasons...))
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
	if sysFingerprint, ok := p.getString(eventData, "system_fingerprint"); ok && state.SystemFingerprint == "" {
		state.SystemFingerprint = sysFingerprint
		span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprint(sysFingerprint))
	}

	if choices, ok := eventData["choices"].([]interface{}); ok {
		for _, choiceRaw := range choices {
			if choice, choiceOk := choiceRaw.(map[string]interface{}); choiceOk {
				if reason, reasonOk := p.getString(choice, "finish_reason"); reasonOk && reason != "" {
					state.FinishReasons = append(state.FinishReasons, reason)
				}
				if delta, deltaOk := choice["delta"].(map[string]interface{}); deltaOk {
					if content, contentOk := p.getString(delta, "content"); contentOk && p.contentHandler.ShouldRecordOutput() {
						// Accumulate content for processing at the end
						state.AccumulatedOutput.WriteString(content)
					}
				}
			}
		}
	}

	if usage, usageOk := eventData["usage"].(map[string]interface{}); usageOk && !state.UsageDataFound {
		if pt, ptOk := p.getInt(usage, "prompt_tokens"); ptOk {
			state.PromptTokens = pt
			span.SetAttributes(semconv.GenAIUsageInputTokens(pt))
		}
		if ct, ctOk := p.getInt(usage, "completion_tokens"); ctOk {
			state.CompletionTokens = ct
			span.SetAttributes(semconv.GenAIUsageOutputTokens(ct))
		}
		if rt, rtOk := p.getInt(usage, "total_tokens"); rtOk {
			state.TotalTokens = rt
			span.SetAttributes(attribute.Int("gen_ai.usage.total_tokens", rt))
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

// logError logs an error message using structured logging
func (p *ResponseProcessor) logError(format string, args ...interface{}) {
	p.slogger.Error(fmt.Sprintf(format, args...),
		"component", "github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/chatcompletions.ResponseProcessor",
	)
}
