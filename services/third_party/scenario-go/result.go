package scenario

import "time"

// CriterionStatus is how the judge settled one criterion.
type CriterionStatus string

// Criterion statuses. An inconclusive criterion still fails the run.
const (
	CriterionPassed       CriterionStatus = "passed"
	CriterionFailed       CriterionStatus = "failed"
	CriterionInconclusive CriterionStatus = "inconclusive"
)

// CriterionResult is the judge's verdict on one criterion.
type CriterionResult struct {
	// Criterion is the criterion as declared.
	Criterion string `json:"criterion"`
	// Requirement is the criterion restated as a positive requirement.
	Requirement string          `json:"requirement"`
	Status      CriterionStatus `json:"status"`
	// Reasoning is what the judge checked, written before the status.
	Reasoning string `json:"reasoning"`
}

// JudgeResult is a judge verdict.
type JudgeResult struct {
	Success       bool
	Reasoning     string
	MetCriteria   []string
	UnmetCriteria []string
	// InconclusiveCriteria are the criteria the judge could not decide; they
	// are also in UnmetCriteria.
	InconclusiveCriteria []string
	// Criteria holds one verdict per criterion, in declared order.
	Criteria []CriterionResult
}

// ScenarioResult is the outcome of a scenario run.
type ScenarioResult struct {
	RunID    string
	Success  bool
	Messages []Message
	// Reasoning explains the outcome.
	Reasoning     string
	MetCriteria   []string
	UnmetCriteria []string
	// InconclusiveCriteria separates "could not tell" from "judged false";
	// every entry is also in UnmetCriteria.
	InconclusiveCriteria []string
	// Criteria holds the per-criterion verdicts of the judge.
	Criteria []CriterionResult
	// TotalTime is the wall time of the run.
	TotalTime time.Duration
	// AgentTime is the time spent in the agents under test.
	AgentTime time.Duration
	// ReachedMaxTurns is set when the run ended because it hit MaxTurns
	// without a verdict.
	ReachedMaxTurns bool
	// Error is set when the run ended in an error.
	Error string
	// Evaluations holds one result per scenario evaluator.
	Evaluations []EvaluationResult
	// Extensions holds results extensions attach, keyed by extension, for
	// example the voice recording. Read them through the extension package.
	Extensions map[string]any
}

// SetExtension stores an extension result under key.
func (r *ScenarioResult) SetExtension(key string, value any) {
	if r.Extensions == nil {
		r.Extensions = make(map[string]any, 1)
	}
	r.Extensions[key] = value
}
