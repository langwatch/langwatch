package channels

import (
	"context"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// CustomerTraceChannel exports the tenant's own evaluation, content included,
// into the tenant's project (plan §6.1). With no traceparent or no token it
// exports nothing; an export failure never fails the evaluation.
type CustomerTraceChannel interface {
	// StartEvaluation opens the evaluation span. The returned context carries
	// it (framework trace context only) so StartCall parents under it.
	StartEvaluation(ctx context.Context, ev EvaluationSpan) (context.Context, func(EvaluationOutcome))
	// StartCall opens one model-call span under the evaluation span.
	StartCall(ctx context.Context, call CallSpan) func(CallOutcome)
}

// EvaluationSpan names the evaluation being traced.
type EvaluationSpan struct {
	Tenant    contract.Tenant
	Evaluator string
	Trace     contract.TraceRequest
}

// EvaluationOutcome closes the evaluation span.
type EvaluationOutcome struct {
	Results []contract.Result
}

// CallSpan names one model call.
type CallSpan struct {
	Kind  string // "chat" or "embeddings"
	Model string
}

// CallOutcome closes a call span with what the customer sees: the bodies.
type CallOutcome struct {
	RequestBody  []byte
	ResponseBody []byte
	Usage        Usage
	CostUSD      *float64
	Err          error
}
