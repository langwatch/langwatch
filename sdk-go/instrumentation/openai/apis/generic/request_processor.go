package generic

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	otelog "go.opentelemetry.io/otel/log"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

// RequestProcessor handles generic OpenAI API request processing
type RequestProcessor struct {
	genAISystemName string
	contentPolicy   events.RecordPolicy
	logger          otelog.Logger
	slogger         *slog.Logger
}

// NewRequestProcessor creates a new Generic request processor
func NewRequestProcessor(genAISystemName string, contentRecordPolicy events.RecordPolicy, logger otelog.Logger, slogger *slog.Logger) *RequestProcessor {
	return &RequestProcessor{
		genAISystemName: genAISystemName,
		contentPolicy:   contentRecordPolicy,
		logger:          logger,
		slogger:         slogger,
	}
}

// Process handles generic API request processing
func (p *RequestProcessor) Process(ctx context.Context, req *http.Request, span *langwatch.Span, operation string) (bool, error) {
	if req.Body == nil || req.Body == http.NoBody {
		return false, nil
	}

	reqBody, err := io.ReadAll(req.Body)
	if err != nil {
		p.logError("Failed to read generic API request body: %v", err)
		return false, err
	}

	// Restore the body so the downstream handler can read it
	req.Body = io.NopCloser(bytes.NewBuffer(reqBody))

	var reqData map[string]interface{}
	if err := json.Unmarshal(reqBody, &reqData); err != nil {
		p.logError("Failed to parse generic API request body JSON: %v", err)
		return false, err
	}

	p.setCommonRequestAttributes(span, reqData, operation)

	isStreaming := p.getStreamingFlag(reqData)
	p.setStreamingAttribute(span, isStreaming)

	return isStreaming, nil
}

// setCommonRequestAttributes sets attributes common to all GenAI operations
func (p *RequestProcessor) setCommonRequestAttributes(span *langwatch.Span, reqData map[string]interface{}, operation string) {
	if model, ok := p.getString(reqData, "model"); ok {
		span.SetRequestModel(model)
		span.SetName(fmt.Sprintf("%s %s", operation, model))
	}
	if temp, ok := p.getFloat64(reqData, "temperature"); ok {
		span.SetAttributes(semconv.GenAIRequestTemperature(temp))
	}
	if topP, ok := p.getFloat64(reqData, "top_p"); ok {
		span.SetAttributes(semconv.GenAIRequestTopP(topP))
	}
	if topK, ok := p.getFloat64(reqData, "top_k"); ok {
		span.SetAttributes(semconv.GenAIRequestTopK(topK))
	}
	if freqPenalty, ok := p.getFloat64(reqData, "frequency_penalty"); ok {
		span.SetAttributes(semconv.GenAIRequestFrequencyPenalty(freqPenalty))
	}
	if presPenalty, ok := p.getFloat64(reqData, "presence_penalty"); ok {
		span.SetAttributes(semconv.GenAIRequestPresencePenalty(presPenalty))
	}
	if maxTokens, ok := p.getInt(reqData, "max_tokens"); ok {
		span.SetAttributes(semconv.GenAIRequestMaxTokens(maxTokens))
	}
}

// setStreamingAttribute sets the streaming attribute on the span
func (p *RequestProcessor) setStreamingAttribute(span *langwatch.Span, isStreaming bool) {
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(isStreaming))
}

// getStreamingFlag determines if streaming is requested
func (p *RequestProcessor) getStreamingFlag(reqData map[string]interface{}) bool {
	if stream, ok := reqData["stream"]; ok {
		if streamBool, ok := stream.(bool); ok {
			return streamBool
		}
	}
	return false
}

// Helper functions
func (p *RequestProcessor) getString(data map[string]interface{}, key string) (string, bool) {
	if val, ok := data[key]; ok {
		if str, ok := val.(string); ok {
			return str, true
		}
	}
	return "", false
}

func (p *RequestProcessor) getFloat64(data map[string]interface{}, key string) (float64, bool) {
	if val, ok := data[key]; ok {
		if f, ok := val.(float64); ok {
			return f, true
		}
		if i, ok := val.(int); ok {
			return float64(i), true
		}
	}
	return 0, false
}

func (p *RequestProcessor) getInt(data map[string]interface{}, key string) (int, bool) {
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

func (p *RequestProcessor) logError(format string, args ...interface{}) {
	p.slogger.Error(fmt.Sprintf(format, args...),
		"component", "github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/generic.RequestProcessor",
		"system", p.genAISystemName,
	)
}
