package scenario

import "context"

// ScenarioEvaluator attaches one LangWatch evaluator to a scenario run. The
// evaluators package runs them; the core only carries the declaration.
type ScenarioEvaluator struct {
	// Evaluator is a built-in type ("ragas/sql_query_equivalence") or a saved
	// evaluator ("evaluators/<slug>").
	Evaluator string
	// Required makes a failing verdict fail the scenario. Nil defaults to true
	// for pass/fail evaluators and false for score-only ones.
	Required *bool
	// Mappings say where each evaluator input reads from: a literal string,
	// number or bool, or a MappingFunc.
	Mappings map[string]any
	// Settings override the evaluator settings for this run.
	Settings map[string]any
}

// MappingFunc reads an evaluator input from the scenario state. Returning
// nil skips the evaluator; an error reports an error result.
type MappingFunc func(ctx context.Context, state *ExecutionState) (any, error)

// EvaluationStatus is the outcome of one evaluator.
type EvaluationStatus string

// Evaluation statuses.
const (
	EvaluationPassed  EvaluationStatus = "passed"
	EvaluationFailed  EvaluationStatus = "failed"
	EvaluationScored  EvaluationStatus = "scored"
	EvaluationSkipped EvaluationStatus = "skipped"
	EvaluationError   EvaluationStatus = "error"
)

// Money is a cost.
type Money struct {
	Currency string  `json:"currency"`
	Amount   float64 `json:"amount"`
}

// EvaluationResult is the result of one evaluator. Its JSON matches the
// results.evaluations entries of the run finished event.
type EvaluationResult struct {
	EvaluatorID string            `json:"evaluatorId"`
	Name        string            `json:"name"`
	Status      EvaluationStatus  `json:"status"`
	Required    bool              `json:"required"`
	Passed      *bool             `json:"passed,omitempty"`
	Score       *float64          `json:"score,omitempty"`
	Label       string            `json:"label,omitempty"`
	Details     string            `json:"details,omitempty"`
	Cost        *Money            `json:"cost,omitempty"`
	Inputs      map[string]string `json:"inputs,omitempty"`
}

// EvaluatorRunner runs a scenario's evaluators once it has a verdict. It
// sets result.Evaluations and, when a required evaluator fails, fails the
// result. Errors are logged and leave the verdict standing.
type EvaluatorRunner interface {
	RunEvaluators(ctx context.Context, ex *Executor, evaluators []ScenarioEvaluator, result *ScenarioResult) error
}
