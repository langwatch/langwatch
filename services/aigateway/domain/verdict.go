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
	RequestType RequestType

	// VirtualKeyID is the id of the VK that authorised this request. Stamped
	// on the customer span so the control plane's trace-processing pipeline
	// can fold per-budget spend back into ClickHouse idempotently.
	VirtualKeyID string

	// GatewayRequestID is the per-request ULID issued by the gateway. Acts as
	// the idempotency key for the CH-fold debit row; replays collapse on the
	// ReplacingMergeTree's (TenantId, BudgetId, GatewayRequestId) ORDER BY.
	GatewayRequestID string

	// RequestBody and ResponseBody are the raw JSON bodies for input/output
	// extraction. Either may be nil (e.g. streaming responses).
	RequestBody  []byte
	ResponseBody []byte
}
