package app

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// --- Mock implementations ---

type mockProvider struct {
	dispatchFn func(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error)
	streamFn   func(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error)
}

func (m *mockProvider) Dispatch(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error) {
	return m.dispatchFn(ctx, req, cred)
}

func (m *mockProvider) DispatchStream(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error) {
	return m.streamFn(ctx, req, cred)
}

func (m *mockProvider) ListModels(_ context.Context, _ []domain.Credential) ([]domain.Model, error) {
	return nil, nil
}

type mockRateLimiter struct {
	allowFn func(ctx context.Context, vkID string, limits domain.RateLimits) error
}

func (m *mockRateLimiter) Allow(ctx context.Context, vkID string, limits domain.RateLimits) error {
	if m.allowFn != nil {
		return m.allowFn(ctx, vkID, limits)
	}
	return nil
}

type mockBudget struct {
	precheckFn func(ctx context.Context, bundle *domain.Bundle) (BudgetVerdict, error)
	debitCalls int
}

func (m *mockBudget) Precheck(ctx context.Context, bundle *domain.Bundle) (BudgetVerdict, error) {
	if m.precheckFn != nil {
		return m.precheckFn(ctx, bundle)
	}
	return BudgetAllow, nil
}

func (m *mockBudget) Debit(_ context.Context, _ *domain.Bundle, _ domain.Usage) {
	m.debitCalls++
}

type mockGuardrails struct {
	preFn  func(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (GuardrailVerdict, error)
	postFn func(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (GuardrailVerdict, error)
}

func (m *mockGuardrails) EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (GuardrailVerdict, error) {
	if m.preFn != nil {
		return m.preFn(ctx, bundle, req)
	}
	return GuardrailVerdict{Action: GuardrailAllow}, nil
}

func (m *mockGuardrails) EvaluatePost(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (GuardrailVerdict, error) {
	if m.postFn != nil {
		return m.postFn(ctx, bundle, req, resp)
	}
	return GuardrailVerdict{Action: GuardrailAllow}, nil
}

func (m *mockGuardrails) EvaluateChunk(_ context.Context, _ *domain.Bundle, _ *domain.Request, _ []byte) (GuardrailVerdict, error) {
	return GuardrailVerdict{Action: GuardrailAllow}, nil
}

type mockBlocked struct {
	checkFn func(ctx context.Context, patterns []domain.BlockedPattern, body []byte) error
}

func (m *mockBlocked) Check(ctx context.Context, patterns []domain.BlockedPattern, body []byte) error {
	if m.checkFn != nil {
		return m.checkFn(ctx, patterns, body)
	}
	return nil
}

type mockModels struct {
	resolveFn func(ctx context.Context, rawModel string, config domain.BundleConfig) (*domain.ResolvedModel, error)
}

func (m *mockModels) Resolve(ctx context.Context, rawModel string, config domain.BundleConfig) (*domain.ResolvedModel, error) {
	if m.resolveFn != nil {
		return m.resolveFn(ctx, rawModel, config)
	}
	return &domain.ResolvedModel{ModelID: rawModel, ProviderID: "openai", Source: domain.ModelSourceImplicit}, nil
}

type mockTraces struct {
	emitCalls  int
	lastParams AITraceParams
}

func (m *mockTraces) Emit(_ context.Context, params AITraceParams) {
	m.emitCalls++
	m.lastParams = params
}

type mockCache struct{}

func (m *mockCache) Evaluate(_ context.Context, _ []domain.CacheRule, _ string) *CacheDecision {
	return nil
}

// --- Helpers ---

func testBundle(creds ...domain.Credential) *domain.Bundle {
	if len(creds) == 0 {
		creds = []domain.Credential{
			{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"},
		}
	}
	return &domain.Bundle{
		VirtualKeyID: "vk-test",
		ProjectID:    "proj-test",
		TeamID:       "team-test",
		Credentials:  creds,
		Config: domain.BundleConfig{
			Fallback: domain.FallbackConfig{MaxAttempts: len(creds)},
		},
	}
}

func testBody() []byte {
	return []byte(`{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`)
}

func successResponse() *domain.Response {
	return &domain.Response{
		Body:       []byte(`{"choices":[{"message":{"content":"hello"}}]}`),
		StatusCode: 200,
		Usage:      domain.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8, CostUSD: 0.001},
	}
}

// --- Tests ---

func TestDispatch_HappyPath(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	result, err := application.Handle(context.Background(), testBundle(), domain.RequestTypeChat, testBody())
	require.NoError(t, err)
	assert.Equal(t, successResponse().Body, result.Response.Body)
	assert.NotEmpty(t, result.Meta.GatewayRequestID)
}

func TestDispatch_RateLimitBlocked(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	rl := &mockRateLimiter{
		allowFn: func(_ context.Context, _ string, _ domain.RateLimits) error {
			return fmt.Errorf("rpm exceeded")
		},
	}

	application := New(
		WithProviders(provider),
		WithRateLimiter(rl),
		WithLogger(zap.NewNop()),
	)

	_, err := application.Handle(context.Background(), testBundle(), domain.RequestTypeChat, testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrRateLimited))
}

func TestDispatch_BudgetBlocked(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	budget := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (BudgetVerdict, error) {
			return BudgetBlock, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)

	_, err := application.Handle(context.Background(), testBundle(), domain.RequestTypeChat, testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBudgetExceeded))
}

func TestDispatch_BudgetWarn(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	budget := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (BudgetVerdict, error) {
			return BudgetWarn, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)

	result, err := application.Handle(context.Background(), testBundle(), domain.RequestTypeChat, testBody())
	require.NoError(t, err)
	assert.Contains(t, result.Meta.BudgetWarnings, "near_limit")
}

func TestDispatch_GuardrailPreBlocked(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	guardrails := &mockGuardrails{
		preFn: func(_ context.Context, _ *domain.Bundle, _ *domain.Request) (GuardrailVerdict, error) {
			return GuardrailVerdict{Action: GuardrailBlock, Message: "blocked by policy"}, nil
		},
	}

	bundle := testBundle()
	bundle.Config.Guardrails = []string{"policy-1"}

	application := New(
		WithProviders(provider),
		WithGuardrails(guardrails),
		WithLogger(zap.NewNop()),
	)

	_, err := application.Handle(context.Background(), bundle, domain.RequestTypeChat, testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrGuardrailBlocked))
}

func TestDispatch_GuardrailPostBlocked(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	guardrails := &mockGuardrails{
		postFn: func(_ context.Context, _ *domain.Bundle, _ *domain.Request, _ *domain.Response) (GuardrailVerdict, error) {
			return GuardrailVerdict{Action: GuardrailBlock, Message: "output blocked"}, nil
		},
	}

	bundle := testBundle()
	bundle.Config.Guardrails = []string{"policy-1"}

	application := New(
		WithProviders(provider),
		WithGuardrails(guardrails),
		WithLogger(zap.NewNop()),
	)

	_, err := application.Handle(context.Background(), bundle, domain.RequestTypeChat, testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrGuardrailBlocked))
}

func TestDispatch_BlockedPattern(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	blocked := &mockBlocked{
		checkFn: func(ctx context.Context, _ []domain.BlockedPattern, _ []byte) error {
			return herr.New(ctx, domain.ErrBlockedPattern, nil)
		},
	}

	bundle := testBundle()
	bundle.Config.BlockedPatterns = []domain.BlockedPattern{
		{Pattern: "secret.*", Type: domain.BlockedDeny, Target: domain.BlockedTargetTool},
	}

	application := New(
		WithProviders(provider),
		WithBlocked(blocked),
		WithLogger(zap.NewNop()),
	)

	_, err := application.Handle(context.Background(), bundle, domain.RequestTypeChat, testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBlockedPattern))
}

func TestDispatch_ModelResolution(t *testing.T) {
	var capturedBody []byte
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			capturedBody = req.Body
			return successResponse(), nil
		},
	}
	models := &mockModels{
		resolveFn: func(_ context.Context, _ string, _ domain.BundleConfig) (*domain.ResolvedModel, error) {
			return &domain.ResolvedModel{
				ModelID:    "gpt-4-turbo",
				ProviderID: domain.ProviderOpenAI,
				Source:     domain.ModelSourceAlias,
			}, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithModels(models),
		WithLogger(zap.NewNop()),
	)

	result, err := application.Handle(context.Background(), testBundle(), domain.RequestTypeChat, testBody())
	require.NoError(t, err)
	assert.NotNil(t, result.Response)

	// Verify the body was rewritten with the resolved model name.
	var parsed map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(capturedBody, &parsed))
	var rewrittenModel string
	require.NoError(t, json.Unmarshal(parsed["model"], &rewrittenModel))
	assert.Equal(t, "gpt-4-turbo", rewrittenModel)
}

func TestDispatch_FallbackOnProviderError(t *testing.T) {
	callCount := 0
	provider := &mockProvider{
		dispatchFn: func(ctx context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			callCount++
			if cred.ID == "cred-1" {
				return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"reason": "server error"})
			}
			return successResponse(), nil
		},
	}

	bundle := testBundle(
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		domain.Credential{ID: "cred-2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
	)
	// MaxAttempts must allow both credentials to be tried.
	bundle.Config.Fallback.MaxAttempts = 2

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	result, err := application.Handle(context.Background(), bundle, domain.RequestTypeChat, testBody())
	require.NoError(t, err)
	assert.Equal(t, 2, callCount)
	assert.Equal(t, 1, result.Meta.FallbackCount)
}

func TestDispatch_DebitsCostAfterSuccess(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	budget := &mockBudget{}

	application := New(
		WithProviders(provider),
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)

	_, err := application.Handle(context.Background(), testBundle(), domain.RequestTypeChat, testBody())
	require.NoError(t, err)
	assert.Equal(t, 1, budget.debitCalls)
}

func TestDispatch_EmitsTraceAfterSuccess(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	models := &mockModels{} // default: returns resolved model so traces fire
	traces := &mockTraces{}

	application := New(
		WithProviders(provider),
		WithModels(models),
		WithTraces(traces),
		WithLogger(zap.NewNop()),
	)

	_, err := application.Handle(context.Background(), testBundle(), domain.RequestTypeChat, testBody())
	require.NoError(t, err)
	assert.Equal(t, 1, traces.emitCalls)
	assert.Equal(t, "proj-test", traces.lastParams.ProjectID)
}

func TestDispatch_NilDependenciesAreSkipped(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	// Create app with ONLY a provider -- all other deps are nil.
	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	result, err := application.Handle(context.Background(), testBundle(), domain.RequestTypeChat, testBody())
	require.NoError(t, err)
	assert.NotNil(t, result.Response)
	assert.NotEmpty(t, result.Meta.GatewayRequestID)
}
