package contract

import "context"

// EvaluatorRuntimeAPI is what the transport and, later, the studio's evaluator
// block call. AnalyzePII joins it in its phase (plan §11).
type EvaluatorRuntimeAPI interface {
	// Evaluate answers one result per entry, in order. A provider failure after
	// a provider call is an entry result with StatusError and the cost so far,
	// never a returned error; returned errors are herr codes from errors.go.
	Evaluate(ctx context.Context, req EvaluateRequest) ([]Result, error)
	// ClusterTopics runs one batch or incremental topic clustering; returned
	// errors are ErrTopicClusteringFailed or ErrTopicClusteringTooFewTraces.
	ClusterTopics(ctx context.Context, req TopicClusteringRequest) (TopicClusteringResult, error)
}
