package app

import (
	"bytes"
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/budget"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// These tests drive the full dispatch pipeline (real budget checker, real
// interceptor chain, mock provider) to pin contract §4.6: a provider-filtered
// budget constrains one vendor, not the request. Breaching it removes that
// provider from the candidate chain like an unavailable provider; the request
// blocks only when nothing is left, and the block names the budget.

func usd(v float64) int64 { return int64(v * 1_000_000) }

// twoProviderBundle is a key that can reach two ModelProvider rows able to
// serve the same models, primary first.
func twoProviderBundle() *domain.Bundle {
	b := testBundle(
		domain.Credential{ID: "mp_primary", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		domain.Credential{ID: "mp_secondary", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
	)
	b.Config.Fallback.MaxAttempts = 2
	return b
}

func filteredBudget(id, providerKey string, onBreach string, limit, spent float64) domain.BudgetScope {
	return domain.BudgetScope{
		ID: id, Scope: "virtual_key", ScopeID: "vk-test|provider:" + providerKey,
		ProviderKey: providerKey, Window: "day",
		LimitMicroUSD: usd(limit), SpentMicroUSD: usd(spent), OnBreach: onBreach,
	}
}

func appWithRealBudget(provider *mockProvider, traces *mockTraces) *App {
	opts := []Option{
		WithProviders(provider),
		WithModels(&mockModels{}),
		WithBudget(budget.NewChecker(budget.CheckerOptions{Logger: zap.NewNop()})),
		WithLogger(zap.NewNop()),
	}
	if traces != nil {
		opts = append(opts, WithTraces(traces))
	}
	return New(opts...)
}

// @scenario "A breached provider-filtered budget takes that provider out of the running"
func TestDispatch_FilteredBreachRoutesAroundTheProvider(t *testing.T) {
	var dialed []string
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			dialed = append(dialed, cred.ID)
			return successResponse(), nil
		},
	}
	bundle := twoProviderBundle()
	bundle.Config.Budget.Scopes = []domain.BudgetScope{
		filteredBudget("gb_primary", "mp_primary", "block", 25, 25),
	}

	result, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.NoError(t, err, "with somewhere else to go, a filtered breach must not refuse the call")
	assert.Equal(t, []string{"mp_secondary"}, dialed,
		"the provider with the exhausted budget must not be dialed at all")
	// The exhausted vendor is still worth telling the caller about while
	// another one serves.
	assert.Contains(t, result.Meta.BudgetWarnings, "virtual_key/mp_primary:100")
}

// @scenario "A request with nowhere left to go is refused and says why"
func TestDispatch_FilteredBreachWithNoAlternativeBlocksNamingTheBudget(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			t.Fatal("no provider may be dialed when every candidate sits behind an exhausted budget")
			return nil, nil
		},
	}
	bundle := testBundle(domain.Credential{ID: "mp_only", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"})
	bundle.Config.Budget.Scopes = []domain.BudgetScope{
		filteredBudget("gb_only", "mp_only", "block", 25, 26),
	}

	_, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBudgetExceeded))
	var e herr.E
	require.ErrorAs(t, err, &e)
	assert.Equal(t, "gb_only", e.Meta["budget_id"], "the refusal must name the budget that ran out")
	assert.Equal(t, "mp_only", e.Meta["budget_provider"])
	assert.Contains(t, e.Meta["message"], "mp_only",
		"the message must say which provider's allowance emptied the chain")
}

// @scenario "A warning-only provider budget lets the provider keep serving"
func TestDispatch_FilteredWarnBudgetStillServes(t *testing.T) {
	var dialed []string
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			dialed = append(dialed, cred.ID)
			return successResponse(), nil
		},
	}
	bundle := testBundle(domain.Credential{ID: "mp_only", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"})
	bundle.Config.Budget.Scopes = []domain.BudgetScope{
		filteredBudget("gb_warnonly", "mp_only", "warn", 10, 12),
	}

	result, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.NoError(t, err)
	assert.Equal(t, []string{"mp_only"}, dialed)
	assert.Contains(t, result.Meta.BudgetWarnings, "virtual_key/mp_only:120",
		"the warning must name the provider-filtered budget that is over")
}

// With routing mode "none" the candidate chain is length one, so a filtered
// breach on that one provider degenerates to a plain block (contract §4.6).
func TestDispatch_RoutingNoneFilteredBreachIsAPlainBlock(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			t.Fatal("provider must not be dialed")
			return nil, nil
		},
	}
	bundle := testBundle(domain.Credential{ID: "mp_only", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"})
	bundle.Config.RoutingMode = domain.RoutingModeNone
	bundle.Config.Fallback.MaxAttempts = 1
	bundle.Config.Budget.Scopes = []domain.BudgetScope{
		filteredBudget("gb_only", "mp_only", "block", 5, 5),
	}

	_, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBudgetExceeded))
}

// An unfiltered breached budget blocks as it always did, whatever providers
// the chain holds, and the 402 now names its scope.
func TestDispatch_UnfilteredBreachStillBlocksOutright(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			t.Fatal("provider must not be dialed")
			return nil, nil
		},
	}
	bundle := twoProviderBundle()
	bundle.Config.Budget.Scopes = []domain.BudgetScope{{
		ID: "gb_project", Scope: "project", ScopeID: "proj-test", Window: "month",
		LimitMicroUSD: usd(100), SpentMicroUSD: usd(100), OnBreach: "block",
	}}

	_, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBudgetExceeded))
	var e herr.E
	require.ErrorAs(t, err, &e)
	assert.Equal(t, "gb_project", e.Meta["budget_id"])
	assert.Contains(t, e.Meta["message"], "project")
}

// A group (GROUP-scoped) budget arrives as one bucket per member, principal
// already resolved into the bundle. The member whose bucket is spent is
// blocked; a different member on the same budget row keeps working, because
// the buckets are independent.
func TestDispatch_GroupBucketsAreIndependentPerMember(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	groupScope := func(member string, spent float64) domain.BudgetScope {
		return domain.BudgetScope{
			ID: "gb_dept", Scope: "group", ScopeID: "grp_eng:" + member, PrincipalID: member,
			Window: "month", LimitMicroUSD: usd(50), SpentMicroUSD: usd(spent), OnBreach: "block",
		}
	}

	blockedBundle := testBundle()
	blockedBundle.Config.Budget.Scopes = []domain.BudgetScope{groupScope("user_a", 50)}
	_, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), blockedBundle, bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBudgetExceeded))

	freshBundle := testBundle()
	freshBundle.Config.Budget.Scopes = []domain.BudgetScope{groupScope("user_b", 1)}
	_, err = appWithRealBudget(provider, nil).HandleChat(
		context.Background(), freshBundle, bytes.NewReader(testBody()), "gpt-4")
	require.NoError(t, err,
		"one member exhausting their allowance must not block another member's bucket")
}

// @scenario "Spend is attributed to the provider that actually served the request"
func TestDispatch_TraceCarriesTheServingProviderID(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(ctx context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			if cred.ID == "mp_primary" {
				return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"message": "down"})
			}
			return successResponse(), nil
		},
	}
	traces := &mockTraces{}
	bundle := twoProviderBundle()

	result, err := appWithRealBudget(provider, traces).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.NoError(t, err)
	assert.Equal(t, "mp_secondary", traces.lastParams.ModelProviderID,
		"the span must carry the ModelProvider row id that SERVED the call, not the one that was asked first")
	assert.Equal(t, "mp_secondary", result.Meta.DispatchedProviderID)
}

// When every attempt fails, the span still records the provider that was
// last dispatched to, so a failed call's debit (if any cost accrued) lands
// on the vendor that actually saw the request.
func TestDispatch_TraceCarriesTheLastDialedProviderOnFailure(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return nil, &domain.UpstreamError{StatusCode: 503, Message: "down"}
		},
	}
	traces := &mockTraces{}
	bundle := testBundle(domain.Credential{ID: "mp_only", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"})
	bundle.Config.Fallback.MaxAttempts = 1

	_, err := appWithRealBudget(provider, traces).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.Error(t, err)
	assert.Equal(t, "mp_only", traces.lastParams.ModelProviderID)
}

// A request the budget interceptor blocks before dispatch reports no
// provider: nothing was dialed, and claiming one would attribute spend to a
// vendor that never saw the request.
func TestDispatch_NoProviderReportedWhenNothingWasDispatched(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			t.Fatal("provider must not be dialed")
			return nil, nil
		},
	}
	traces := &mockTraces{}
	bundle := testBundle()
	bundle.Config.Budget.Scopes = []domain.BudgetScope{{
		ID: "gb_org", Scope: "organization", Window: "month",
		LimitMicroUSD: usd(10), SpentMicroUSD: usd(10), OnBreach: "block",
	}}

	_, err := appWithRealBudget(provider, traces).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.Error(t, err)
	assert.Empty(t, traces.lastParams.ModelProviderID)
}

// @scenario "A key with no fallback surfaces the provider's failure"
func TestDispatch_NoFallbackSurfacesProviderFailure(t *testing.T) {
	var dialed []string
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			dialed = append(dialed, cred.ID)
			return nil, &domain.UpstreamError{StatusCode: 503, Message: "openai is down"}
		},
	}
	// The bundle still carries two credentials; routing mode "none" arrives
	// as max_attempts 1, and that alone must keep the second one cold.
	bundle := twoProviderBundle()
	bundle.Config.RoutingMode = domain.RoutingModeNone
	bundle.Config.Fallback.MaxAttempts = 1

	_, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.Error(t, err, "a no-fallback key must fail, not hang and not fake a success")
	assert.Equal(t, []string{"mp_primary"}, dialed, "no other provider may be contacted")
	var ue *domain.UpstreamError
	require.ErrorAs(t, err, &ue, "the caller gets the provider's failure in full")
	assert.Equal(t, 503, ue.StatusCode)
	assert.Equal(t, "openai is down", ue.Message)
}

// @scenario "A key set to fall back still walks every eligible provider"
func TestDispatch_FallbackAllWalksEligibleProviders(t *testing.T) {
	var dialed []string
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			dialed = append(dialed, cred.ID)
			if cred.ID == "mp_primary" {
				return nil, &domain.UpstreamError{StatusCode: 500, Message: "down"}
			}
			return successResponse(), nil
		},
	}
	bundle := twoProviderBundle()
	bundle.Config.RoutingMode = domain.RoutingModeFallbackAll

	result, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.NoError(t, err)
	assert.Equal(t, []string{"mp_primary", "mp_secondary"}, dialed)
	assert.Equal(t, 1, result.Meta.FallbackCount)
}

// @scenario "A provider outside the key's allowlist is refused even if a stale chain offers it"
func TestDispatch_StaleChainCannotBypassProviderAllowlist(t *testing.T) {
	var dialed []string
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			dialed = append(dialed, cred.ID)
			if cred.ID == "mp_allowed" {
				return nil, &domain.UpstreamError{StatusCode: 500, Message: "down"}
			}
			return successResponse(), nil
		},
	}
	// A hand-crafted (or stale) bundle whose credential chain still carries a
	// provider the key was narrowed away from. The materialiser would not
	// emit this; the gateway must not honor it if something else does.
	bundle := testBundle(
		domain.Credential{ID: "mp_allowed", ProviderID: domain.ProviderOpenAI, APIKey: "sk-ok"},
		domain.Credential{ID: "mp_forbidden", ProviderID: domain.ProviderOpenAI, APIKey: "sk-no"},
	)
	bundle.Config.Fallback.MaxAttempts = 2
	bundle.Config.ProvidersAllowed = []string{"mp_allowed"}

	_, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.Error(t, err, "with the allowed provider down there is nothing legal left to dial")
	assert.Equal(t, []string{"mp_allowed"}, dialed,
		"fallback must not walk onto a provider outside the allowlist")
	var ue *domain.UpstreamError
	require.ErrorAs(t, err, &ue)
	assert.Equal(t, 500, ue.StatusCode)
}

// When the only provider that could serve the model is outside the
// allowlist, the request is refused with a model error naming the problem,
// not dispatched through the loophole.
func TestDispatch_AllowlistEmptyingTheChainRefusesTheModel(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			t.Fatal("provider must not be dialed")
			return nil, nil
		},
	}
	bundle := testBundle(domain.Credential{ID: "mp_forbidden", ProviderID: domain.ProviderOpenAI, APIKey: "sk-no"})
	bundle.Config.ProvidersAllowed = []string{"mp_other"}

	_, err := appWithRealBudget(provider, nil).HandleChat(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrModelNotAllowed))
}

// The streaming path enforces the same chain rules; pin the exclusion there
// too since coding agents run almost entirely on streams.
func TestDispatchStream_FilteredBreachRoutesAroundTheProvider(t *testing.T) {
	var dialed []string
	provider := &mockProvider{
		streamFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (domain.StreamIterator, error) {
			dialed = append(dialed, cred.ID)
			return &stubIterator{}, nil
		},
	}
	bundle := twoProviderBundle()
	bundle.Config.Budget.Scopes = []domain.BudgetScope{
		filteredBudget("gb_primary", "mp_primary", "block", 25, 25),
	}

	_, err := appWithRealBudget(provider, nil).HandleChatStream(
		context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	require.NoError(t, err)
	assert.Equal(t, []string{"mp_secondary"}, dialed)
}

// stubIterator is a minimal StreamIterator for chain tests.
type stubIterator struct{}

func (s *stubIterator) Next(context.Context) bool { return false }
func (s *stubIterator) Chunk() []byte             { return nil }
func (s *stubIterator) Usage() domain.Usage       { return domain.Usage{} }
func (s *stubIterator) Err() error                { return nil }
func (s *stubIterator) Close() error              { return nil }
