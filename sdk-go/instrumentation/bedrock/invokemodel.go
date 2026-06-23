package bedrock

import (
	"context"
	"encoding/json"
	"time"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// maxInvokeModelBodyBytes caps the size of an InvokeModel request/response body
// recorded as span content. Image/audio models embed large base64 blobs in the
// body; recording those verbatim bloats spans, so bodies over this size have
// their content skipped (model id and usage are still recorded). 256 KiB
// comfortably covers text payloads while excluding media blobs.
const maxInvokeModelBodyBytes = 256 * 1024

// invokeModelHandler instruments the low-level InvokeModel operation. The body
// is provider-specific JSON, so request/response content and usage are parsed
// best-effort for the common shapes (Anthropic, Amazon Titan); anything else
// records the model id and the raw body (gated by capture) only.
type invokeModelHandler struct{}

func (invokeModelHandler) operation() string { return "chat" }
func (invokeModelHandler) streaming() bool   { return false }

func (invokeModelHandler) recordRequest(span *langwatch.Span, params any, capture langwatch.DataCaptureMode) {
	input, ok := params.(*bedrockruntimeInvokeModelInput)
	if !ok {
		return
	}
	if model := derefString(input.ModelId); model != "" {
		span.SetRequestModel(model)
		span.SetName(spanNameForModel(model))
	}
	if capture.CaptureInput() && len(input.Body) > 0 && len(input.Body) <= maxInvokeModelBodyBytes {
		span.SetInputRaw(rawJSON(input.Body))
	}
}

func (invokeModelHandler) recordResponse(_ context.Context, span *langwatch.Span, result any, capture langwatch.DataCaptureMode, _ time.Time) bool {
	output, ok := result.(*bedrockruntimeInvokeModelOutput)
	if !ok {
		return false
	}
	if len(output.Body) == 0 {
		return false
	}

	if usage, ok := parseInvokeModelUsage(output.Body); ok {
		span.SetGenAIUsage(usage.genAIUsage())
	}
	if reason := parseInvokeModelStopReason(output.Body); reason != "" {
		span.SetGenAIResponseFinishReasons(reason)
	}
	if capture.CaptureOutput() && len(output.Body) <= maxInvokeModelBodyBytes {
		span.SetOutputRaw(rawJSON(output.Body))
	}
	return false
}

// invokeModelUsage is the union of the common provider usage shapes parsed from
// an InvokeModel response body.
type invokeModelUsage struct {
	inputTokens         *int
	outputTokens        *int
	cacheReadTokens     *int
	cacheCreationTokens *int
}

func (u invokeModelUsage) genAIUsage() langwatch.GenAIUsage {
	usage := langwatch.GenAIUsage{
		InputTokens:              u.inputTokens,
		OutputTokens:             u.outputTokens,
		CachedInputTokens:        u.cacheReadTokens,
		CacheCreationInputTokens: u.cacheCreationTokens,
	}
	// Anthropic does not return a total; synthesize it from input + output +
	// cache tokens (cache-read and cache-creation are real input tokens, so
	// excluding them understates usage).
	if u.inputTokens != nil || u.outputTokens != nil {
		usage.TotalTokens = langwatch.Int(
			deref(u.inputTokens) + deref(u.outputTokens) +
				deref(u.cacheReadTokens) + deref(u.cacheCreationTokens),
		)
	}
	return usage
}

// deref returns the value of a *int, or 0 when nil.
func deref(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

// parseInvokeModelUsage best-effort parses token usage from a provider response
// body. It recognises the Anthropic Messages shape (usage.input_tokens /
// usage.output_tokens) and the Amazon Titan shape (inputTextTokenCount /
// results[].tokenCount). Returns ok=false when no usage is found.
func parseInvokeModelUsage(body []byte) (invokeModelUsage, bool) {
	var probe struct {
		// Anthropic Messages on Bedrock.
		Usage *struct {
			InputTokens              *int `json:"input_tokens"`
			OutputTokens             *int `json:"output_tokens"`
			CacheReadInputTokens     *int `json:"cache_read_input_tokens"`
			CacheCreationInputTokens *int `json:"cache_creation_input_tokens"`
		} `json:"usage"`
		// Amazon Titan text.
		InputTextTokenCount *int `json:"inputTextTokenCount"`
		Results             []struct {
			TokenCount *int `json:"tokenCount"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return invokeModelUsage{}, false
	}

	if probe.Usage != nil && (probe.Usage.InputTokens != nil || probe.Usage.OutputTokens != nil) {
		return invokeModelUsage{
			inputTokens:         probe.Usage.InputTokens,
			outputTokens:        probe.Usage.OutputTokens,
			cacheReadTokens:     probe.Usage.CacheReadInputTokens,
			cacheCreationTokens: probe.Usage.CacheCreationInputTokens,
		}, true
	}

	if probe.InputTextTokenCount != nil || len(probe.Results) > 0 {
		usage := invokeModelUsage{inputTokens: probe.InputTextTokenCount}
		if len(probe.Results) > 0 && probe.Results[0].TokenCount != nil {
			usage.outputTokens = probe.Results[0].TokenCount
		}
		if usage.inputTokens != nil || usage.outputTokens != nil {
			return usage, true
		}
	}

	return invokeModelUsage{}, false
}

// parseInvokeModelStopReason best-effort extracts a finish/stop reason from a
// provider response body (Anthropic stop_reason / Titan results[].completionReason).
func parseInvokeModelStopReason(body []byte) string {
	var probe struct {
		StopReason string `json:"stop_reason"`
		Results    []struct {
			CompletionReason string `json:"completionReason"`
		} `json:"results"`
	}
	if err := json.Unmarshal(body, &probe); err != nil {
		return ""
	}
	if probe.StopReason != "" {
		return probe.StopReason
	}
	if len(probe.Results) > 0 {
		return probe.Results[0].CompletionReason
	}
	return ""
}

// rawJSON returns the body as a json.RawMessage when it is valid JSON (so it is
// recorded structurally), otherwise as a plain string.
func rawJSON(body []byte) any {
	if json.Valid(body) {
		return json.RawMessage(body)
	}
	return string(body)
}
