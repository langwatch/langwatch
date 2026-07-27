package budget

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func bundleWithScopes(scopes ...domain.BudgetScope) *domain.Bundle {
	return &domain.Bundle{
		VirtualKeyID: "vk-test",
		Config:       domain.BundleConfig{Budget: domain.BudgetConfig{Scopes: scopes}},
	}
}

func checker() *Checker {
	return NewChecker(CheckerOptions{Logger: zap.NewNop()})
}

func usd(v float64) int64 { return int64(v * 1_000_000) }

// An exhausted unfiltered blocking budget rejects the request outright, and
// the decision names the budget so the 402 can say which allowance ran out.
func TestPrecheck_UnfilteredBreachBlocksAndNamesTheBudget(t *testing.T) {
	decision, err := checker().Precheck(context.Background(), bundleWithScopes(domain.BudgetScope{
		ID: "gb_1", Scope: "project", ScopeID: "proj_1", Window: "month",
		LimitMicroUSD: usd(100), SpentMicroUSD: usd(100), OnBreach: "block",
	}))
	require.NoError(t, err)
	assert.Equal(t, domain.BudgetBlock, decision.Verdict)
	require.NotNil(t, decision.BlockedBy)
	assert.Equal(t, "gb_1", decision.BlockedBy.ID)
	assert.Equal(t, "project", decision.BlockedBy.Scope)
	assert.Empty(t, decision.ExcludedProviders)
}

// A provider-filtered budget constrains one vendor, not the request: its
// breach excludes the provider from the candidate chain instead of blocking,
// and still surfaces as a warning so the caller hears the vendor ran out even
// while another one serves.
func TestPrecheck_FilteredBreachExcludesTheProviderInsteadOfBlocking(t *testing.T) {
	decision, err := checker().Precheck(context.Background(), bundleWithScopes(domain.BudgetScope{
		ID: "gb_openai", Scope: "virtual_key", ScopeID: "vk-test|provider:mp_openai",
		ProviderKey: "mp_openai", Window: "day",
		LimitMicroUSD: usd(25), SpentMicroUSD: usd(25), OnBreach: "block",
	}))
	require.NoError(t, err)
	assert.Equal(t, domain.BudgetWarn, decision.Verdict,
		"the request itself may proceed; the exhausted vendor becomes a warning")
	require.Len(t, decision.ExcludedProviders, 1)
	assert.Equal(t, "mp_openai", decision.ExcludedProviders[0].ProviderKey)
	assert.Equal(t, "gb_openai", decision.ExcludedProviders[0].Budget.ID)
	assert.Nil(t, decision.BlockedBy)
	require.Len(t, decision.Warnings, 1)
	assert.Equal(t, "virtual_key/mp_openai:100", decision.Warnings[0].String())
}

// on_breach warn keeps its meaning on filtered budgets: over the limit is a
// warning, never an exclusion, so the provider keeps serving.
func TestPrecheck_FilteredWarnBudgetNeverExcludes(t *testing.T) {
	decision, err := checker().Precheck(context.Background(), bundleWithScopes(domain.BudgetScope{
		ID: "gb_warn", Scope: "project", ScopeID: "proj_1|provider:mp_openai",
		ProviderKey: "mp_openai", Window: "month",
		LimitMicroUSD: usd(10), SpentMicroUSD: usd(12), OnBreach: "warn",
	}))
	require.NoError(t, err)
	assert.Equal(t, domain.BudgetWarn, decision.Verdict)
	assert.Empty(t, decision.ExcludedProviders)
	require.Len(t, decision.Warnings, 1)
	assert.Equal(t, "project/mp_openai:120", decision.Warnings[0].String())
}

// A filtered breach on one provider must not stop an unfiltered budget from
// blocking: the plain block wins because the request has no funded path.
func TestPrecheck_UnfilteredBlockStillWinsOverExclusions(t *testing.T) {
	decision, err := checker().Precheck(context.Background(), bundleWithScopes(
		domain.BudgetScope{
			ID: "gb_openai", Scope: "virtual_key", ProviderKey: "mp_openai",
			Window: "day", LimitMicroUSD: usd(5), SpentMicroUSD: usd(5), OnBreach: "block",
		},
		domain.BudgetScope{
			ID: "gb_org", Scope: "organization", Window: "month",
			LimitMicroUSD: usd(100), SpentMicroUSD: usd(101), OnBreach: "block",
		},
	))
	require.NoError(t, err)
	assert.Equal(t, domain.BudgetBlock, decision.Verdict)
	require.NotNil(t, decision.BlockedBy)
	assert.Equal(t, "gb_org", decision.BlockedBy.ID)
}

// A group (GROUP-scoped) budget arrives as one bucket per member, with the
// key's principal already resolved by the control plane. Each bucket
// enforces alone: the member whose bucket is spent is blocked while another
// member of the same group, same budget row, keeps going.
func TestPrecheck_GroupBucketsEnforcePerMember(t *testing.T) {
	spent := bundleWithScopes(domain.BudgetScope{
		ID: "gb_dept", Scope: "group", ScopeID: "grp_eng:user_a", PrincipalID: "user_a",
		Window: "month", LimitMicroUSD: usd(50), SpentMicroUSD: usd(50), OnBreach: "block",
	})
	fresh := bundleWithScopes(domain.BudgetScope{
		ID: "gb_dept", Scope: "group", ScopeID: "grp_eng:user_b", PrincipalID: "user_b",
		Window: "month", LimitMicroUSD: usd(50), SpentMicroUSD: usd(3), OnBreach: "block",
	})

	blocked, err := checker().Precheck(context.Background(), spent)
	require.NoError(t, err)
	assert.Equal(t, domain.BudgetBlock, blocked.Verdict)
	require.NotNil(t, blocked.BlockedBy)
	assert.Equal(t, "grp_eng:user_a", blocked.BlockedBy.ScopeID)
	assert.Equal(t, "user_a", blocked.BlockedBy.PrincipalID)

	allowed, err := checker().Precheck(context.Background(), fresh)
	require.NoError(t, err)
	assert.Equal(t, domain.BudgetAllow, allowed.Verdict,
		"the same budget row must not leak one member's spend onto another")
}

// Warnings on approach keep working for every dimension, and the header
// shape stays "<scope>:<pct>" for unfiltered budgets.
func TestPrecheck_UnfilteredWarningShapeIsUnchanged(t *testing.T) {
	decision, err := checker().Precheck(context.Background(), bundleWithScopes(domain.BudgetScope{
		ID: "gb_1", Scope: "team", Window: "month",
		LimitMicroUSD: usd(100), SpentMicroUSD: usd(85), OnBreach: "block",
	}))
	require.NoError(t, err)
	assert.Equal(t, domain.BudgetWarn, decision.Verdict)
	require.Len(t, decision.Warnings, 1)
	assert.Equal(t, "team:85", decision.Warnings[0].String())
}
