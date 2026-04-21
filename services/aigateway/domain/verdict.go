package domain

// BudgetVerdict is the outcome of a budget precheck.
type BudgetVerdict int

const (
	BudgetAllow BudgetVerdict = iota
	BudgetWarn
	BudgetBlock
)

// GuardrailAction is the guardrail decision.
type GuardrailAction int

const (
	GuardrailAllow GuardrailAction = iota
	GuardrailBlock
	GuardrailModify
)

// GuardrailVerdict is the outcome of a guardrail evaluation.
type GuardrailVerdict struct {
	Action  GuardrailAction
	Message string
}

// CacheDecision is the result of cache rule evaluation.
type CacheDecision struct {
	Action CacheAction
	RuleID string
}

// AITraceParams holds data for a customer AI trace.
type AITraceParams struct {
	ProjectID   string
	Model       string
	ProviderID  ProviderID
	Usage       Usage
	DurationMS  int64
	Streaming   bool
	RequestType RequestType
}
