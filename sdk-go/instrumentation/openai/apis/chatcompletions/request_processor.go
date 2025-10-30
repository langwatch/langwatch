package chatcompletions

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
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events/chatcompletions"
	"github.com/openai/openai-go"
	"go.opentelemetry.io/otel/attribute"
	otelog "go.opentelemetry.io/otel/log"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

// RequestProcessor handles Chat Completions API request processing
type RequestProcessor struct {
	genAISystemName string
	contentHandler  *chatcompletions.Handler
	logger          otelog.Logger
	slogger         *slog.Logger
}

// NewRequestProcessor creates a new Chat Completions request processor
func NewRequestProcessor(genAISystemName string, contentRecordPolicy events.RecordPolicy, logger otelog.Logger, slogger *slog.Logger) *RequestProcessor {
	return &RequestProcessor{
		genAISystemName: genAISystemName,
		contentHandler:  chatcompletions.NewHandler(logger, genAISystemName, contentRecordPolicy),
		logger:          logger,
		slogger:         slogger,
	}
}

// Process handles the processing of Chat Completions API requests
func (p *RequestProcessor) Process(ctx context.Context, req *http.Request, span *langwatch.Span, operation string) (bool, error) {
	if req.Body == nil || req.Body == http.NoBody {
		return false, nil
	}

	reqBody, err := io.ReadAll(req.Body)
	if err != nil {
		p.logError("Failed to read Chat Completions request body: %v", err)
		return false, err
	}

	// Restore the body so the downstream handler can read it
	req.Body = io.NopCloser(bytes.NewBuffer(reqBody))

	var reqParams openai.ChatCompletionNewParams
	if err := json.Unmarshal(reqBody, &reqParams); err != nil {
		p.logError("Failed to parse Chat Completions request body JSON: %v", err)
		return false, err
	}

	p.setRequestAttributes(ctx, span, reqParams, operation)
	p.contentHandler.ProcessChatCompletionsContent(ctx, reqParams)

	// Check if streaming is requested
	var reqData map[string]interface{}
	if err := json.Unmarshal(reqBody, &reqData); err == nil {
		isStreaming := p.getStreamingFlag(reqData)
		p.setStreamingAttribute(span, isStreaming)
		return isStreaming, nil
	}

	p.setStreamingAttribute(span, false)
	return false, nil
}

// setRequestAttributes sets Chat Completions specific request attributes
func (p *RequestProcessor) setRequestAttributes(ctx context.Context, span *langwatch.Span, reqParams openai.ChatCompletionNewParams, operation string) {
	span.SetRequestModel(string(reqParams.Model))

	// Set the appropriate span name based on the operation
	var operationName string
	if operation == "completions" {
		operationName = "completions"
	} else {
		operationName = "chat"
	}
	span.SetName(fmt.Sprintf("%s %s", operationName, string(reqParams.Model)))

	if reqParams.Temperature.Valid() && reqParams.Temperature.Value > 0 {
		span.SetAttributes(semconv.GenAIRequestTemperature(reqParams.Temperature.Value))
	}

	if reqParams.TopP.Valid() && reqParams.TopP.Value > 0 {
		span.SetAttributes(semconv.GenAIRequestTopP(reqParams.TopP.Value))
	}

	if reqParams.MaxTokens.Valid() && reqParams.MaxTokens.Value > 0 {
		span.SetAttributes(semconv.GenAIRequestMaxTokens(int(reqParams.MaxTokens.Value)))
	}

	if reqParams.FrequencyPenalty.Valid() && reqParams.FrequencyPenalty.Value != 0 {
		span.SetAttributes(semconv.GenAIRequestFrequencyPenalty(reqParams.FrequencyPenalty.Value))
	}

	if reqParams.PresencePenalty.Valid() && reqParams.PresencePenalty.Value != 0 {
		span.SetAttributes(semconv.GenAIRequestPresencePenalty(reqParams.PresencePenalty.Value))
	}

	if len(reqParams.Tools) > 0 {
		p.setJSONAttribute(span, "gen_ai.request.tools", reqParams.Tools)
	}
}

// setStreamingAttribute sets the streaming attribute on the span
func (p *RequestProcessor) setStreamingAttribute(span *langwatch.Span, isStreaming bool) {
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(isStreaming))
}

// getStreamingFlag extracts the streaming flag from the request data
func (p *RequestProcessor) getStreamingFlag(reqData map[string]interface{}) bool {
	if stream, ok := reqData["stream"]; ok {
		if streamBool, ok := stream.(bool); ok {
			return streamBool
		}
	}
	return false
}

// setJSONAttribute sets a JSON attribute on the span
func (p *RequestProcessor) setJSONAttribute(span *langwatch.Span, key string, value interface{}) {
	if jsonBytes, err := json.Marshal(value); err == nil {
		span.SetAttributes(attribute.String(key, string(jsonBytes)))
	}
}

// logError logs an error message using structured logging
func (p *RequestProcessor) logError(format string, args ...interface{}) {
	p.slogger.Error(fmt.Sprintf(format, args...),
		"component", "github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/chatcompletions.RequestProcessor",
		"system", p.genAISystemName,
	)
}
