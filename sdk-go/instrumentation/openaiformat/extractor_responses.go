package openaiformat

import (
	"encoding/json"
	"strings"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// ResponsesExtractor handles the Responses API (/v1/responses). Discriminators:
// the request carries an `input` (a string or an array of input items) plus
// optional `instructions`, and has NO messages[]; the response object is
// "response". Unlike chat completions, the Responses stream is a sequence of
// typed events with no [DONE] sentinel.
//
// The wire format is OpenAI's JSON, read directly into local structs (mirroring
// the chat extractor) rather than via any client's typed Responses structs.
type ResponsesExtractor struct{}

func (ResponsesExtractor) Name() string { return "responses" }

func (ResponsesExtractor) MatchesRequest(body otelhttp.JSONObject, pathHint string) bool {
	// Embeddings also carry `input` but no `instructions`/`max_output_tokens`,
	// so require a Responses-distinctive field alongside `input`, or the path.
	if strings.Contains(pathHint, "responses") {
		return true
	}
	if _, hasMessages := body["messages"]; hasMessages {
		return false
	}
	if !otelhttp.HasKey(body, "input") {
		return false
	}
	return otelhttp.HasKey(body, "instructions") ||
		otelhttp.HasKey(body, "max_output_tokens") ||
		otelhttp.HasKey(body, "reasoning") ||
		otelhttp.HasKey(body, "previous_response_id")
}

func (ResponsesExtractor) MatchesResponse(objectField, contentType string) bool {
	if strings.HasPrefix(contentType, "text/event-stream") {
		return false // streaming dispatch is decided from the request shape
	}
	return objectField == "response"
}

// responsesRequest is the subset of an OpenAI Responses API request we read.
// Input/Tools/ToolChoice are kept raw so the structured wire shapes are
// preserved without depending on any typed union.
type responsesRequest struct {
	Model             string          `json:"model"`
	MaxOutputTokens   *int            `json:"max_output_tokens"`
	Temperature       *float64        `json:"temperature"`
	TopP              *float64        `json:"top_p"`
	ParallelToolCalls *bool           `json:"parallel_tool_calls"`
	Instructions      *string         `json:"instructions"`
	Input             json.RawMessage `json:"input"`
	Tools             json.RawMessage `json:"tools"`
	ToolChoice        json.RawMessage `json:"tool_choice"`
	Reasoning         *struct {
		Effort string `json:"effort"`
	} `json:"reasoning"`
	Stream bool `json:"stream"`
}

func (ResponsesExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	var req responsesRequest
	if err := json.Unmarshal(raw, &req); err != nil {
		return GenericExtractor{}.ExtractRequest(span, raw, capture)
	}

	span.SetRequestModel(req.Model)
	span.SetName("responses." + req.Model)

	reqParams := langwatch.GenAIRequestParams{}
	if req.MaxOutputTokens != nil {
		reqParams.MaxTokens = req.MaxOutputTokens
	}
	if req.Temperature != nil {
		reqParams.Temperature = req.Temperature
	}
	if req.TopP != nil {
		reqParams.TopP = req.TopP
	}
	if req.Reasoning != nil && req.Reasoning.Effort != "" {
		reqParams.ReasoningEffort = req.Reasoning.Effort
	}
	span.SetGenAIRequestParams(reqParams)

	if req.ParallelToolCalls != nil {
		span.SetAttributes(attribute.Bool("gen_ai.request.parallel_tool_calls", *req.ParallelToolCalls))
	}
	if len(req.Tools) > 0 {
		otelhttp.SetJSONAttribute(span, string(langwatch.AttributeGenAIRequestTools), req.Tools)
	}
	// tool_choice is only recorded when the user actually set it (the key is
	// present in the request body); its absence must not record a bogus value.
	if len(req.ToolChoice) > 0 {
		recordToolChoice(span, req.ToolChoice)
	}

	if capture.CaptureInput() {
		// The Responses "instructions" field is the system prompt; record it as
		// gen_ai.system_instructions (input content, gated by capture).
		if req.Instructions != nil && *req.Instructions != "" {
			span.SetGenAISystemInstructions(*req.Instructions)
		}
		recordResponsesInput(span, req.Input)
	}

	return req.Stream
}

// recordToolChoice records the raw tool_choice value, decoding it first so a
// JSON string ("auto"/"none"/…) is passed through unencoded and a structured
// choice is recorded as JSON — matching SetJSONAttribute's string passthrough.
func recordToolChoice(span *langwatch.Span, raw json.RawMessage) {
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return
	}
	otelhttp.SetJSONAttribute(span, "gen_ai.request.tool_choice", decoded)
}

func (ResponsesExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	var resp responsesResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		GenericExtractor{}.ExtractNonStreaming(span, raw, capture)
		return
	}
	recordResponsesResult(span, resp, capture)
}

func (ResponsesExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &responsesStreamAccumulator{}
}

// recordResponsesInput records the request input. A string input is a user
// message and is recorded as a gen_ai input message; an array of input items is
// recorded as JSON so the structured items are preserved.
func recordResponsesInput(span *langwatch.Span, raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var input any
	if err := json.Unmarshal(raw, &input); err != nil {
		return
	}
	switch v := input.(type) {
	case string:
		if v != "" {
			span.SetGenAIInputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleUser, v)})
		}
	case nil:
		// no input
	default:
		span.SetInputJSON(input)
	}
}

// responsesResponse is the subset of an OpenAI Responses API response we read.
type responsesResponse struct {
	ID     string                `json:"id"`
	Model  string                `json:"model"`
	Status string                `json:"status"`
	Output []responsesOutputItem `json:"output"`
	Usage  responsesUsagePayload `json:"usage"`
	Error  *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// responsesOutputItem is one item of a Response's output array: a "message" item
// (carrying output_text content parts) or a "function_call" item (a tool call).
type responsesOutputItem struct {
	Type      string `json:"type"`
	ID        string `json:"id"`
	CallID    string `json:"call_id"`
	Name      string `json:"name"`
	Arguments string `json:"arguments"`
	Content   []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

// responsesUsagePayload is the Responses usage block: input/output/total plus the
// cached-input and reasoning-output token details.
type responsesUsagePayload struct {
	InputTokens        int `json:"input_tokens"`
	OutputTokens       int `json:"output_tokens"`
	TotalTokens        int `json:"total_tokens"`
	InputTokensDetails struct {
		CachedTokens int `json:"cached_tokens"`
	} `json:"input_tokens_details"`
	OutputTokensDetails struct {
		ReasoningTokens int `json:"reasoning_tokens"`
	} `json:"output_tokens_details"`
}

// recordResponsesResult records the shared response attributes for both the
// non-streaming body and the streamed response.completed event.
func recordResponsesResult(span *langwatch.Span, resp responsesResponse, capture langwatch.DataCaptureMode) {
	if resp.ID != "" {
		span.SetAttributes(semconv.GenAIResponseID(resp.ID))
	}
	span.SetResponseModel(resp.Model)
	if resp.Status != "" {
		span.SetAttributes(langwatch.AttributeGenAIResponseStatus.String(resp.Status))
		span.SetGenAIResponseFinishReasons(resp.Status)
	}

	span.SetGenAIUsage(resp.Usage.toGenAIUsage())

	if capture.CaptureOutput() {
		// Record the assistant response as gen_ai output messages. When it carries
		// function/tool calls (the common agent case) they are preserved as
		// tool_call parts; otherwise the flattened output text is wrapped in a
		// single assistant message.
		if msgs, ok := responsesOutputMessages(resp); ok {
			span.SetGenAIOutputMessages(msgs)
		} else if text := resp.outputText(); text != "" {
			span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, text)})
		}
	}
}

// toGenAIUsage maps the Responses usage onto the LangWatch helper, leaving
// fields nil (unrecorded) when the wire value is absent / zero.
func (u responsesUsagePayload) toGenAIUsage() langwatch.GenAIUsage {
	usage := langwatch.GenAIUsage{}
	if u.InputTokens > 0 {
		usage.InputTokens = langwatch.Int(u.InputTokens)
	}
	if u.OutputTokens > 0 {
		usage.OutputTokens = langwatch.Int(u.OutputTokens)
	}
	if u.TotalTokens > 0 {
		usage.TotalTokens = langwatch.Int(u.TotalTokens)
	}
	if u.InputTokensDetails.CachedTokens > 0 {
		usage.CachedInputTokens = langwatch.Int(u.InputTokensDetails.CachedTokens)
	}
	if u.OutputTokensDetails.ReasoningTokens > 0 {
		usage.ReasoningTokens = langwatch.Int(u.OutputTokensDetails.ReasoningTokens)
	}
	return usage
}

// outputText concatenates the output_text parts of all message output items,
// mirroring the Responses SDK's Response.OutputText() helper.
func (r responsesResponse) outputText() string {
	var b strings.Builder
	for _, item := range r.Output {
		if item.Type != "message" {
			continue
		}
		b.WriteString(outputItemText(item))
	}
	return b.String()
}

// responsesOutputMessages builds an assistant ChatMessage from a Response's
// output items when any function-call item is present, carrying the function
// calls as tool_call rich-content parts alongside any output text. Returns
// ok=false when there are no tool calls, so the caller keeps the plain-text
// path for pure-text responses.
func responsesOutputMessages(resp responsesResponse) ([]langwatch.ChatMessage, bool) {
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
				Args:       item.Arguments,
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
func responsesCallID(item responsesOutputItem) string {
	if item.CallID != "" {
		return item.CallID
	}
	return item.ID
}

// outputItemText concatenates the output_text parts of a message output item.
func outputItemText(item responsesOutputItem) string {
	var b strings.Builder
	for _, content := range item.Content {
		if content.Type == "output_text" {
			b.WriteString(content.Text)
		}
	}
	return b.String()
}

// responsesStreamAccumulator reconstructs a Responses API stream from typed
// events. It accumulates output_text deltas and, on the terminal
// response.completed event, reads the fully-formed Response (the most reliable
// source of usage, output text and status). The Responses stream has no [DONE]
// sentinel.
type responsesStreamAccumulator struct {
	deltas    strings.Builder
	completed *responsesResponse
	errMsg    string
	errCode   string
}

func (a *responsesStreamAccumulator) IsTerminal(string) bool {
	// The Responses stream ends with a typed response.completed/failed event,
	// not a sentinel line.
	return false
}

// responsesStreamEvent is the subset of a Responses stream event we read. The
// event type discriminates; response.completed/incomplete/failed carry the
// fully-formed Response (as a value, so an absent field yields a zero Response
// exactly as the typed SDK union does), and output_text.delta carries an
// incremental text fragment.
type responsesStreamEvent struct {
	Type     string            `json:"type"`
	Delta    string            `json:"delta"`
	Response responsesResponse `json:"response"`
	Code     string            `json:"code"`
	Message  string            `json:"message"`
}

func (a *responsesStreamAccumulator) Consume(dataLine string) {
	var ev responsesStreamEvent
	if err := json.Unmarshal([]byte(dataLine), &ev); err != nil {
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
		if resp.Error != nil {
			a.errMsg = resp.Error.Message
			a.errCode = resp.Error.Code
		}
	case "error":
		a.errMsg = ev.Message
		a.errCode = ev.Code
	}
}

func (a *responsesStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.completed != nil {
		recordResponsesResult(span, *a.completed, capture)
	}

	// Fall back to the accumulated deltas if the completed event carried no
	// output text (or never arrived).
	if capture.CaptureOutput() && a.deltas.Len() > 0 {
		if a.completed == nil || a.completed.outputText() == "" {
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
