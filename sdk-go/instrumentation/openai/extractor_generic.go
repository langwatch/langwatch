package openai

import (
	"strings"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// genericExtractor is the terminal fallback in the registry. It records what it
// can from any JSON payload using untyped field probing, so unknown or
// unsupported OpenAI-compatible endpoints still produce a useful span instead of
// regressing to nothing. Its match methods always return true.
type genericExtractor struct{}

func (genericExtractor) name() string { return "openai" }

func (genericExtractor) matchesRequest(map[string]any, string) bool { return true }

func (genericExtractor) matchesResponse(string, string) bool { return true }

func (genericExtractor) extractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	body, ok := parseBody(raw)
	if !ok {
		logError("Failed to parse OpenAI request body JSON for generic extraction")
		return false
	}

	if model, ok := getString(body, "model"); ok {
		span.SetRequestModel(model)
		span.SetName("openai." + model)
	}

	reqParams := langwatch.GenAIRequestParams{}
	if v, ok := getFloat64(body, "temperature"); ok {
		reqParams.Temperature = langwatch.Float64(v)
	}
	if v, ok := getFloat64(body, "top_p"); ok {
		reqParams.TopP = langwatch.Float64(v)
	}
	if v, ok := getFloat64(body, "top_k"); ok {
		reqParams.TopK = langwatch.Float64(v)
	}
	if v, ok := getFloat64(body, "frequency_penalty"); ok {
		reqParams.FrequencyPenalty = langwatch.Float64(v)
	}
	if v, ok := getFloat64(body, "presence_penalty"); ok {
		reqParams.PresencePenalty = langwatch.Float64(v)
	}
	if v, ok := getInt(body, "max_tokens"); ok {
		reqParams.MaxTokens = langwatch.Int(v)
	}
	span.SetGenAIRequestParams(reqParams)

	if capture.CaptureInput() {
		span.SetInputJSON(body)
	}

	streaming := getStreamingFlag(body)
	span.SetAttributes(langwatch.AttributeLangWatchStreaming.Bool(streaming))
	return streaming
}

func (genericExtractor) extractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	body, ok := parseBody(raw)
	if !ok {
		logError("Failed to parse OpenAI response body JSON for generic extraction")
		return
	}

	if id, ok := getString(body, "id"); ok {
		span.SetAttributes(semconv.GenAIResponseID(id))
	}
	if model, ok := getString(body, "model"); ok {
		span.SetResponseModel(model)
	}
	if fp, ok := getString(body, "system_fingerprint"); ok {
		span.SetAttributes(semconv.OpenAIResponseSystemFingerprint(fp))
	}

	if usage, ok := body["usage"].(jsonData); ok {
		genUsage := langwatch.GenAIUsage{}
		if v, ok := getInt(usage, "prompt_tokens"); ok {
			genUsage.InputTokens = langwatch.Int(v)
		}
		if v, ok := getInt(usage, "input_tokens"); ok {
			genUsage.InputTokens = langwatch.Int(v)
		}
		if v, ok := getInt(usage, "completion_tokens"); ok {
			genUsage.OutputTokens = langwatch.Int(v)
		}
		if v, ok := getInt(usage, "output_tokens"); ok {
			genUsage.OutputTokens = langwatch.Int(v)
		}
		if v, ok := getInt(usage, "total_tokens"); ok {
			genUsage.TotalTokens = langwatch.Int(v)
		}
		span.SetGenAIUsage(genUsage)
	}

	if choices, ok := body["choices"].([]any); ok {
		var finishReasons []string
		for _, choiceRaw := range choices {
			if choice, ok := choiceRaw.(jsonData); ok {
				if reason, ok := getString(choice, "finish_reason"); ok {
					finishReasons = append(finishReasons, reason)
				}
			}
		}
		span.SetGenAIResponseFinishReasons(finishReasons...)
	}

	if status, ok := getString(body, "status"); ok {
		span.SetAttributes(attribute.String("gen_ai.response.status", status))
	}

	if capture.CaptureOutput() {
		span.SetOutputJSON(body)
	}
}

func (genericExtractor) newStreamAccumulator() streamAccumulator {
	return &genericStreamAccumulator{}
}

// genericStreamAccumulator reconstructs an unknown SSE stream by best-effort
// probing of each event. It handles both the chat-completion delta shape
// (choices[].delta.content, terminated by [DONE]) and is tolerant of other
// payloads. This preserves the pre-registry fallback behaviour for endpoints no
// typed extractor claimed.
type genericStreamAccumulator struct {
	id                string
	model             string
	systemFingerprint string
	finishReasons     []string
	output            strings.Builder
	usage             langwatch.GenAIUsage
}

func (a *genericStreamAccumulator) isTerminal(dataLine string) bool {
	return dataLine == "[DONE]"
}

func (a *genericStreamAccumulator) consume(dataLine string) {
	event, ok := parseBody([]byte(dataLine))
	if !ok {
		logError("Failed to parse generic stream event JSON. Data: %s", dataLine)
		return
	}

	if id, ok := getString(event, "id"); ok && a.id == "" {
		a.id = id
	}
	if model, ok := getString(event, "model"); ok && a.model == "" {
		a.model = model
	}
	if fp, ok := getString(event, "system_fingerprint"); ok && a.systemFingerprint == "" {
		a.systemFingerprint = fp
	}

	if choices, ok := event["choices"].([]any); ok {
		for _, choiceRaw := range choices {
			choice, ok := choiceRaw.(jsonData)
			if !ok {
				continue
			}
			if reason, ok := getString(choice, "finish_reason"); ok && reason != "" {
				a.finishReasons = append(a.finishReasons, reason)
			}
			if delta, ok := choice["delta"].(jsonData); ok {
				if content, ok := getString(delta, "content"); ok {
					a.output.WriteString(content)
				}
			}
		}
	}

	if usage, ok := event["usage"].(jsonData); ok {
		if v, ok := getInt(usage, "prompt_tokens"); ok {
			a.usage.InputTokens = langwatch.Int(v)
		}
		if v, ok := getInt(usage, "completion_tokens"); ok {
			a.usage.OutputTokens = langwatch.Int(v)
		}
		if v, ok := getInt(usage, "total_tokens"); ok {
			a.usage.TotalTokens = langwatch.Int(v)
		}
	}
}

func (a *genericStreamAccumulator) finish(span *langwatch.Span, capture langwatch.DataCaptureMode) {
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
		span.SetGenAIOutputMessages([]langwatch.ChatMessage{langwatch.TextMessage(langwatch.ChatRoleAssistant, a.output.String())})
	}
}
