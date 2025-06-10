package openai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/responses"
)

// RequestProcessor handles the processing of OpenAI API requests
type RequestProcessor struct {
	recordInput bool
}

// NewRequestProcessor creates a new request processor
func NewRequestProcessor(recordInput bool) *RequestProcessor {
	return &RequestProcessor{
		recordInput: recordInput,
	}
}

// ProcessRequest reads and processes the request body, setting appropriate span attributes
func (p *RequestProcessor) ProcessRequest(req *http.Request, span *langwatch.Span, operation string) (bool, error) {
	if req.Body == nil || req.Body == http.NoBody {
		return false, nil
	}

	reqBody, err := io.ReadAll(req.Body)
	if err != nil {
		logError("Failed to read OpenAI request body: %v", err)
		return false, err
	}

	// Important!: We need to restore the body so the downstream handler can read it
	req.Body = io.NopCloser(bytes.NewBuffer(reqBody))

	switch operation {
	case "responses":
		return p.processResponsesRequest(reqBody, span)
	case "chat/completions", "completions":
		return p.processChatCompletionsRequest(reqBody, span)
	default:
		return p.processGenericRequest(reqBody, span, operation)
	}
}

// processResponsesRequest handles Responses API requests with proper types
func (p *RequestProcessor) processResponsesRequest(reqBody []byte, span *langwatch.Span) (bool, error) {
	var reqParams responses.ResponseNewParams
	if err := json.Unmarshal(reqBody, &reqParams); err != nil {
		logError("Failed to parse Responses API request body JSON: %v", err)
		// Fall back to generic processing
		return p.processGenericRequest(reqBody, span, "responses")
	}

	// Set request attributes with type safety
	p.setResponsesRequestAttributes(span, reqParams)

	// Check if streaming is requested - need to examine raw JSON for stream field
	// since ResponseNewParams doesn't expose the stream field directly
	var reqData jsonData
	if err := json.Unmarshal(reqBody, &reqData); err == nil {
		isStreaming := getStreamingFlag(reqData)
		p.setStreamingAttribute(span, isStreaming)
		return isStreaming, nil
	}

	// Default to non-streaming if we can't parse the raw JSON
	p.setStreamingAttribute(span, false)
	return false, nil
}

// processChatCompletionsRequest handles Chat Completions API requests with proper types
func (p *RequestProcessor) processChatCompletionsRequest(reqBody []byte, span *langwatch.Span) (bool, error) {
	var reqParams openai.ChatCompletionNewParams
	if err := json.Unmarshal(reqBody, &reqParams); err != nil {
		logError("Failed to parse Chat Completions request body JSON: %v", err)
		// Fall back to generic processing
		return p.processGenericRequest(reqBody, span, "chat/completions")
	}

	p.setChatCompletionsRequestAttributes(span, reqParams)

	// Check if streaming is requested - need to examine raw JSON for stream field
	var reqData jsonData
	if err := json.Unmarshal(reqBody, &reqData); err == nil {
		isStreaming := getStreamingFlag(reqData)
		p.setStreamingAttribute(span, isStreaming)
		return isStreaming, nil
	}

	p.setStreamingAttribute(span, false)
	return false, nil
}

// processGenericRequest falls back to generic JSON processing for unknown endpoints
func (p *RequestProcessor) processGenericRequest(reqBody []byte, span *langwatch.Span, operation string) (bool, error) {
	// Try to parse with known types first based on operation
	switch operation {
	case "responses":
		return p.processResponsesRequest(reqBody, span)
	case "chat/completions", "chat", "completions":
		return p.processChatCompletionsRequest(reqBody, span)
	}

	// For truly unknown operations, use generic parsing
	var reqData jsonData
	if err := json.Unmarshal(reqBody, &reqData); err != nil {
		logError("Failed to parse OpenAI request body JSON: %v", err)
		return false, err
	}

	if p.recordInput {
		span.RecordInput(reqBody)
	}

	p.setCommonRequestAttributes(span, reqData, operation)

	isStreaming := getStreamingFlag(reqData)
	p.setStreamingAttribute(span, isStreaming)

	return isStreaming, nil
}

// setCommonRequestAttributes sets attributes common to all OpenAI operations
func (p *RequestProcessor) setCommonRequestAttributes(span *langwatch.Span, reqData jsonData, operation string) {
	if model, ok := getString(reqData, "model"); ok {
		span.SetRequestModel(model)
		span.SetName(fmt.Sprintf("openai.%s.%s", operation, model))
	}
	if temp, ok := getFloat64(reqData, "temperature"); ok {
		span.SetAttributes(semconv.GenAIRequestTemperature(temp))
	}
	if topP, ok := getFloat64(reqData, "top_p"); ok {
		span.SetAttributes(semconv.GenAIRequestTopP(topP))
	}
	if topK, ok := getFloat64(reqData, "top_k"); ok {
		span.SetAttributes(semconv.GenAIRequestTopK(topK))
	}
	if freqPenalty, ok := getFloat64(reqData, "frequency_penalty"); ok {
		span.SetAttributes(semconv.GenAIRequestFrequencyPenalty(freqPenalty))
	}
	if presPenalty, ok := getFloat64(reqData, "presence_penalty"); ok {
		span.SetAttributes(semconv.GenAIRequestPresencePenalty(presPenalty))
	}
	if maxTokens, ok := getInt(reqData, "max_tokens"); ok {
		span.SetAttributes(semconv.GenAIRequestMaxTokens(maxTokens))
	}
}

// setStreamingAttribute sets the streaming attribute on the span
func (p *RequestProcessor) setStreamingAttribute(span *langwatch.Span, isStreaming bool) {
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(isStreaming))
}

// setResponsesRequestAttributes sets attributes specific to Responses API requests using proper types
func (p *RequestProcessor) setResponsesRequestAttributes(span *langwatch.Span, reqParams responses.ResponseNewParams) {
	span.SetRequestModel(string(reqParams.Model))
	span.SetName(fmt.Sprintf("openai.responses.%s", string(reqParams.Model)))

	if reqParams.Instructions.Valid() && reqParams.Instructions.Value != "" && p.recordInput {
		span.RecordInput(map[string]any{"instructions": reqParams.Instructions.Value})
	}

	if reqParams.MaxOutputTokens.Valid() && reqParams.MaxOutputTokens.Value > 0 {
		span.SetAttributes(attribute.Int("gen_ai.request.max_output_tokens", int(reqParams.MaxOutputTokens.Value)))
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

	if reqParams.Metadata != nil {
		setJSONAttribute(span, "gen_ai.request.metadata", reqParams.Metadata)
	}

	if len(reqParams.Tools) > 0 {
		setJSONAttribute(span, "gen_ai.request.tools", reqParams.Tools)
	}

	// Handle tool_choice if present
	setJSONAttribute(span, "gen_ai.request.tool_choice", reqParams.ToolChoice)
}

// setChatCompletionsRequestAttributes sets attributes specific to Chat Completions API requests using proper types
func (p *RequestProcessor) setChatCompletionsRequestAttributes(span *langwatch.Span, reqParams openai.ChatCompletionNewParams) {
	// Set model info (required field, direct type)
	span.SetRequestModel(string(reqParams.Model))
	span.SetName(fmt.Sprintf("openai.completions.%s", string(reqParams.Model)))

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

	if len(reqParams.Messages) > 0 && p.recordInput {
		span.RecordInput(reqParams.Messages)
	}

	if len(reqParams.Tools) > 0 {
		setJSONAttribute(span, "gen_ai.request.tools", reqParams.Tools)
	}
}
