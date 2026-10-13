package openaiformat

import (
	"encoding/json"
	"strings"

	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/langwatch/langwatch/sdks/go/instrumentation/otelhttp"
)

// GenericExtractor is the terminal fallback in the registry. It records what it
// can from any JSON payload using untyped field probing, so unknown or
// unsupported OpenAI-compatible endpoints still produce a useful span instead of
// regressing to nothing. Its match methods always return true.
type GenericExtractor struct{}

func (GenericExtractor) Name() string { return "openai" }

func (GenericExtractor) MatchesRequest(otelhttp.JSONObject, string) bool { return true }

func (GenericExtractor) MatchesResponse(string, string) bool { return true }

func (GenericExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	body, ok := otelhttp.ParseBody(raw)
	if !ok {
		return false
	}

	if model, ok := otelhttp.GetString(body, "model"); ok {
		span.SetRequestModel(model)
		span.SetName("openai." + model)
	}

	reqParams := langwatch.GenAIRequestParams{}
	if v, ok := otelhttp.GetFloat64(body, "temperature"); ok {
		reqParams.Temperature = langwatch.Float64(v)
	}
	if v, ok := otelhttp.GetFloat64(body, "top_p"); ok {
		reqParams.TopP = langwatch.Float64(v)
	}
	if v, ok := otelhttp.GetFloat64(body, "top_k"); ok {
		reqParams.TopK = langwatch.Float64(v)
	}
	if v, ok := otelhttp.GetFloat64(body, "frequency_penalty"); ok {
		reqParams.FrequencyPenalty = langwatch.Float64(v)
	}
	if v, ok := otelhttp.GetFloat64(body, "presence_penalty"); ok {
		reqParams.PresencePenalty = langwatch.Float64(v)
	}
	if v, ok := otelhttp.GetInt(body, "max_tokens"); ok {
		reqParams.MaxTokens = langwatch.Int(v)
	}
	span.SetGenAIRequestParams(reqParams)

	if capture.CaptureInput() {
		span.SetInputJSON(body)
	}

	return otelhttp.RequestStreams(raw)
}

func (GenericExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	body, ok := otelhttp.ParseBody(raw)
	if !ok {
		return
	}

	if id, ok := otelhttp.GetString(body, "id"); ok {
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := otelhttp.GetString(body, "model"); ok {
		span.SetResponseModel(model)
	}
	if fp, ok := otelhttp.GetString(body, "system_fingerprint"); ok {
		span.SetAttributes(semconv.OpenAIResponseSystemFingerprint(fp))
	}

	if usage := decodeUsage(raw); usage != nil {
		recordUsage(span, usage)
	}

	if choices, ok := body["choices"].([]any); ok {
		var finishReasons []string
		for _, choiceRaw := range choices {
			if choice, ok := choiceRaw.(otelhttp.JSONObject); ok {
				if reason, ok := otelhttp.GetString(choice, "finish_reason"); ok {
					finishReasons = append(finishReasons, reason)
				}
			}
		}
		span.SetGenAIResponseFinishReasons(finishReasons...)
	}

	if status, ok := otelhttp.GetString(body, "status"); ok {
		span.SetAttributes(langwatch.AttributeGenAIResponseStatus.String(status))
	}

	if capture.CaptureOutput() {
		span.SetOutputJSON(body)
	}
}

func (GenericExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &genericStreamAccumulator{}
}

// genericStreamAccumulator reconstructs an unknown SSE stream by best-effort
// probing of each event. It handles the chat-completion delta shape
// (choices[].delta.content, terminated by [DONE]) and is tolerant of other
// payloads, so endpoints no typed extractor claimed still produce a useful span.
type genericStreamAccumulator struct {
	id                string
	model             string
	systemFingerprint string
	finishReasons     []string
	output            strings.Builder
	usage             langwatch.GenAIUsage
}

func (a *genericStreamAccumulator) IsTerminal(dataLine string) bool {
	return dataLine == "[DONE]"
}

func (a *genericStreamAccumulator) Consume(dataLine string) {
	event, ok := otelhttp.ParseBody([]byte(dataLine))
	if !ok {
		return
	}

	if id, ok := otelhttp.GetString(event, "id"); ok && a.id == "" {
		a.id = id
	}
	if model, ok := otelhttp.GetString(event, "model"); ok && a.model == "" {
		a.model = model
	}
	if fp, ok := otelhttp.GetString(event, "system_fingerprint"); ok && a.systemFingerprint == "" {
		a.systemFingerprint = fp
	}

	if choices, ok := event["choices"].([]any); ok {
		for _, choiceRaw := range choices {
			choice, ok := choiceRaw.(otelhttp.JSONObject)
			if !ok {
				continue
			}
			if reason, ok := otelhttp.GetString(choice, "finish_reason"); ok && reason != "" {
				a.finishReasons = append(a.finishReasons, reason)
			}
			if delta, ok := choice["delta"].(otelhttp.JSONObject); ok {
				if content, ok := otelhttp.GetString(delta, "content"); ok {
					a.output.WriteString(content)
				}
			}
		}
	}

	if usage := decodeUsage([]byte(dataLine)); usage != nil {
		mergeUsage(&a.usage, usage)
	}
}

// decodeUsage reads a body's usage block in either OpenAI spelling
// (prompt/completion or Responses input/output) into the chat shape, so the
// fallback shares toGenAIUsage/mergeUsage and their exclusive cached split.
// A malformed field is skipped; nil means the body carries no usage object.
func decodeUsage(raw []byte) *usagePayload {
	var body struct {
		Usage json.RawMessage `json:"usage"`
	}
	if json.Unmarshal(raw, &body) != nil || len(body.Usage) == 0 || body.Usage[0] != '{' {
		return nil
	}
	var usage usagePayload
	_ = json.Unmarshal(body.Usage, &usage)
	var responses responsesUsagePayload
	_ = json.Unmarshal(body.Usage, &responses)
	if responses.InputTokens > 0 || responses.OutputTokens > 0 {
		usage.PromptTokens = responses.InputTokens
		usage.CompletionTokens = responses.OutputTokens
		usage.PromptTokensDetails.CachedTokens = responses.InputTokensDetails.CachedTokens
		usage.CompletionTokensDetails.ReasoningTokens = responses.OutputTokensDetails.ReasoningTokens
	}
	return &usage
}

func (a *genericStreamAccumulator) Finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
	if a.id != "" {
		span.SetAttributes(semconv.GenAIResponseID(a.id))
	}
	if a.model != "" {
		span.SetResponseModel(a.model)
	}
	if a.systemFingerprint != "" {
		span.SetAttributes(semconv.OpenAIResponseSystemFingerprint(a.systemFingerprint))
	}
	span.SetGenAIResponseFinishReasons(dedupe(a.finishReasons)...)
	span.SetGenAIUsage(a.usage)

	if capture.CaptureOutput() && a.output.Len() > 0 {
		// The accumulator only reconstructs chat-completion delta content
		// (choices[].delta.content), so the assembled text is a chat-shaped
		// assistant message; record it in the gen_ai-native format.
		span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, a.output.String())})
	}
}
