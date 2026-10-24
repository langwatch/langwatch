package services

import (
	"errors"
	"strings"
	"sync"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/channels"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// OpsSpanAttributes is every key LangWatch's own evaluation span may carry
// (plan §6.2). Nothing the tenant sent or a model returned is among them;
// the canary test pins that.
func OpsSpanAttributes() []attribute.Key {
	return []attribute.Key{
		"langwatch.evaluator.type",
		"langwatch.evaluation.entry_count",
		"langwatch.evaluation.status",
		"langwatch.evaluation.error_code",
		"langwatch.evaluation.cost_usd",
		"gen_ai.request.model",
		"gen_ai.provider.name",
		"gen_ai.usage.input_tokens",
		"gen_ai.usage.output_tokens",
	}
}

// batchStats sums what an evaluation's model calls consumed.
type batchStats struct {
	mu               sync.Mutex
	model            string
	promptTokens     int
	completionTokens int
	costUSD          float64
	costed           bool
}

func (b *batchStats) record(model string, usage channels.Usage, costUSD *float64) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.model = model
	b.promptTokens += usage.PromptTokens
	b.completionTokens += usage.CompletionTokens
	if costUSD != nil {
		b.costUSD += *costUSD
		b.costed = true
	}
}

// opsOutcome is what an evaluation ended with, for the ops span.
type opsOutcome struct {
	entryCount int
	stats      *batchStats
	results    []contract.Result
	err        error
}

// stampOpsSpan stamps the allowlisted attributes and returns the error code
// for the caller's span status. Codes are herr codes or entry error types, never messages.
func stampOpsSpan(span trace.Span, outcome opsOutcome) (errorCode string) {
	span.SetAttributes(attribute.Int("langwatch.evaluation.entry_count", outcome.entryCount))

	stats := outcome.stats
	stats.mu.Lock()
	if stats.model != "" {
		span.SetAttributes(attribute.String("gen_ai.request.model", stats.model))
		if provider, _, found := strings.Cut(stats.model, "/"); found {
			span.SetAttributes(attribute.String("gen_ai.provider.name", provider))
		}
		span.SetAttributes(
			attribute.Int("gen_ai.usage.input_tokens", stats.promptTokens),
			attribute.Int("gen_ai.usage.output_tokens", stats.completionTokens),
		)
	}
	if stats.costed {
		span.SetAttributes(attribute.Float64("langwatch.evaluation.cost_usd", stats.costUSD))
	}
	stats.mu.Unlock()

	status, errorCode := batchStatus(outcome.results, outcome.err)
	span.SetAttributes(attribute.String("langwatch.evaluation.status", status))
	if errorCode != "" {
		span.SetAttributes(attribute.String("langwatch.evaluation.error_code", errorCode))
	}
	return errorCode
}

// batchStatus is error when the call or any entry failed, skipped when every
// entry was skipped, else processed.
func batchStatus(results []contract.Result, err error) (status, errorCode string) {
	if err != nil {
		var handled herr.E
		if errors.As(err, &handled) {
			return string(contract.StatusError), string(handled.Code)
		}
		return string(contract.StatusError), errorTypeEvaluation
	}
	skipped := 0
	for _, result := range results {
		switch result.Status {
		case contract.StatusError:
			errorCode = result.ErrorType
		case contract.StatusSkipped:
			skipped++
		case contract.StatusProcessed:
		}
	}
	switch {
	case errorCode != "":
		return string(contract.StatusError), errorCode
	case len(results) > 0 && skipped == len(results):
		return string(contract.StatusSkipped), ""
	default:
		return string(contract.StatusProcessed), ""
	}
}
