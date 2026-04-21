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
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
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
	precheckFn func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error)
	debitCalls int
}

func (m *mockBudget) Precheck(ctx context.Context, bundle *domain.Bundle) (domain.BudgetVerdict, error) {
	if m.precheckFn != nil {
		return m.precheckFn(ctx, bundle)
	}
	return domain.BudgetAllow, nil
}

func (m *mockBudget) Debit(_ context.Context, _ *domain.Bundle, _ domain.Usage) {
	m.debitCalls++
}

type mockGuardrails struct {
	preFn  func(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error)
	postFn func(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error)
}

func (m *mockGuardrails) EvaluatePre(ctx context.Context, bundle *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error) {
	if m.preFn != nil {
		return m.preFn(ctx, bundle, req)
	}
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
}

func (m *mockGuardrails) EvaluatePost(ctx context.Context, bundle *domain.Bundle, req *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error) {
	if m.postFn != nil {
		return m.postFn(ctx, bundle, req, resp)
	}
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
}

func (m *mockGuardrails) EvaluateChunk(_ context.Context, _ *domain.Bundle, _ *domain.Request, _ []byte) (domain.GuardrailVerdict, error) {
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}, nil
}

type mockPolicy struct {
	checkFn func(ctx context.Context, rules []domain.PolicyRule, body []byte) error
}

func (m *mockPolicy) Check(ctx context.Context, rules []domain.PolicyRule, body []byte) error {
	if m.checkFn != nil {
		return m.checkFn(ctx, rules, body)
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
	beginCalls int
	endCalls   int
	lastParams domain.AITraceParams
}

func (m *mockTraces) BeginSpan(ctx context.Context, _ string, _ domain.RequestType) (context.Context, string) {
	m.beginCalls++
	return ctx, "00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01"
}

func (m *mockTraces) EndSpan(_ context.Context, params domain.AITraceParams) {
	m.endCalls++
	m.lastParams = params
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
		Usage:      domain.Usage{PromptTokens: 5, CompletionTokens: 3, TotalTokens: 8, CostMicroUSD: 1000},
	}
}

// --- Tests ---

func TestHandleChat_HappyPath(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	result, err := application.HandleChat(context.Background(), testBundle(), testBody())
	require.NoError(t, err)
	assert.Equal(t, successResponse().Body, result.Response.Body)
	assert.NotEmpty(t, result.Meta.GatewayRequestID)
}

func TestHandleChat_RateLimitBlocked(t *testing.T) {
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

	_, err := application.HandleChat(context.Background(), testBundle(), testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrRateLimited))
}

func TestHandleChat_BudgetBlocked(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	budget := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetVerdict, error) {
			return domain.BudgetBlock, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), testBundle(), testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBudgetExceeded))
}

func TestHandleChat_BudgetWarn(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	budget := &mockBudget{
		precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetVerdict, error) {
			return domain.BudgetWarn, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)

	result, err := application.HandleChat(context.Background(), testBundle(), testBody())
	require.NoError(t, err)
	assert.Contains(t, result.Meta.BudgetWarnings, "near_limit")
}

func TestHandleChat_GuardrailPreBlocked(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	guardrails := &mockGuardrails{
		preFn: func(_ context.Context, _ *domain.Bundle, _ *domain.Request) (domain.GuardrailVerdict, error) {
			return domain.GuardrailVerdict{Action: domain.GuardrailBlock, Message: "blocked by policy"}, nil
		},
	}

	bundle := testBundle()
	bundle.Config.Guardrails = []string{"policy-1"}

	application := New(
		WithProviders(provider),
		WithGuardrails(guardrails),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrGuardrailBlocked))
}

func TestHandleChat_GuardrailPostBlocked(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	guardrails := &mockGuardrails{
		postFn: func(_ context.Context, _ *domain.Bundle, _ *domain.Request, _ *domain.Response) (domain.GuardrailVerdict, error) {
			return domain.GuardrailVerdict{Action: domain.GuardrailBlock, Message: "output blocked"}, nil
		},
	}

	bundle := testBundle()
	bundle.Config.Guardrails = []string{"policy-1"}

	application := New(
		WithProviders(provider),
		WithGuardrails(guardrails),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrGuardrailBlocked))
}

func TestHandleChat_PolicyViolation(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	pol := &mockPolicy{
		checkFn: func(ctx context.Context, _ []domain.PolicyRule, _ []byte) error {
			return herr.New(ctx, domain.ErrPolicyViolation, nil)
		},
	}

	bundle := testBundle()
	bundle.Config.PolicyRules = []domain.PolicyRule{
		{Pattern: "secret.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
	}

	application := New(
		WithProviders(provider),
		WithPolicy(pol),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, testBody())
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrPolicyViolation))
}

func TestHandleChat_ModelResolution(t *testing.T) {
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

	result, err := application.HandleChat(context.Background(), testBundle(), testBody())
	require.NoError(t, err)
	assert.NotNil(t, result.Response)

	// Verify the body was rewritten with the resolved model name.
	var parsed map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(capturedBody, &parsed))
	var rewrittenModel string
	require.NoError(t, json.Unmarshal(parsed["model"], &rewrittenModel))
	assert.Equal(t, "gpt-4-turbo", rewrittenModel)
}

func TestHandleChat_FallbackOnProviderError(t *testing.T) {
	callCount := 0
	provider := &mockProvider{
		dispatchFn: func(ctx context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			callCount++
			if cred.ID == "cred-1" {
				return nil, herr.New(ctx, domain.ErrProviderError, herr.M{"message": "server error"})
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

	result, err := application.HandleChat(context.Background(), bundle, testBody())
	require.NoError(t, err)
	assert.Equal(t, 2, callCount)
	assert.Equal(t, 1, result.Meta.FallbackCount)
}

func TestHandleChat_DebitsCostAfterSuccess(t *testing.T) {
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

	_, err := application.HandleChat(context.Background(), testBundle(), testBody())
	require.NoError(t, err)
	assert.Equal(t, 1, budget.debitCalls)
}

func TestHandleChat_EmitsTraceAfterSuccess(t *testing.T) {
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

	_, err := application.HandleChat(context.Background(), testBundle(), testBody())
	require.NoError(t, err)
	assert.Equal(t, 1, traces.beginCalls)
	assert.Equal(t, 1, traces.endCalls)
	assert.Equal(t, "proj-test", traces.lastParams.ProjectID)
}

func TestHandleChat_NilDependenciesAreSkipped(t *testing.T) {
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

	result, err := application.HandleChat(context.Background(), testBundle(), testBody())
	require.NoError(t, err)
	assert.NotNil(t, result.Response)
	assert.NotEmpty(t, result.Meta.GatewayRequestID)
}

// --- Chain tests ---

func TestChainSync_OrderIsPreserved(t *testing.T) {
	var order []string

	interceptors := []pipeline.Interceptor{
		pipeline.PreOnly("first", func(_ context.Context, _ *pipeline.Call) error {
			order = append(order, "first")
			return nil
		}),
		pipeline.PreOnly("second", func(_ context.Context, _ *pipeline.Call) error {
			order = append(order, "second")
			return nil
		}),
	}

	terminal := func(_ context.Context, _ *pipeline.Call) (*domain.Response, error) {
		order = append(order, "terminal")
		return &domain.Response{}, nil
	}

	p := pipeline.Build(interceptors, terminal, nil)
	_, err := p.Sync(context.Background(), &pipeline.Call{Meta: &pipeline.Meta{}})
	require.NoError(t, err)
	assert.Equal(t, []string{"first", "second", "terminal"}, order)
}

func TestChainSync_EarlyReject(t *testing.T) {
	terminalCalled := false

	interceptors := []pipeline.Interceptor{
		pipeline.PreOnly("blocker", func(ctx context.Context, _ *pipeline.Call) error {
			return herr.New(ctx, domain.ErrRateLimited, nil)
		}),
	}

	terminal := func(_ context.Context, _ *pipeline.Call) (*domain.Response, error) {
		terminalCalled = true
		return &domain.Response{}, nil
	}

	p := pipeline.Build(interceptors, terminal, nil)
	_, err := p.Sync(context.Background(), &pipeline.Call{Meta: &pipeline.Meta{}})
	require.Error(t, err)
	assert.False(t, terminalCalled)
}

func TestPeekStream(t *testing.T) {
	assert.True(t, PeekStream([]byte(`{"model":"gpt-4","stream":true}`)))
	assert.False(t, PeekStream([]byte(`{"model":"gpt-4"}`)))
	assert.False(t, PeekStream([]byte(`{"model":"gpt-4","stream":false}`)))
}
