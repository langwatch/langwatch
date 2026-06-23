package openaiformat

import (
	"strings"

	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
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

	if usage, ok := body["usage"].(otelhttp.JSONObject); ok {
		genUsage := langwatch.GenAIUsage{}
		if v, ok := otelhttp.GetInt(usage, "prompt_tokens"); ok {
			genUsage.InputTokens = langwatch.Int(v)
		}
		if v, ok := otelhttp.GetInt(usage, "input_tokens"); ok {
			genUsage.InputTokens = langwatch.Int(v)
		}
		if v, ok := otelhttp.GetInt(usage, "completion_tokens"); ok {
			genUsage.OutputTokens = langwatch.Int(v)
		}
		if v, ok := otelhttp.GetInt(usage, "output_tokens"); ok {
			genUsage.OutputTokens = langwatch.Int(v)
		}
		if v, ok := otelhttp.GetInt(usage, "total_tokens"); ok {
			genUsage.TotalTokens = langwatch.Int(v)
		}
		span.SetGenAIUsage(genUsage)
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

	if usage, ok := event["usage"].(otelhttp.JSONObject); ok {
		if v, ok := otelhttp.GetInt(usage, "prompt_tokens"); ok {
			a.usage.InputTokens = langwatch.Int(v)
		}
		if v, ok := otelhttp.GetInt(usage, "completion_tokens"); ok {
			a.usage.OutputTokens = langwatch.Int(v)
		}
		if v, ok := otelhttp.GetInt(usage, "total_tokens"); ok {
			a.usage.TotalTokens = langwatch.Int(v)
		}
	}
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
