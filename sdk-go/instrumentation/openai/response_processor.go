package openai

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.30.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/responses"
)

// ResponseProcessor handles OpenAI response processing and attribute extraction
type ResponseProcessor struct {
	recordOutput bool
}

// NewResponseProcessor creates a new response processor
func NewResponseProcessor(recordOutput bool) *ResponseProcessor {
	return &ResponseProcessor{
		recordOutput: recordOutput,
	}
}

// ProcessNonStreamingResponse handles non-streaming response body processing
func (p *ResponseProcessor) ProcessNonStreamingResponse(resp *http.Response, span *langwatch.Span) error {
	if resp.Body == nil || resp.Body == http.NoBody {
		return nil
	}

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		logError("Failed to read non-stream OpenAI response body: %v", err)
		return err
	}

	// Restore the *response* body so the client can read it
	resp.Body = io.NopCloser(bytes.NewBuffer(respBody))

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "application/json") {
		return nil
	}

	// Try to determine response type and use proper typed parsing
	if err := p.processTypedNonStreamingResponse(respBody, span); err != nil {
		// Fall back to generic processing if typed parsing fails
		logError("Typed response parsing failed, falling back to generic: %v", err)
		return p.processFallbackNonStreamingResponse(respBody, span)
	}

	return nil
}

// processTypedNonStreamingResponse attempts to parse using proper OpenAI types
func (p *ResponseProcessor) processTypedNonStreamingResponse(respBody []byte, span *langwatch.Span) error {
	// Try Responses API first
	var responsesResp responses.Response
	if err := json.Unmarshal(respBody, &responsesResp); err == nil && responsesResp.Object == "response" {
		p.setResponsesNonStreamAttributes(span, responsesResp)
		if p.recordOutput {
			span.RecordOutput(responsesResp)
		}
		return nil
	}

	// Try Chat Completion
	var chatResp openai.ChatCompletion
	if err := json.Unmarshal(respBody, &chatResp); err == nil && chatResp.Object == "chat.completion" {
		p.setChatCompletionNonStreamAttributes(span, chatResp)
		if p.recordOutput {
			span.RecordOutput(chatResp)
		}
		return nil
	}

	// If we can't determine the type, return error to fall back to generic processing
	return fmt.Errorf("unable to determine response type")
}

// processFallbackNonStreamingResponse handles responses using the original jsonData approach
func (p *ResponseProcessor) processFallbackNonStreamingResponse(respBody []byte, span *langwatch.Span) error {
	var respData jsonData
	if err := json.Unmarshal(respBody, &respData); err != nil {
		logError("Failed to parse non-stream OpenAI response body JSON: %v", err)
		return err
	}

	p.setNonStreamResponseAttributes(span, respData)

	if p.recordOutput {
		span.RecordOutput(respData)
	}

	return nil
}

// setResponsesNonStreamAttributes sets attributes for Responses API non-streaming responses
func (p *ResponseProcessor) setResponsesNonStreamAttributes(span *langwatch.Span, resp responses.Response) {
	span.SetAttributes(semconv.GenAIResponseID(resp.ID))
	span.SetAttributes(semconv.GenAIResponseModel(string(resp.Model)))

	if resp.Status != "" {
		span.SetAttributes(attribute.String("gen_ai.response.status", string(resp.Status)))
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

	if p.recordOutput && resp.OutputText() != "" {
		span.RecordOutputString(resp.OutputText())
	}
}

// setChatCompletionNonStreamAttributes sets attributes for Chat Completion non-streaming responses
func (p *ResponseProcessor) setChatCompletionNonStreamAttributes(span *langwatch.Span, resp openai.ChatCompletion) {
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
	var outputContent strings.Builder

	for _, choice := range resp.Choices {
		if choice.FinishReason != "" {
			finishReasons = append(finishReasons, string(choice.FinishReason))
		}

		if choice.Message.Content != "" {
			outputContent.WriteString(choice.Message.Content)
		}
	}

	if len(finishReasons) > 0 {
		span.SetAttributes(semconv.GenAIResponseFinishReasons(finishReasons...))
	}

	if p.recordOutput && outputContent.Len() > 0 {
		span.RecordOutputString(outputContent.String())
	}
}

// ProcessStreamingResponse handles streaming response body processing
func (p *ResponseProcessor) ProcessStreamingResponse(originalBody io.ReadCloser, span *langwatch.Span) (io.ReadCloser, error) {
	pr, pw := io.Pipe()

	go func() {
		defer originalBody.Close()
		defer pw.Close()
		defer span.End()

		state := &StreamProcessingState{}
		scanner := bufio.NewScanner(originalBody)

		// Allow up to 1 MiB per SSE line – adjust if needed.
		scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

		for scanner.Scan() {
			lineBytes := scanner.Bytes()
			if _, err := pw.Write(append(lineBytes, '\n')); err != nil {
				logError("Error writing to response pipe: %v", err)
				return
			}

			line := string(lineBytes)
			if strings.HasPrefix(line, "data: ") {
				jsonDataStr := strings.TrimPrefix(line, "data: ")
				if jsonDataStr == "" { // Skip empty data lines (e.g. SSE comments or keep-alives)
					continue
				}
				if jsonDataStr == "[DONE]" { // Stream finished
					break
				}

				var eventData jsonData
				if err := json.Unmarshal([]byte(jsonDataStr), &eventData); err == nil {
					p.setStreamEventAttributes(span, eventData, state)
				} else {
					logError("Failed to parse stream event JSON. Error: %v. Data: %s", err, jsonDataStr)
				}
			}
		}

		if err := scanner.Err(); err != nil {
			logError("Error reading streaming response body: %v", err)
		}

		p.setAggregatedStreamAttributes(span, state)
	}()

	return pr, nil
}

// StreamProcessingState holds variables that are updated during stream processing.
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
	InputRecorded     bool // to ensure input is recorded only once if present in stream
	OutputRecorded    bool // to ensure output is recorded only once if present in stream
}

// setStreamEventAttributes sets attributes on the span based on a single SSE event from OpenAI.
// It updates the StreamProcessingState with data from the event.
func (p *ResponseProcessor) setStreamEventAttributes(span *langwatch.Span, eventData jsonData, state *StreamProcessingState) {
	if id, ok := getString(eventData, "id"); ok && state.ID == "" {
		state.ID = id
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := getString(eventData, "model"); ok && state.Model == "" {
		state.Model = model
		span.SetAttributes(semconv.GenAIResponseModel(model))
	}
	if sysFingerprint, ok := getString(eventData, "system_fingerprint"); ok && state.SystemFingerprint == "" {
		state.SystemFingerprint = sysFingerprint
		span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprint(sysFingerprint))
	}

	if choices, ok := eventData["choices"].([]any); ok {
		for _, choiceRaw := range choices {
			if choice, choiceOk := choiceRaw.(jsonData); choiceOk {
				if reason, reasonOk := getString(choice, "finish_reason"); reasonOk && reason != "" {
					state.FinishReasons = append(state.FinishReasons, reason)
				}
				if delta, deltaOk := choice["delta"].(jsonData); deltaOk {
					if content, contentOk := getString(delta, "content"); contentOk && p.recordOutput {
						state.AccumulatedOutput.WriteString(content)
					}
				}
			}
		}
	}

	if output, ok := eventData["output"]; ok {
		if outputData, outputOk := output.(jsonData); outputOk {
			if content, contentOk := getString(outputData, "content"); contentOk && p.recordOutput {
				state.AccumulatedOutput.WriteString(content)
			}

			if delta, deltaOk := outputData["delta"].(jsonData); deltaOk {
				if content, contentOk := getString(delta, "content"); contentOk && p.recordOutput {
					state.AccumulatedOutput.WriteString(content)
				}
			}
		}
	}

	if status, ok := getString(eventData, "status"); ok {
		span.SetAttributes(attribute.String("gen_ai.response.status", status))
		if status == "completed" || status == "failed" || status == "cancelled" {
			state.FinishReasons = append(state.FinishReasons, status)
		}
	}

	if usage, usageOk := eventData["usage"].(jsonData); usageOk && !state.UsageDataFound {
		if pt, ptOk := getInt(usage, "prompt_tokens"); ptOk {
			state.PromptTokens = pt
			span.SetAttributes(semconv.GenAIUsageInputTokens(pt))
		}
		if ct, ctOk := getInt(usage, "completion_tokens"); ctOk {
			state.CompletionTokens = ct
			span.SetAttributes(semconv.GenAIUsageOutputTokens(ct))
		}
		if rt, rtOk := getInt(usage, "total_tokens"); rtOk {
			state.TotalTokens = rt
		}
		state.UsageDataFound = true
	}
}

// setAggregatedStreamAttributes sets the final attributes on the span after stream processing is complete.
func (p *ResponseProcessor) setAggregatedStreamAttributes(span *langwatch.Span, state *StreamProcessingState) {
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

	if p.recordOutput && state.AccumulatedOutput.Len() > 0 && !state.OutputRecorded {
		span.RecordOutputString(state.AccumulatedOutput.String())
		state.OutputRecorded = true
	}
}

// setNonStreamResponseAttributes extracts attributes from a standard JSON response body.
func (p *ResponseProcessor) setNonStreamResponseAttributes(span *langwatch.Span, respData jsonData) {
	if id, ok := getString(respData, "id"); ok {
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := getString(respData, "model"); ok {
		span.SetAttributes(semconv.GenAIResponseModel(model))
	}
	if sysFingerprint, ok := getString(respData, "system_fingerprint"); ok {
		span.SetAttributes(semconv.GenAIOpenaiResponseSystemFingerprint(sysFingerprint))
	}
	if usage, ok := respData["usage"].(jsonData); ok {
		if promptTokens, ok := getInt(usage, "prompt_tokens"); ok {
			span.SetAttributes(semconv.GenAIUsageInputTokens(promptTokens))
		}
		if completionTokens, ok := getInt(usage, "completion_tokens"); ok {
			span.SetAttributes(semconv.GenAIUsageOutputTokens(completionTokens))
		}
	}

	if choices, ok := respData["choices"].([]any); ok {
		finishReasons := make([]string, 0, len(choices))
		for _, choiceRaw := range choices {
			if choice, ok := choiceRaw.(jsonData); ok {
				if reason, ok := getString(choice, "finish_reason"); ok {
					finishReasons = append(finishReasons, reason)
				}
			}
		}
		if len(finishReasons) > 0 {
			span.SetAttributes(semconv.GenAIResponseFinishReasons(finishReasons...))
		}
	}

	if status, ok := getString(respData, "status"); ok {
		span.SetAttributes(attribute.String("gen_ai.response.status", status))
	}

	if output, ok := respData["output"]; ok {
		if outputData, outputOk := output.(jsonData); outputOk {
			if content, contentOk := getString(outputData, "content"); contentOk {
				span.SetAttributes(attribute.String("gen_ai.response.output_content", content))
			}

			if role, roleOk := getString(outputData, "role"); roleOk {
				span.SetAttributes(attribute.String("gen_ai.response.output_role", role))
			}

			if toolCalls, toolCallsOk := outputData["tool_calls"]; toolCallsOk {
				setJSONAttribute(span, "gen_ai.response.tool_calls", toolCalls)
			}
		}
	}

	if metadata, ok := respData["metadata"]; ok {
		setJSONAttribute(span, "gen_ai.response.metadata", metadata)
	}
}
