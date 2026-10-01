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
