package pipeline

import (
	"context"
	"fmt"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// BudgetPrecheckFunc checks whether the request is within budget.
type BudgetPrecheckFunc func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetDecision, error)

// Budget creates an interceptor that prechecks budget before dispatch.
// Cost recording is NOT done here — the trace-fold subscriber on the control
// plane folds OTel span usage attributes into the ClickHouse budget ledger.
//
// Provider-filtered budgets (contract §4.6) do not block here: their breach
// is recorded on the Call as an excluded provider, the terminal dispatch
// subtracts those providers from the candidate chain like unavailable ones,
// and only an emptied chain turns into a budget error, built by
// BudgetBreachError in both places so the two rejections cannot drift apart.
func Budget(precheck BudgetPrecheckFunc, logger *zap.Logger) Interceptor {
	pre := func(ctx context.Context, call *Call) error {
		// Attributed-user templates enforce per end user, so the checker
		// needs the request's resolved id; body-derived ids are stashed on
		// the context so the checker and the spend admission read the SAME
		// resolution. Fail-closed check runs before the (possibly cached
		// and fetch-dependent) spend read: a template on the bundle plus no
		// id is already a rejection, whatever the buckets say.
		if hasPerUserTemplate(call.Bundle) {
			endUser := ResolveEndUser(ctx, call)
			if endUser == "" {
				return EndUserRequiredError(ctx)
			}
			ctx = customertracebridge.WithEndUserID(ctx, endUser)
		}
		decision, err := precheck(ctx, call.Bundle)
		if err != nil {
			logger.Warn("budget_precheck_error", zap.Error(err))
			return nil
		}
		call.BudgetExcludedProviders = decision.ExcludedProviders
		switch decision.Verdict {
		case domain.BudgetAllow:
			// No action needed.
		case domain.BudgetBlock:
			var blocked domain.BudgetScope
			if decision.BlockedBy != nil {
				blocked = *decision.BlockedBy
			}
			return BudgetBreachError(ctx, blocked)
		case domain.BudgetWarn:
			call.Meta.Update(func(m *Meta) {
				for _, warning := range decision.Warnings {
					m.BudgetWarnings = append(m.BudgetWarnings, warning.String())
				}
			})
		}
		return nil
	}

	return Interceptor{
		Name: "budget",
		Sync: func(next DispatchFunc) DispatchFunc {
			return func(ctx context.Context, call *Call) (*domain.Response, error) {
				if err := pre(ctx, call); err != nil {
					return nil, err
				}
				return next(ctx, call)
			}
		},
		Stream: func(next StreamFunc) StreamFunc {
			return func(ctx context.Context, call *Call) (domain.StreamIterator, error) {
				if err := pre(ctx, call); err != nil {
					return nil, err
				}
				return next(ctx, call)
			}
		},
	}
}

func hasPerUserTemplate(bundle *domain.Bundle) bool {
	if bundle == nil {
		return false
	}
	for i := range bundle.Config.Budget.Scopes {
		s := &bundle.Config.Budget.Scopes[i]
		if s.PerUser && s.LimitMicroUSD > 0 {
			return true
		}
	}
	return false
}

// EndUserRequiredError is the fail-closed rejection for requests on a key
// whose bundle carries an attributed-user template but which arrived with
// no end-user id anywhere we resolve one. The message names both accepted
// wire fields so the fix is actionable from the error alone.
func EndUserRequiredError(ctx context.Context) error {
	return herr.New(ctx, domain.ErrEndUserRequired, herr.M{
		"message":  "This key enforces a per-end-user budget, and the request carried no end-user id. Send the OpenAI `user` field or the X-LangWatch-End-User-Id header.",
		"tips":     []string{"Set `user` in the request body (ai-sdk: the `user` option)", "Or send X-LangWatch-End-User-Id (X-Litellm-End-User-Id is accepted as an alias)"},
		"docs_url": "https://docs.langwatch.ai/ai-gateway/budgets",
		"fault":    "customer",
	})
}

// BudgetBreachError builds the 402 a request rejected on budget receives,
// naming the budget that ran out so the caller knows WHICH allowance to raise
// rather than guessing among org, team, project, key, person and group
// budgets. Used by the budget interceptor for plain blocks and by the
// dispatcher when provider-filtered exclusions empty the candidate chain:
// one constructor so the two paths stay the same error. Avoids credit/billing
// wording so generic agent clients render it verbatim instead of overlaying
// their own billing UI.
func BudgetBreachError(ctx context.Context, budget domain.BudgetScope) error {
	meta := herr.M{
		"message":  budgetBreachMessage(budget),
		"tips":     budgetBreachTips(budget),
		"docs_url": "https://docs.langwatch.ai/ai-gateway/budgets",
		"fault":    "customer",
	}
	if budget.ID != "" {
		meta["budget_id"] = budget.ID
	}
	if budget.Scope != "" {
		meta["budget_scope"] = budget.Scope
	}
	if budget.Window != "" {
		meta["budget_window"] = budget.Window
	}
	if budget.ProviderKey != "" {
		meta["budget_provider"] = budget.ProviderKey
	}
	return herr.New(ctx, domain.ErrBudgetExceeded, meta)
}

// budgetBreachMessage names the budget in admin-actionable copy. A zero-value
// budget (a checker that could not say which scope blocked) falls back to the
// generic organization-level line rather than printing empty placeholders.
func budgetBreachMessage(budget domain.BudgetScope) string {
	if budget.Scope == "" {
		return "Your organization's AI gateway spending limit has been reached. Contact your LangWatch admin to raise it."
	}
	target := budgetScopeNoun(budget.Scope)
	// A scope without a window would render "(per )"; drop the clause
	// rather than print an empty placeholder in customer-facing copy.
	if budget.Window == "" {
		if budget.ProviderKey != "" {
			return fmt.Sprintf(
				"The %s spending limit covering provider %s has been reached, and no other provider can serve this request. Contact your LangWatch admin to raise it.",
				target, budget.ProviderKey,
			)
		}
		return fmt.Sprintf(
			"The %s spending limit for this request has been reached. Contact your LangWatch admin to raise it.",
			target,
		)
	}
	if budget.ProviderKey != "" {
		return fmt.Sprintf(
			"The %s spending limit (per %s) covering provider %s has been reached, and no other provider can serve this request. Contact your LangWatch admin to raise it.",
			target, budget.Window, budget.ProviderKey,
		)
	}
	return fmt.Sprintf(
		"The %s spending limit (per %s) for this request has been reached. Contact your LangWatch admin to raise it.",
		target, budget.Window,
	)
}

func budgetBreachTips(budget domain.BudgetScope) []string {
	var raise string
	if budget.Scope == "" {
		raise = "Contact your LangWatch admin to raise the organization's spending limit"
	} else {
		raise = "Contact your LangWatch admin to raise the " + budgetScopeNoun(budget.Scope) + " spending limit"
	}
	if budget.ProviderKey != "" {
		return []string{
			raise,
			"Request a model served by a provider this key can still reach",
		}
	}
	return []string{
		raise,
		"Switch to a cheaper model or reduce request volume to stay within the limit",
	}
}

// budgetScopeNoun renders a wire scope kind as the word the error copy uses.
func budgetScopeNoun(scope string) string {
	switch scope {
	case "organization":
		return "organization"
	case "team":
		return "team"
	case "project":
		return "project"
	case "virtual_key":
		return "virtual key"
	case "principal":
		return "personal"
	case "group":
		return "group member"
	case "attributed_user":
		return "end-user"
	default:
		return scope
	}
}
