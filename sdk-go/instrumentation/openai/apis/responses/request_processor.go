package responses

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
	responseshandler "github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events/responses"
	"github.com/openai/openai-go/responses"
	"go.opentelemetry.io/otel/attribute"
	otelog "go.opentelemetry.io/otel/log"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"
)

// RequestProcessor handles Responses API request processing
type RequestProcessor struct {
	genAISystemName string
	contentHandler  *responseshandler.Handler
	logger          otelog.Logger
	slogger         *slog.Logger
}

// NewRequestProcessor creates a new Responses request processor
func NewRequestProcessor(genAISystemName string, contentRecordPolicy events.RecordPolicy, logger otelog.Logger, slogger *slog.Logger) *RequestProcessor {
	return &RequestProcessor{
		genAISystemName: genAISystemName,
		contentHandler:  responseshandler.NewHandler(logger, genAISystemName, contentRecordPolicy),
		logger:          logger,
		slogger:         slogger,
	}
}

// Process handles the processing of Responses API requests
func (p *RequestProcessor) Process(ctx context.Context, req *http.Request, span *langwatch.Span, operation string) (bool, error) {
	if req.Body == nil || req.Body == http.NoBody {
		return false, nil
	}

	reqBody, err := io.ReadAll(req.Body)
	if err != nil {
		p.logError("Failed to read Responses API request body: %v", err)
		return false, err
	}

	// Restore the body so the downstream handler can read it
	req.Body = io.NopCloser(bytes.NewBuffer(reqBody))

	var reqParams responses.ResponseNewParams
	if err := json.Unmarshal(reqBody, &reqParams); err != nil {
		p.logError("Failed to parse Responses API request body JSON: %v", err)
		return false, err
	}

	p.setRequestAttributes(ctx, span, reqParams)
	p.contentHandler.ProcessResponsesContent(ctx, reqParams)

	// Check if streaming is requested - need to examine raw JSON for stream field
	var reqData map[string]any
	if err := json.Unmarshal(reqBody, &reqData); err == nil {
		isStreaming := p.getStreamingFlag(reqData)
		p.setStreamingAttribute(span, isStreaming)
		return isStreaming, nil
	}

	p.setStreamingAttribute(span, false)
	return false, nil
}

// setRequestAttributes sets Responses API specific request attributes
func (p *RequestProcessor) setRequestAttributes(ctx context.Context, span *langwatch.Span, reqParams responses.ResponseNewParams) {
	span.SetRequestModel(string(reqParams.Model))
	span.SetName(fmt.Sprintf("responses %s", string(reqParams.Model)))

	if reqParams.MaxOutputTokens.Valid() && reqParams.MaxOutputTokens.Value > 0 {
		span.SetAttributes(semconv.GenAIRequestMaxTokens((int(reqParams.MaxOutputTokens.Value))))
	}

	if reqParams.Temperature.Valid() && reqParams.Temperature.Value > 0 {
		span.SetAttributes(semconv.GenAIRequestTemperature(reqParams.Temperature.Value))
	}

	if reqParams.TopP.Valid() && reqParams.TopP.Value > 0 {
		span.SetAttributes(semconv.GenAIRequestTopP(reqParams.TopP.Value))
	}

	if reqParams.ParallelToolCalls.Valid() {
		span.SetAttributes(attribute.Bool("gen_ai.request.parallel_tool_calls", reqParams.ParallelToolCalls.Value))
	}

	if len(reqParams.Tools) > 0 {
		p.setJSONAttribute(span, "gen_ai.request.tools", reqParams.Tools)
	}

	// Handle tool_choice if present
	p.setJSONAttribute(span, "gen_ai.request.tool_choice", reqParams.ToolChoice)
}

// setStreamingAttribute sets the streaming attribute on the span
func (p *RequestProcessor) setStreamingAttribute(span *langwatch.Span, isStreaming bool) {
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(isStreaming))
}

// getStreamingFlag extracts the streaming flag from the request data
func (p *RequestProcessor) getStreamingFlag(reqData map[string]any) bool {
	if stream, ok := reqData["stream"]; ok {
		if streamBool, ok := stream.(bool); ok {
			return streamBool
		}
	}
	return false
}

// setJSONAttribute sets a JSON attribute on the span
func (p *RequestProcessor) setJSONAttribute(span *langwatch.Span, key string, value any) {
	if jsonBytes, err := json.Marshal(value); err == nil {
		span.SetAttributes(attribute.String(key, string(jsonBytes)))
	}
}

// logError logs an error message using structured logging
func (p *RequestProcessor) logError(format string, args ...any) {
	p.slogger.Error(fmt.Sprintf(format, args...),
		"component", "github.com/langwatch/langwatch/sdk-go/instrumentation/openai/apis/responses.RequestProcessor",
		"system", p.genAISystemName,
	)
}
