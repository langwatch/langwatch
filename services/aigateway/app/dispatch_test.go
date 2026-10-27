package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/retry"
	"github.com/langwatch/langwatch/services/aigateway/app/pipeline"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type mockProvider struct {
	dispatchFn func(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error)
	streamFn   func(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error)
	listFn     func(ctx context.Context, creds []domain.Credential) ([]domain.Model, []domain.ModelDiscoveryGap, error)
}

func (m *mockProvider) Dispatch(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error) {
	return m.dispatchFn(ctx, req, cred)
}

func (m *mockProvider) DispatchStream(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error) {
	return m.streamFn(ctx, req, cred)
}

func (m *mockProvider) ListModels(ctx context.Context, creds []domain.Credential) ([]domain.Model, []domain.ModelDiscoveryGap, error) {
	if m.listFn != nil {
		return m.listFn(ctx, creds)
	}
	return nil, nil, nil
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
	precheckFn func(ctx context.Context, bundle *domain.Bundle) (domain.BudgetDecision, error)
}

func (m *mockBudget) Precheck(ctx context.Context, bundle *domain.Bundle) (domain.BudgetDecision, error) {
	if m.precheckFn != nil {
		return m.precheckFn(ctx, bundle)
	}
	return domain.BudgetDecision{Verdict: domain.BudgetAllow}, nil
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
	checkFn      func(ctx context.Context, rules []domain.PolicyRule, body []byte) error
	checkModelFn func(ctx context.Context, rules []domain.PolicyRule, resolved domain.ResolvedModel) error
}

func (m *mockPolicy) Check(ctx context.Context, rules []domain.PolicyRule, body []byte) error {
	if m.checkFn != nil {
		return m.checkFn(ctx, rules, body)
	}
	return nil
}

func (m *mockPolicy) CheckModel(ctx context.Context, rules []domain.PolicyRule, resolved domain.ResolvedModel) error {
	if m.checkModelFn != nil {
		return m.checkModelFn(ctx, rules, resolved)
	}
	return nil
}

type mockModels struct {
	resolveFn func(ctx context.Context, req *domain.Request, config domain.BundleConfig) (*domain.ResolvedModel, error)
}

func (m *mockModels) Resolve(ctx context.Context, req *domain.Request, config domain.BundleConfig) (*domain.ResolvedModel, error) {
	if m.resolveFn != nil {
		return m.resolveFn(ctx, req, config)
	}
	rawModel := ""
	if req != nil {
		rawModel = req.Model
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

	result, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
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

	_, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
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
		precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetDecision, error) {
			return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
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
		precheckFn: func(_ context.Context, _ *domain.Bundle) (domain.BudgetDecision, error) {
			return domain.BudgetDecision{
				Verdict:  domain.BudgetWarn,
				Warnings: []domain.BudgetWarning{{Scope: "project", PctUsed: 95}},
			}, nil
		},
	}

	application := New(
		WithProviders(provider),
		WithBudget(budget),
		WithLogger(zap.NewNop()),
	)

	result, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
	require.NoError(t, err)
	assert.Contains(t, result.Meta.BudgetWarnings, "project:95")
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
	bundle.Config.Guardrails = domain.GuardrailsConfig{
		Pre:  []domain.GuardrailEntry{{ID: "policy-1", Evaluator: "test"}},
		Post: []domain.GuardrailEntry{{ID: "policy-1", Evaluator: "test"}},
	}

	application := New(
		WithProviders(provider),
		WithGuardrails(guardrails),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
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
	bundle.Config.Guardrails = domain.GuardrailsConfig{
		Pre:  []domain.GuardrailEntry{{ID: "policy-1", Evaluator: "test"}},
		Post: []domain.GuardrailEntry{{ID: "policy-1", Evaluator: "test"}},
	}

	application := New(
		WithProviders(provider),
		WithGuardrails(guardrails),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
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

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
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
		resolveFn: func(_ context.Context, _ *domain.Request, _ domain.BundleConfig) (*domain.ResolvedModel, error) {
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

	result, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
	require.NoError(t, err)
	assert.NotNil(t, result.Response)

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
	bundle.Config.Fallback.MaxAttempts = 2

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	result, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
	require.NoError(t, err)
	assert.Equal(t, 2, callCount)
	assert.Equal(t, 1, result.Meta.FallbackCount)
}

func TestHandleChat_FallbackOnUpstream404(t *testing.T) {
	callCount := 0
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			callCount++
			if cred.ID == "cred-1" {
				return nil, &domain.UpstreamError{StatusCode: 404, Message: "model not found"}
			}
			return successResponse(), nil
		},
	}

	bundle := testBundle(
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		domain.Credential{ID: "cred-2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
	)
	bundle.Config.Fallback.MaxAttempts = 2

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	result, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
	require.NoError(t, err)
	assert.Equal(t, 2, callCount)
	assert.Equal(t, 1, result.Meta.FallbackCount)
}

func TestHandleChat_TerminatesOnUpstream400(t *testing.T) {
	callCount := 0
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			callCount++
			if cred.ID == "cred-1" {
				return nil, &domain.UpstreamError{StatusCode: 400, Message: "invalid request"}
			}
			return successResponse(), nil
		},
	}

	bundle := testBundle(
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		domain.Credential{ID: "cred-2", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
	)
	bundle.Config.Fallback.MaxAttempts = 2

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")

	// A terminal 4xx (here a 400 "invalid request") must not fall back to the
	// next credential: cred-1 is the only provider dialed, and the upstream
	// status reaches the caller verbatim instead of being masked by a
	// pointless retry on cred-2.
	require.Error(t, err)
	assert.Equal(t, 1, callCount)
	var ue *domain.UpstreamError
	require.ErrorAs(t, err, &ue)
	assert.Equal(t, 400, ue.StatusCode)
}

func TestHandleChat_EmitsTraceAfterSuccess(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			return successResponse(), nil
		},
	}
	models := &mockModels{}
	traces := &mockTraces{}

	application := New(
		WithProviders(provider),
		WithModels(models),
		WithTraces(traces),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
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

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	result, err := application.HandleChat(context.Background(), testBundle(), bytes.NewReader(testBody()), "gpt-4")
	require.NoError(t, err)
	assert.NotNil(t, result.Response)
	assert.NotEmpty(t, result.Meta.GatewayRequestID)
}

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
	_, err := p.Sync(context.Background(), &domain.Bundle{}, &domain.Request{})
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
	_, err := p.Sync(context.Background(), &domain.Bundle{}, &domain.Request{})
	require.Error(t, err)
	assert.False(t, terminalCalled)
}

// TestHandleChat_ModelAwareSkipsWrongProvider proves the dispatcher
// filters incompatible providers out of the credential chain before
// dispatching. With a personal-VK shape (Anthropic + OpenAI + Gemini
// behind one key), an Anthropic-only model must NOT first attempt the
// OpenAI/Gemini creds and waste fallback budget.
func TestHandleChat_ModelAwareSkipsWrongProvider(t *testing.T) {
	var attempted []domain.ProviderID
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			attempted = append(attempted, cred.ProviderID)
			return successResponse(), nil
		},
	}
	models := &mockModels{
		resolveFn: func(_ context.Context, _ *domain.Request, _ domain.BundleConfig) (*domain.ResolvedModel, error) {
			return &domain.ResolvedModel{
				ModelID:    "claude-3-5-sonnet-20241022",
				ProviderID: domain.ProviderAnthropic,
				Source:     domain.ModelSourceImplicit,
			}, nil
		},
	}

	bundle := testBundle(
		domain.Credential{ID: "openai_first", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		domain.Credential{ID: "anthropic", ProviderID: domain.ProviderAnthropic, APIKey: "sk-2"},
		domain.Credential{ID: "gemini", ProviderID: domain.ProviderGemini, APIKey: "sk-3"},
	)
	bundle.Config.Fallback.MaxAttempts = 3

	application := New(
		WithProviders(provider),
		WithModels(models),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(
		context.Background(), bundle,
		bytes.NewReader([]byte(`{"model":"claude-3-5-sonnet","messages":[]}`)),
		"claude-3-5-sonnet")
	require.NoError(t, err)
	require.Len(t, attempted, 1, "expected exactly one provider attempt")
	assert.Equal(t, domain.ProviderAnthropic, attempted[0],
		"expected Anthropic to be the only provider attempted (got %v)", attempted)
}

// TestHandleChat_ModelAwareImplicitInfersProvider verifies that even
// when the model resolver leaves ProviderID empty (implicit), the
// dispatcher infers the provider from the model name and filters
// accordingly.
func TestHandleChat_ModelAwareImplicitInfersProvider(t *testing.T) {
	var attempted []domain.ProviderID
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
			attempted = append(attempted, cred.ProviderID)
			return successResponse(), nil
		},
	}
	models := &mockModels{
		resolveFn: func(_ context.Context, req *domain.Request, _ domain.BundleConfig) (*domain.ResolvedModel, error) {
			return &domain.ResolvedModel{
				ModelID:    req.Model,
				ProviderID: "", // implicit — dispatcher must infer
				Source:     domain.ModelSourceImplicit,
			}, nil
		},
	}

	bundle := testBundle(
		domain.Credential{ID: "anthropic_first", ProviderID: domain.ProviderAnthropic, APIKey: "sk-a"},
		domain.Credential{ID: "openai", ProviderID: domain.ProviderOpenAI, APIKey: "sk-o"},
	)
	bundle.Config.Fallback.MaxAttempts = 2

	application := New(
		WithProviders(provider),
		WithModels(models),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(
		context.Background(), bundle,
		bytes.NewReader([]byte(`{"model":"gpt-4o-mini","messages":[]}`)),
		"gpt-4o-mini")
	require.NoError(t, err)
	require.Len(t, attempted, 1)
	assert.Equal(t, domain.ProviderOpenAI, attempted[0])
}

// A bundle with zero provider credentials (the org never configured a
// ModelProvider) must fail with the handled no_provider_configured error,
// not fall through to Bifrost with a zero-value Credential — that surfaces
// as an opaque "provider is required" 400 to the caller.
func TestHandleChat_NoProviderConfigured(t *testing.T) {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			t.Fatal("provider must not be dialed when the bundle has no credentials")
			return nil, nil
		},
	}

	bundle := testBundle()
	bundle.Credentials = nil

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrNoProviderConfigured))
}

func TestHandleChatStream_NoProviderConfigured(t *testing.T) {
	provider := &mockProvider{
		streamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
			t.Fatal("provider must not be dialed when the bundle has no credentials")
			return nil, nil
		},
	}

	bundle := testBundle()
	bundle.Credentials = nil

	application := New(
		WithProviders(provider),
		WithLogger(zap.NewNop()),
	)

	_, err := application.HandleChatStream(context.Background(), bundle, bytes.NewReader(testBody()), "gpt-4")
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrNoProviderConfigured))
}

func TestPeekStream(t *testing.T) {
	assert.True(t, PeekStream([]byte(`{"model":"gpt-4","stream":true}`)))
	assert.False(t, PeekStream([]byte(`{"model":"gpt-4"}`)))
	assert.False(t, PeekStream([]byte(`{"model":"gpt-4","stream":false}`)))
}

// A forwarded upstream error must drive credential fallback by its real HTTP
// status: terminal 4xx (e.g. an Anthropic "credit balance too low" 400) is
// non-retryable so the gateway stops instead of burning the next key on a
// pointless retry; 404 ("model not served here"), 429 and 5xx stay retryable
// so the fallback chain still kicks in.
func TestClassifyProviderError_UpstreamError(t *testing.T) {
	cases := []struct {
		status int
		want   retry.Reason
	}{
		{400, retry.ReasonNonRetryable},
		{401, retry.ReasonNonRetryable},
		{402, retry.ReasonNonRetryable},
		{403, retry.ReasonNonRetryable},
		{404, retry.ReasonNotFound},
		{422, retry.ReasonNonRetryable},
		{429, retry.ReasonRateLimit},
		{500, retry.ReasonRetryable5xx},
		{502, retry.ReasonRetryable5xx},
		{503, retry.ReasonRetryable5xx},
	}
	for _, c := range cases {
		err := &domain.UpstreamError{StatusCode: c.status, Message: "x"}
		assert.Equalf(t, c.want, classifyProviderError(err), "status %d", c.status)
	}
}

func TestClassifyProviderError_HerrCodes(t *testing.T) {
	ctx := context.Background()
	assert.Equal(t, retry.ReasonTimeout, classifyProviderError(herr.New(ctx, domain.ErrProviderTimeout, nil)))
	assert.Equal(t, retry.ReasonRateLimit, classifyProviderError(herr.New(ctx, domain.ErrRateLimited, nil)))
	assert.Equal(t, retry.ReasonRetryable5xx, classifyProviderError(herr.New(ctx, domain.ErrProviderError, nil)))
	assert.Equal(t, retry.ReasonNonRetryable, classifyProviderError(herr.New(ctx, domain.ErrBadRequest, nil)))
}

// A credential that cannot authenticate, and a slot that does not serve the
// model, fail identically on every credential in the chain. Retrying them
// spends the chain to arrive at the same answer more slowly — and, while these
// wore provider_timeout, recorded a breaker failure on each attempt, pushing a
// healthy provider's circuit toward open.
// @scenario "A terminal setup failure does not spend the fallback chain"
func TestClassifyProviderError_ProviderSetupFailuresDoNotRetry(t *testing.T) {
	ctx := context.Background()
	for _, code := range []herr.Code{
		domain.ErrProviderCredentialInvalid,
		domain.ErrProviderCredentialRejected,
		domain.ErrProviderConfigInvalid,
	} {
		reason := classifyProviderError(herr.New(ctx, code, nil))

		assert.Equalf(t, retry.ReasonNotDialed, reason,
			"%s repeats identically on every credential", code)
		// Asserting the enum alone proves nothing here: classifyProviderError's
		// default arm already answers NonRetryable, so this test passed with the
		// case arms deleted. What the code arms have to earn is the BREAKER
		// consequence — NonRetryable credits a success (pkg/retry recordBreaker's
		// default), which force-closes an open circuit on a provider that never
		// answered. ReasonNotDialed records nothing; pkg/retry's own test pins
		// that, and this pins that these codes reach it.
		assert.NotEqualf(t, retry.ReasonNonRetryable, reason,
			"%s never reached the upstream, so it must not credit the slot as alive", code)
	}
}

// The caller hanging up must beat Bifrost's no-fallback marker, which its
// context-done constructor always sets — so an abandoned request carries BOTH
// signals and the order they are read in decides the outcome. Reading the
// marker first sent every client disconnect to ReasonNonRetryable, which
// credits a breaker success and wipes the slot's failure window: clients giving
// up during a provider outage held the breaker closed on the dead slot.
func TestClassifyProviderError_AbandonmentOutranksTheNoFallbackMarker(t *testing.T) {
	abandoned := domain.WithNoFallback(
		herr.New(context.Background(), domain.ErrRequestAbandoned, nil))

	assert.Equal(t, retry.ReasonContextDone, classifyProviderError(abandoned),
		"production always wraps this error; ReasonContextDone is the only reason that records nothing")
}

// The marker has to be read before the UpstreamError branch, because
// AllowFallbacks is set on ANSWERED responses too and errors.As matches through
// the marker's Unwrap — so reading it afterwards left it inert for exactly the
// errors that carry it. A retryable status is the case that proves the order.
func TestClassifyProviderError_NoFallbackMarkerOutranksARetryableStatus(t *testing.T) {
	rateLimited := &domain.UpstreamError{StatusCode: 429, Message: "slow down"}
	require.Equal(t, retry.ReasonRateLimit, classifyProviderError(rateLimited))

	assert.Equal(t, retry.ReasonNonRetryable,
		classifyProviderError(domain.WithNoFallback(rateLimited)),
		"the engine said no other credential will do better; the chain must stop")
}

// A host that never answered says the slot is unhealthy, so unlike the setup
// failures above it retries and counts toward the breaker, exactly like a
// timeout does.
// @scenario "A provider that was never reached is retryable, unlike a settings mistake"
func TestClassifyProviderError_UnreachableProviderRetries(t *testing.T) {
	assert.Equal(t, retry.ReasonNetwork,
		classifyProviderError(herr.New(context.Background(), domain.ErrProviderConnectionFailed, nil)))
}

// The caller leaving says nothing about the credential. retry.recordBreaker
// records nothing for ReasonContextDone, which is what keeps one client on a
// flaky connection from opening the circuit on a provider that was answering.
func TestClassifyProviderError_AbandonedRequestNeitherFallsBackNorMovesTheBreaker(t *testing.T) {
	assert.Equal(t, retry.ReasonContextDone,
		classifyProviderError(herr.New(context.Background(), domain.ErrRequestAbandoned, nil)))
}

// Bifrost's own AllowFallbacks=false verdict outranks the code underneath:
// even a normally-retryable error stops the walk when the engine has already
// said no other credential will do better.
// @scenario "The engine's own refusal to fall over is honored"
func TestClassifyProviderError_HonorsNoFallbackMarker(t *testing.T) {
	retryable := herr.New(context.Background(), domain.ErrProviderError, nil)
	require.Equal(t, retry.ReasonRetryable5xx, classifyProviderError(retryable))

	assert.Equal(t, retry.ReasonNonRetryable, classifyProviderError(domain.WithNoFallback(retryable)))
}
