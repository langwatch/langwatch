package contract

import "context"

// EvaluatorRuntimeAPI is what the transport and, later, the studio's evaluator
// block call. ClusterTopics and AnalyzePII join it in their phases (plan §11).
type EvaluatorRuntimeAPI interface {
	// Evaluate answers one result per entry, in order. A provider failure after
	// a provider call is an entry result with StatusError and the cost so far,
	// never a returned error; returned errors are herr codes from errors.go.
	Evaluate(ctx context.Context, req EvaluateRequest) ([]Result, error)
}
