package app

import (
	"bytes"
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/policy"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// These run the real resolver and the real matcher through the real pipeline,
// because the bug they pin is precisely an ordering one: the policy
// interceptor sees the body before the resolver rewrites it, so a mocked
// half proves nothing about which name the rule was applied to.

// @scenario "A model deny rule judges the model an alias resolved to"
func TestHandleChat_ModelDenyReachesTheModelBehindAnAlias(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}

	bundle := testBundle()
	bundle.Config.ModelAliases = map[string]domain.ModelAlias{
		"safe-model": {ProviderID: domain.ProviderOpenAI, Model: "gpt-4o"},
	}
	bundle.Config.PolicyRules = []domain.PolicyRule{
		{Pattern: "^gpt-4.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	application := New(
		WithProviders(provider),
		WithPolicy(policy.NewMatcher()),
		WithModels(modelresolver.New()),
		WithLogger(zap.NewNop()),
	)

	body := []byte(`{"model":"safe-model","messages":[{"role":"user","content":"hi"}]}`)
	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(body), "safe-model")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
	assert.False(t, dispatched, "a denied model must never reach a provider")
}

// The other half of moving the rule onto the resolved id, and the one that
// changes behavior: nothing denied ever runs, so denying a name that resolves
// somewhere permitted has nothing to refuse.
func TestHandleChat_DeniedNameResolvingToAPermittedModelIsServed(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}

	bundle := testBundle()
	bundle.Config.ModelAliases = map[string]domain.ModelAlias{
		"gpt-4o-preview": {ProviderID: domain.ProviderOpenAI, Model: "gpt-5-mini"},
	}
	bundle.Config.PolicyRules = []domain.PolicyRule{
		{Pattern: ".*-preview$", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	application := New(
		WithProviders(provider),
		WithPolicy(policy.NewMatcher()),
		WithModels(modelresolver.New()),
		WithLogger(zap.NewNop()),
	)

	body := []byte(`{"model":"gpt-4o-preview","messages":[{"role":"user","content":"hi"}]}`)
	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(body), "gpt-4o-preview")
	require.NoError(t, err)
	assert.True(t, dispatched)
}

// A deny on a dimension the body carries is still judged before resolution,
// so moving the model rules did not move anything else.
func TestHandleChat_ToolDenyStillJudgesTheBodyAsSent(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	bundle := testBundle()
	bundle.Config.PolicyRules = []domain.PolicyRule{
		{Pattern: "^shell\\..*", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}

	application := New(
		WithProviders(provider),
		WithPolicy(policy.NewMatcher()),
		WithModels(modelresolver.New()),
		WithLogger(zap.NewNop()),
	)

	body := []byte(`{"model":"gpt-4","tools":[{"function":{"name":"shell.exec"}}],"messages":[]}`)
	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(body), "gpt-4")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

// @scenario "An alias resolving outside models_allowed is refused"
func TestHandleChat_AliasOutsideAllowlistNeverReachesAProvider(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}

	bundle := testBundle()
	bundle.Config.AllowedModels = []string{"claude-*"}
	bundle.Config.ModelAliases = map[string]domain.ModelAlias{
		"coding": {ProviderID: domain.ProviderOpenAI, Model: "gpt-5-mini"},
	}

	application := New(
		WithProviders(provider),
		WithModels(modelresolver.New()),
		WithLogger(zap.NewNop()),
	)

	body := []byte(`{"model":"coding","messages":[{"role":"user","content":"hi"}]}`)
	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(body), "coding")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrModelNotAllowed))
	assert.False(t, dispatched)
}

// Model rules are enforced from the model resolver. A build with no resolver
// cannot honor them, and serving the request anyway would silently grant
// exactly what the rule exists to withhold.
func TestHandleChat_ModelRuleWithNoResolverIsRefused(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}

	bundle := testBundle()
	bundle.Config.PolicyRules = []domain.PolicyRule{
		{Pattern: "^gpt-4.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	application := New(
		WithProviders(provider),
		WithPolicy(policy.NewMatcher()),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrInternal))
	assert.False(t, dispatched)
}

// A key whose policy carries no model rule is unaffected by the guard.
func TestHandleChat_NonModelRuleWithNoResolverStillServes(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	bundle := testBundle()
	bundle.Config.PolicyRules = []domain.PolicyRule{
		{Pattern: "^shell\\..*", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}

	application := New(
		WithProviders(provider),
		WithPolicy(policy.NewMatcher()),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
	require.NoError(t, err)
}
