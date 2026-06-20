package ollama

import (
	"go.opentelemetry.io/otel/attribute"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// metricsPayload is the subset of Ollama's response metrics block shared by the
// chat, generate and embed shapes. Ollama reports prompt_eval_count (input
// tokens) and eval_count (output tokens); there is no server-supplied total, so
// we derive it as the sum. Durations are nanoseconds (Go time.Duration on the
// wire), recorded as seconds.
type metricsPayload struct {
	TotalDuration      int64 `json:"total_duration"`
	LoadDuration       int64 `json:"load_duration"`
	PromptEvalCount    int   `json:"prompt_eval_count"`
	PromptEvalDuration int64 `json:"prompt_eval_duration"`
	EvalCount          int   `json:"eval_count"`
	EvalDuration       int64 `json:"eval_duration"`
}

// hasUsage reports whether any token count was present.
func (m metricsPayload) hasUsage() bool {
	return m.PromptEvalCount > 0 || m.EvalCount > 0
}

// toGenAIUsage maps Ollama token counts onto the LangWatch GenAIUsage helper,
// leaving fields nil (unrecorded) when the wire value is absent / zero. Total =
// prompt_eval_count + eval_count, since Ollama supplies no total of its own.
func (m metricsPayload) toGenAIUsage() langwatch.GenAIUsage {
	usage := langwatch.GenAIUsage{}
	if m.PromptEvalCount > 0 {
		usage.InputTokens = langwatch.Int(m.PromptEvalCount)
	}
	if m.EvalCount > 0 {
		usage.OutputTokens = langwatch.Int(m.EvalCount)
	}
	if m.PromptEvalCount > 0 || m.EvalCount > 0 {
		usage.TotalTokens = langwatch.Int(m.PromptEvalCount + m.EvalCount)
	}
	return usage
}

// recordUsage records Ollama's token usage as gen_ai.usage.* attributes (via
// SetGenAIUsage), the sole token source, then records the server-side phase
// durations. Token recording is skipped entirely when no counts were present, so
// a partial / streaming-interrupted response does not stamp zeros.
func recordUsage(span *langwatch.Span, m metricsPayload) {
	if m.hasUsage() {
		span.SetGenAIUsage(m.toGenAIUsage())
	}
	recordDurations(span, m)
}

const nanosPerSecond = 1e9

// recordDurations records Ollama's nanosecond phase-timing fields as langwatch.*
// attributes for finer-grained latency analysis. The total request duration is
// omitted (the span's own duration already covers it); only the distinct
// load / prompt-eval / eval phase latencies are recorded.
func recordDurations(span *langwatch.Span, m metricsPayload) {
	var attrs []attribute.KeyValue
	if m.LoadDuration > 0 {
		attrs = append(attrs, attribute.Float64("langwatch.ollama.load_duration", float64(m.LoadDuration)/nanosPerSecond))
	}
	if m.PromptEvalDuration > 0 {
		attrs = append(attrs, attribute.Float64("langwatch.ollama.prompt_eval_duration", float64(m.PromptEvalDuration)/nanosPerSecond))
	}
	if m.EvalDuration > 0 {
		attrs = append(attrs, attribute.Float64("langwatch.ollama.eval_duration", float64(m.EvalDuration)/nanosPerSecond))
	}
	if len(attrs) > 0 {
		span.SetAttributes(attrs...)
	}
}
