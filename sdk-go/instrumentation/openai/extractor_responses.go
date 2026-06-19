package openai

import (
	"encoding/json"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/openai/openai-go/v3/packages/param"
	"github.com/openai/openai-go/v3/responses"
)

// responsesExtractor handles the Responses API (/v1/responses). Discriminators:
// the request carries an `input` (a string or an array of input items) plus
// optional `instructions`, and has NO messages[]; the response object is
// "response". Unlike chat completions, the Responses stream is a sequence of
// typed events (responses.ResponseStreamEventUnion) with no [DONE] sentinel.
type responsesExtractor struct{}

func (responsesExtractor) name() string { return "responses" }

func (responsesExtractor) matchesRequest(body map[string]any, pathHint string) bool {
	// Embeddings also carry `input` but no `instructions`/`max_output_tokens`,
	// so require a Responses-distinctive field alongside `input`, or the path.
	if strings.Contains(pathHint, "responses") {
		return true
	}
	if _, hasMessages := body["messages"]; hasMessages {
		return false
	}
	if !hasKey(body, "input") {
		return false
	}
	return hasKey(body, "instructions") ||
		hasKey(body, "max_output_tokens") ||
		hasKey(body, "reasoning") ||
		hasKey(body, "previous_response_id")
}

func (responsesExtractor) matchesResponse(objectField, contentType string) bool {
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false // streaming dispatch is decided from the request shape
	}
	return objectField == "response"
}

func (responsesExtractor) extractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var params responses.ResponseNewParams
	if err := json.Unmarshal(raw, &params); err != nil {
		logError("Failed to parse Responses API request body JSON: %v", err)
		return genericExtractor{}.extractRequest(span, raw, capture)
	}

	span.SetRequestModel(string(params.Model))
	span.SetName("responses." + string(params.Model))

	reqParams := langwatch.GenAIRequestParams{}
	if params.MaxOutputTokens.Valid() {
		reqParams.MaxTokens = langwatch.Int(int(params.MaxOutputTokens.Value))
	}
	if params.Temperature.Valid() {
		reqParams.Temperature = langwatch.Float64(params.Temperature.Value)
	}
	if params.TopP.Valid() {
		reqParams.TopP = langwatch.Float64(params.TopP.Value)
	}
	if effort := string(params.Reasoning.Effort); effort != "" {
		reqParams.ReasoningEffort = effort
	}
	span.SetGenAIRequestParams(reqParams)

	if params.ParallelToolCalls.Valid() {
		span.SetAttributes(attribute.Bool("gen_ai.request.parallel_tool_calls", params.ParallelToolCalls.Value))
	}
	if len(params.Tools) > 0 {
		setJSONAttribute(span, "gen_ai.request.tools", params.Tools)
	}
	// tool_choice is a typed union whose zero value still marshals to a
	// non-empty JSON ("null"/{}); only record it when the user actually set it.
	if !param.IsOmitted(params.ToolChoice) {
		setJSONAttribute(span, "gen_ai.request.tool_choice", params.ToolChoice)
	}

	if capture.CaptureInput() {
		// The Responses "instructions" field is the system prompt; record it as
		// gen_ai.system_instructions (input content, gated by capture).
		if params.Instructions.Valid() && params.Instructions.Value != "" {
			span.SetGenAISystemInstructions(params.Instructions.Value)
		}
		recordResponsesInput(span, params, raw)
	}

	streaming := requestStreams(raw)
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(streaming))
	return streaming
}

func (responsesExtractor) extractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp responses.Response
	if err := json.Unmarshal(raw, &resp); err != nil {
		logError("Failed to parse Responses API response body JSON: %v", err)
		genericExtractor{}.extractNonStreaming(span, raw, capture)
		return
	}
	recordResponsesResult(span, resp, capture)
}

func (responsesExtractor) newStreamAccumulator() streamAccumulator {
	return &responsesStreamAccumulator{}
}

// recordResponsesInput records the request input. A string input is a user
// message and is recorded as a gen_ai input message; an array of input items is
// recorded as JSON so the structured items (the previously-dropped array form)
// are preserved. The typed union only populates OfInputItemList for items
// carrying a "type" field, so we fall back to the raw body's `input` field to
// capture any array shape.
func recordResponsesInput(span *langwatch.Span, params responses.ResponseNewParams, raw []byte) {
	if params.Input.OfString.Valid() && params.Input.OfString.Value != "" {
		span.SetGenAIInputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleUser, params.Input.OfString.Value)})
		return
	}
	if len(params.Input.OfInputItemList) > 0 {
		span.SetInputJSON(params.Input.OfInputItemList)
		return
	}
	// Fallback: record whatever the raw `input` field holds (commonly an array
	// of input items the typed union didn't claim).
	if body, ok := parseBody(raw); ok {
		if input, ok := body["input"]; ok && input != nil {
			switch v := input.(type) {
			case string:
				if v != "" {
					span.SetGenAIInputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleUser, v)})
				}
			default:
				span.SetInputJSON(input)
			}
		}
	}
}

// recordResponsesResult records the shared response attributes for both the
// non-streaming body and the streamed response.completed event.
func recordResponsesResult(span *langwatch.Span, resp responses.Response, capture langwatch.DataCaptureMode) {
	if resp.ID != "" {
		span.SetAttributes(semconv.GenAIResponseID(resp.ID))
	}
	span.SetResponseModel(string(resp.Model))
	if resp.Status != "" {
		span.SetAttributes(attribute.String("gen_ai.response.status", string(resp.Status)))
		span.SetGenAIResponseFinishReasons(string(resp.Status))
	}

	span.SetGenAIUsage(responsesUsage(resp.Usage))

	if capture.CaptureOutput() {
		// Record the assistant response as gen_ai output messages. When it carries
		// function/tool calls (the common agent case) they are preserved as
		// tool_call parts; otherwise the flattened output text is wrapped in a
		// single assistant message.
		if msgs, ok := responsesOutputMessages(resp); ok {
			span.SetGenAIOutputMessages(msgs)
		} else if text := resp.OutputText(); text != "" {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, text)})
		}
	}
}

// responsesOutputMessages builds an assistant ChatMessage from a Response's
// output items when any function-call item is present, carrying the function
// calls as tool_call rich-content parts alongside any output text. Returns
// ok=false when there are no tool calls, so the caller keeps the plain-text
// path for pure-text responses.
func responsesOutputMessages(resp responses.Response) ([]langwatch.ChatMessage, bool) {
	var parts []langwatch.ChatRichContent
	var haveToolCall bool

	for _, item := range resp.Output {
		switch item.Type {
		case "function_call":
			haveToolCall = true
			parts = append(parts, langwatch.ChatRichContent{
				Type:       langwatch.ChatContentTypeToolCall,
				ToolName:   item.Name,
				ToolCallID: responsesCallID(item),
				Args:       item.Arguments.OfString,
			})
		case "message":
			if text := outputItemText(item); text != "" {
				parts = append(parts, langwatch.TextPart(text))
			}
		}
	}

	if !haveToolCall {
		return nil, false
	}
	return []langwatch.ChatMessage{{
		Role:    langwatch.ChatRoleAssistant,
		Content: parts,
	}}, true
}

// responsesCallID returns the tool-call identifier for a function-call output
// item, preferring the call_id (used to correlate the function output) and
// falling back to the item id.
func responsesCallID(item responses.ResponseOutputItemUnion) string {
	if item.CallID != "" {
		return item.CallID
	}
	return item.ID
}

// outputItemText concatenates the output_text parts of a message output item.
func outputItemText(item responses.ResponseOutputItemUnion) string {
	var b strings.Builder
	for _, content := range item.Content {
		if content.Type == "output_text" {
			b.WriteString(content.Text)
		}
	}
	return b.String()
}

// responsesUsage maps the Responses usage (input/output/total plus the cached
// input and reasoning output token details) onto the LangWatch helper.
func responsesUsage(u responses.ResponseUsage) langwatch.GenAIUsage {
	usage := langwatch.GenAIUsage{}
	if u.InputTokens > 0 {
		usage.InputTokens = langwatch.Int(int(u.InputTokens))
	}
	if u.OutputTokens > 0 {
		usage.OutputTokens = langwatch.Int(int(u.OutputTokens))
	}
	if u.TotalTokens > 0 {
		usage.TotalTokens = langwatch.Int(int(u.TotalTokens))
	}
	if u.InputTokensDetails.CachedTokens > 0 {
		usage.CachedInputTokens = langwatch.Int(int(u.InputTokensDetails.CachedTokens))
	}
	if u.OutputTokensDetails.ReasoningTokens > 0 {
		usage.ReasoningTokens = langwatch.Int(int(u.OutputTokensDetails.ReasoningTokens))
	}
	return usage
}

// responsesStreamAccumulator reconstructs a Responses API stream from typed
// events. It accumulates output_text deltas and, on the terminal
// response.completed event, reads the fully-formed Response (the most reliable
// source of usage, output text and status). The Responses stream has no [DONE]
// sentinel.
type responsesStreamAccumulator struct {
	deltas    strings.Builder
	completed *responses.Response
	errMsg    string
	errCode   string
}

func (a *responsesStreamAccumulator) isTerminal(string) bool {
	// The Responses stream ends with a typed response.completed/failed event,
	// not a sentinel line.
	return false
}

func (a *responsesStreamAccumulator) consume(dataLine string) {
	var ev responses.ResponseStreamEventUnion
	if err := json.Unmarshal([]byte(dataLine), &ev); err != nil {
		logError("Failed to parse Responses stream event JSON. Error: %v. Data: %s", err, dataLine)
		return
	}

	switch ev.Type {
	case "response.output_text.delta":
		a.deltas.WriteString(ev.Delta)
	case "response.completed", "response.incomplete":
		resp := ev.Response
		a.completed = &resp
	case "response.failed":
		resp := ev.Response
		a.completed = &resp
		a.errMsg = resp.Error.Message
		a.errCode = string(resp.Error.Code)
	case "error":
		a.errMsg = ev.Message
		a.errCode = ev.Code
	}
}

func (a *responsesStreamAccumulator) finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.completed != nil {
		recordResponsesResult(span, *a.completed, capture)
	}

	// Fall back to the accumulated deltas if the completed event carried no
	// output text (or never arrived).
	if capture.CaptureOutput() && a.deltas.Len() > 0 {
		if a.completed == nil || a.completed.OutputText() == "" {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, a.deltas.String())})
		}
	}

	if a.errMsg != "" || a.errCode != "" {
		msg := a.errMsg
		if msg == "" {
			msg = a.errCode
		}
		span.SetStatus(codes.Error, msg)
		if a.errCode != "" {
			span.SetAttributes(attribute.String("error.type", a.errCode))
		}
	}
}
