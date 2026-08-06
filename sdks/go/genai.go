package langwatch

import (
	"go.opentelemetry.io/otel/attribute"

	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"
)

// GenAIRequestParams holds common LLM request parameters, recorded under the
// gen_ai.request.* semantic-convention attributes. These helpers are primarily
// for hand-rolled instrumentation; the OpenAI middleware sets them for you.
// Pointer / non-empty fields gate recording, so unset values are omitted.
type GenAIRequestParams struct {
	Temperature      *float64
	TopP             *float64
	TopK             *float64
	MaxTokens        *int
	FrequencyPenalty *float64
	PresencePenalty  *float64
	Seed             *int
	ChoiceCount      *int
	StopSequences    []string
	// ReasoningEffort is the OpenAI reasoning effort (low|medium|high), recorded
	// under gen_ai.request.reasoning_effort.
	ReasoningEffort string
}

// SetGenAIRequestParams records LLM request parameters as gen_ai.request.* attributes.
func (s *Span) SetGenAIRequestParams(p GenAIRequestParams) *Span {
	var attrs []attribute.KeyValue
	if p.Temperature != nil {
		attrs = append(attrs, semconv.GenAIRequestTemperature(*p.Temperature))
	}
	if p.TopP != nil {
		attrs = append(attrs, semconv.GenAIRequestTopP(*p.TopP))
	}
	if p.TopK != nil {
		attrs = append(attrs, semconv.GenAIRequestTopK(*p.TopK))
	}
	if p.MaxTokens != nil {
		attrs = append(attrs, semconv.GenAIRequestMaxTokens(*p.MaxTokens))
	}
	if p.FrequencyPenalty != nil {
		attrs = append(attrs, semconv.GenAIRequestFrequencyPenalty(*p.FrequencyPenalty))
	}
	if p.PresencePenalty != nil {
		attrs = append(attrs, semconv.GenAIRequestPresencePenalty(*p.PresencePenalty))
	}
	if p.Seed != nil {
		attrs = append(attrs, semconv.GenAIRequestSeed(*p.Seed))
	}
	if p.ChoiceCount != nil {
		attrs = append(attrs, semconv.GenAIRequestChoiceCount(*p.ChoiceCount))
	}
	if len(p.StopSequences) > 0 {
		attrs = append(attrs, semconv.GenAIRequestStopSequences(p.StopSequences...))
	}
	if p.ReasoningEffort != "" {
		attrs = append(attrs, attribute.String("gen_ai.request.reasoning_effort", p.ReasoningEffort))
	}
	if len(attrs) > 0 {
		s.SetAttributes(attrs...)
	}
	return s
}

// GenAIUsage holds LLM token usage, recorded under the gen_ai.usage.* attributes.
// This is the sole token source: every provider instrumentation records token
// counts through here (the langwatch.metrics rollup carries only cost +
// estimated-flag, see SpanMetrics).
type GenAIUsage struct {
	InputTokens              *int
	OutputTokens             *int
	TotalTokens              *int
	CachedInputTokens        *int
	CacheCreationInputTokens *int
	ReasoningTokens          *int
}

// SetGenAIUsage records token usage as gen_ai.usage.* attributes.
func (s *Span) SetGenAIUsage(u GenAIUsage) *Span {
	var attrs []attribute.KeyValue
	if u.InputTokens != nil {
		attrs = append(attrs, semconv.GenAIUsageInputTokens(*u.InputTokens))
	}
	if u.OutputTokens != nil {
		attrs = append(attrs, semconv.GenAIUsageOutputTokens(*u.OutputTokens))
	}
	if u.TotalTokens != nil {
		attrs = append(attrs, attribute.Int("gen_ai.usage.total_tokens", *u.TotalTokens))
	}
	if u.CachedInputTokens != nil {
		attrs = append(attrs, attribute.Int("gen_ai.usage.cached_input_tokens", *u.CachedInputTokens))
	}
	if u.CacheCreationInputTokens != nil {
		attrs = append(attrs, attribute.Int("gen_ai.usage.cache_creation.input_tokens", *u.CacheCreationInputTokens))
	}
	if u.ReasoningTokens != nil {
		attrs = append(attrs, attribute.Int("gen_ai.usage.reasoning.output_tokens", *u.ReasoningTokens))
	}
	if len(attrs) > 0 {
		s.SetAttributes(attrs...)
	}
	return s
}

// SetGenAIOperation records the operation name (gen_ai.operation.name), e.g.
// "chat", "embeddings", "execute_tool".
func (s *Span) SetGenAIOperation(operation string) *Span {
	s.SetAttributes(semconv.GenAIOperationNameKey.String(operation))
	return s
}

// SetGenAIResponseFinishReasons records the response finish reasons
// (gen_ai.response.finish_reasons), e.g. "stop", "length", "tool_calls".
func (s *Span) SetGenAIResponseFinishReasons(reasons ...string) *Span {
	if len(reasons) > 0 {
		s.SetAttributes(semconv.GenAIResponseFinishReasons(reasons...))
	}
	return s
}

// SetGenAIInputMessages records the prompt messages sent to the model in the
// OpenTelemetry GenAI format (gen_ai.input.messages), preserving roles, content
// and tool calls. Use this for LLM spans; SetInput is for arbitrary span input.
func (s *Span) SetGenAIInputMessages(messages []ChatMessage) *Span {
	return s.setJSON(semconv.GenAIInputMessagesKey, messages)
}

// SetGenAIOutputMessages records the model's response messages in the
// OpenTelemetry GenAI format (gen_ai.output.messages), preserving tool calls and
// multi-part content. Use this for LLM spans; SetOutput is for arbitrary output.
func (s *Span) SetGenAIOutputMessages(messages []ChatMessage) *Span {
	return s.setJSON(semconv.GenAIOutputMessagesKey, messages)
}

// SetGenAISystemInstructions records the system prompt (gen_ai.system_instructions).
func (s *Span) SetGenAISystemInstructions(instructions string) *Span {
	if instructions != "" {
		s.SetAttributes(semconv.GenAISystemInstructionsKey.String(instructions))
	}
	return s
}

// SetGenAIRequestStream records whether the request was made in streaming mode
// (gen_ai.request.stream, OTel GenAI semconv v1.41+).
func (s *Span) SetGenAIRequestStream(streaming bool) *Span {
	s.SetAttributes(attribute.Bool("gen_ai.request.stream", streaming))
	return s
}

// SetGenAITimeToFirstChunk records the latency from request to the first streamed
// chunk, in seconds (gen_ai.response.time_to_first_chunk, OTel GenAI semconv
// v1.41+). Meaningful only for streaming responses.
func (s *Span) SetGenAITimeToFirstChunk(seconds float64) *Span {
	s.SetAttributes(attribute.Float64("gen_ai.response.time_to_first_chunk", seconds))
	return s
}
