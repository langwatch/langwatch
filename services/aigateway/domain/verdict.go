package domain

import "strconv"

// BudgetVerdict is the outcome of a budget precheck.
type BudgetVerdict int

const (
	BudgetAllow BudgetVerdict = iota
	BudgetWarn
	BudgetBlock
)

// BudgetWarning names one budget scope that is close enough to its limit for
// the caller to be told about it while the request still goes through.
type BudgetWarning struct {
	// Scope is the budget's scope kind: org, team, project, virtual_key,
	// principal, group.
	Scope string
	// ProviderKey is the ModelProvider row id the budget is filtered to,
	// empty for budgets that count every provider. Carried so the warning
	// names WHICH budget is running out when several share a scope kind.
	ProviderKey string
	// PctUsed is the share of the limit already spent, truncated to a whole
	// percent.
	PctUsed int
}

// String renders the warning in the wire shape the X-LangWatch-Budget-Warning
// header carries: "<scope>:<pct>", e.g. "project:95". A provider-filtered
// budget qualifies the scope segment as "<scope>/<modelProviderId>" (e.g.
// "project/mp_01H:95"); the pct still sits after the only colon, so clients
// splitting on ":" keep parsing.
func (w BudgetWarning) String() string {
	scope := w.Scope
	if w.ProviderKey != "" {
		scope += "/" + w.ProviderKey
	}
	return scope + ":" + strconv.Itoa(w.PctUsed)
}

// ExcludedProvider is one provider removed from a request's candidate chain
// because a provider-filtered blocking budget on it is out of money, paired
// with that budget so an emptied chain can name what emptied it.
type ExcludedProvider struct {
	// ProviderKey is the ModelProvider row id dispatch must not use.
	ProviderKey string
	// Budget is the exhausted budget that excluded the provider.
	Budget BudgetScope
}

// BudgetDecision is the outcome of a budget precheck: whether the request may
// proceed, plus the scopes worth warning the caller about. Warnings are only
// meaningful when the verdict is BudgetWarn.
type BudgetDecision struct {
	Verdict  BudgetVerdict
	Warnings []BudgetWarning

	// BlockedBy is the budget that produced a BudgetBlock verdict, so the
	// rejection can name it. Nil unless Verdict is BudgetBlock.
	BlockedBy *BudgetScope

	// ExcludedProviders lists providers that breached provider-filtered
	// blocking budgets. They are removed from the request's candidate chain
	// like unavailable providers (contract §4.6): the request still goes
	// through when another candidate remains, and blocks naming the budget
	// only when the chain empties.
	ExcludedProviders []ExcludedProvider
}

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

	// FailedOpen marks an allow the gateway could not actually justify: the
	// evaluation did not complete and the traffic passed unchecked. Only the
	// stream-chunk direction reports one, because it is the direction that
	// swallows its own error by design so a slow policy service never stalls a
	// stream. Without this flag that allow is indistinguishable from a
	// guardrail that genuinely passed the content, which is exactly the kind
	// of invisible non-enforcement this changeset exists to remove.
	FailedOpen bool
	// FailOpenReason is why the evaluation could not complete. Empty unless
	// FailedOpen is set. Operator-facing, so it goes on the span rather than
	// into a metric label, where an unbounded value would explode cardinality.
	FailOpenReason string
}

// CacheDecision is the result of cache rule evaluation.
type CacheDecision struct {
	Action CacheAction
	RuleID string
}

// AITraceParams holds data for a customer AI trace.
type AITraceParams struct {
	ProjectID  string
	Model      string
	ProviderID ProviderID
	// InternalModel and InternalProviderID are safe to copy to LangWatch's
	// operational span because they came from manager-owned gateway config.
	// Model and ProviderID above remain customer-trace fields: callers can
	// control them when a virtual key permits arbitrary model names.
	InternalModel      string
	InternalProviderID ProviderID
	Usage              Usage
	RequestType        RequestType

	// RequestedModel is the model name the client sent, when a routing policy
	// rewrote it into Model. Empty when the caller got what they asked for.
	// Customer-controlled, like Model, so it stays off the internal span.
	RequestedModel string

	// VirtualKeyID is the id of the VK that authorized this request. Stamped
	// on the customer span so the control plane's trace-processing pipeline
	// can fold per-budget spend back into ClickHouse idempotently.
	VirtualKeyID string

	// GatewayRequestID is the per-request ULID issued by the gateway. Acts as
	// the idempotency key for the CH-fold debit row; replays collapse on the
	// ReplacingMergeTree's (TenantId, BudgetId, GatewayRequestId) ORDER BY.
	GatewayRequestID string

	// ModelProviderID is the ModelProvider row id of the provider the request
	// was actually dispatched to (the credential that served it, or the last
	// one tried when every attempt failed). Stamped on the customer span as
	// langwatch.model_provider_id so the control plane's trace fold can debit
	// provider-filtered budgets; without it those budgets never accrue.
	// Empty when nothing was dispatched, in which case the fold debits
	// unfiltered budgets only. Contract §4.5.
	ModelProviderID string

	// VKTags are the VK's operator-assigned tags, stamped on the customer
	// span as langwatch.labels so the trace pipeline ingests them into
	// metadata.labels — the field the Trace Explorer filters as "Label".
	VKTags []string

	// RequestBody and ResponseBody are the raw JSON bodies for input/output
	// extraction. Either may be nil (e.g. streaming responses).
	RequestBody  []byte
	ResponseBody []byte

	// UpstreamStatusCode is the provider's terminal HTTP status when the
	// request failed upstream (0 on success). Stamped on the customer span so
	// the trace surfaces the failure instead of being silently dropped.
	UpstreamStatusCode int

	// UpstreamErrorType is a short error-class token (e.g. provider_timeout,
	// bad_request) recorded as the span's error.type when the request failed.
	UpstreamErrorType string

	// MirrorTier is the ADR-061 mirror fidelity resolved for this VK's
	// organization ("content" | "structural" | "skip" | ""), materialized into
	// the bundle by the control plane. Non-skip only for Langy virtual keys, so
	// ordinary customer traffic is never mirrored. content ⇒ the gateway emits a
	// SECOND gen_ai span (with prompt/completion) into the mirror project;
	// structural ⇒ the same span with content stripped; skip/"" ⇒ nothing.
	MirrorTier string
	// MirrorSourceOrgID is the customer organization the mirrored call belongs
	// to, stamped on the mirror copy for per-customer attribution (ADR-061 §5).
	MirrorSourceOrgID string
}
