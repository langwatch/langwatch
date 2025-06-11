package generic

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
	"go.opentelemetry.io/otel/attribute"
	otelog "go.opentelemetry.io/otel/log"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

// ResponseProcessor handles generic OpenAI API response processing
type ResponseProcessor struct {
	contentPolicy events.RecordPolicy
	logger        otelog.Logger
	slogger       *slog.Logger
}

// NewResponseProcessor creates a new Generic response processor
func NewResponseProcessor(contentRecordPolicy events.RecordPolicy, logger otelog.Logger, slogger *slog.Logger) *ResponseProcessor {
	return &ResponseProcessor{
		contentPolicy: contentRecordPolicy,
		logger:        logger,
		slogger:       slogger,
	}
}

// ProcessNonStreaming handles non-streaming generic API responses
func (p *ResponseProcessor) ProcessNonStreaming(ctx context.Context, resp *http.Response, span *langwatch.Span) (io.ReadCloser, error) {
	if resp.Body == nil || resp.Body == http.NoBody {
		return resp.Body, nil
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		p.logError("Failed to read generic API response body: %v", err)
		return nil, err
	}

	// Restore the response body so the client can read it
	resp.Body = io.NopCloser(bytes.NewBuffer(respBody))

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		return resp.Body, nil
	}

	var respData map[string]interface{}
	if err := json.Unmarshal(respBody, &respData); err == nil {
		p.setNonStreamResponseAttributes(span, respData)
	} else {
		p.logError("Failed to parse generic API response: %v", err)
	}

	return resp.Body, nil
}

// ProcessStreaming handles streaming generic API responses
// For streaming responses, we set basic attributes and pass through the response
// without trying to parse the stream content to avoid conflicts with the client
func (p *ResponseProcessor) ProcessStreaming(ctx context.Context, resp *http.Response, span *langwatch.Span) (io.ReadCloser, error) {
	// Set streaming attribute
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(true))

	// For streaming, we don't parse the response body since it will be consumed by the client
	// We only set basic attributes that can be determined from the request
	// End the span immediately since we won't be processing the stream content
	span.End()

	return resp.Body, nil
}

// setNonStreamResponseAttributes extracts attributes from a standard JSON response body
func (p *ResponseProcessor) setNonStreamResponseAttributes(span *langwatch.Span, respData map[string]interface{}) {
	if id, ok := p.getString(respData, "id"); ok {
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := p.getString(respData, "model"); ok {
		span.SetAttributes(semconv.GenAIResponseModel(model))
	}
	if sysFingerprint, ok := p.getString(respData, "system_fingerprint"); ok {
		span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprint(sysFingerprint))
	}
	if usage, ok := respData["usage"].(map[string]interface{}); ok {
		// Handle both Chat Completions format (prompt_tokens/completion_tokens)
		// and Responses API format (input_tokens/output_tokens)
		if promptTokens, ok := p.getInt(usage, "prompt_tokens"); ok {
			span.SetAttributes(semconv.GenAIUsageInputTokens(promptTokens))
		} else if inputTokens, ok := p.getInt(usage, "input_tokens"); ok {
			span.SetAttributes(semconv.GenAIUsageInputTokens(inputTokens))
		}

		if completionTokens, ok := p.getInt(usage, "completion_tokens"); ok {
			span.SetAttributes(semconv.GenAIUsageOutputTokens(completionTokens))
		} else if outputTokens, ok := p.getInt(usage, "output_tokens"); ok {
			span.SetAttributes(semconv.GenAIUsageOutputTokens(outputTokens))
		}

		if totalTokens, ok := p.getInt(usage, "total_tokens"); ok {
			span.SetAttributes(attribute.Int("gen_ai.usage.total_tokens", totalTokens))
		}
	}

	if choices, ok := respData["choices"].([]interface{}); ok {
		finishReasons := make([]string, 0, len(choices))
		for _, choiceRaw := range choices {
			if choice, ok := choiceRaw.(map[string]interface{}); ok {
				if reason, ok := p.getString(choice, "finish_reason"); ok {
					finishReasons = append(finishReasons, reason)
				}
			}
		}
		if len(finishReasons) > 0 {
			span.SetAttributes(semconv.GenAIResponseFinishReasons(finishReasons...))
		}
	}

	if status, ok := p.getString(respData, "status"); ok {
		span.SetAttributes(attribute.String("gen_ai.response.status", status))
		// For Responses API, treat certain status values as finish reasons
		if status == "completed" || status == "failed" || status == "cancelled" {
			span.SetAttributes(semconv.GenAIResponseFinishReasons(status))
		}
	}

	if output, ok := respData["output"]; ok {
		if outputData, outputOk := output.(map[string]interface{}); outputOk {
			if content, contentOk := p.getString(outputData, "content"); contentOk {
				span.SetAttributes(attribute.String("gen_ai.response.output_content", content))
			}

			if role, roleOk := p.getString(outputData, "role"); roleOk {
				span.SetAttributes(attribute.String("gen_ai.response.output_role", role))
			}

			if toolCalls, toolCallsOk := outputData["tool_calls"]; toolCallsOk {
				p.setJSONAttribute(span, "gen_ai.response.tool_calls", toolCalls)
			}
		}
	}

	if metadata, ok := respData["metadata"]; ok {
		p.setJSONAttribute(span, "gen_ai.response.metadata", metadata)
	}
}

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

// setJSONAttribute sets a JSON attribute on the span
func (p *ResponseProcessor) setJSONAttribute(span *langwatch.Span, key string, value interface{}) {
	if jsonBytes, err := json.Marshal(value); err == nil {
		span.SetAttributes(attribute.String(key, string(jsonBytes)))
	}
}

func (p *ResponseProcessor) logError(format string, args ...interface{}) {
	p.slogger.Error(fmt.Sprintf(format, args...),
		"component", "github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/generic.ResponseProcessor",
	)
}
