package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/adapters/budget"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The soft-budget warning header is the only thing that tells a caller their
// spend is about to stop working while the call still succeeds. Every test
// here drives the real budget checker through the real router over a real
// socket and reads the header off the response a client actually receives —
// asserting the interceptor computed a warning proves nothing, because the
// two ways this broke in production both lost the value after that point.
//
// Spec: specs/ai-gateway/budgets.feature ("Soft budget emits warning header
// but allows the call"), specs/ai-gateway/_shared/contract.md.
const budgetWarningHeader = "X-LangWatch-Budget-Warning"

// budgetScopeBundle is a VK bundle carrying a single budget scope, the shape
// the control-plane materialiser puts on the wire.
func budgetScopeBundle(onBreach string, limitUSD, spentUSD float64) *domain.Bundle {
	b := testBundle()
	b.Config.Budget.Scopes = []domain.BudgetScope{{
		Scope:         "project",
		Window:        "month",
		LimitMicroUSD: int64(limitUSD * 1_000_000),
		SpentMicroUSD: int64(spentUSD * 1_000_000),
		OnBreach:      onBreach,
	}}
	return b
}

// budgetServer boots the gateway behind a real net/http server with the real
// budget checker wired in, so the assertions read response headers the same
// way a customer's SDK does rather than out of an in-memory recorder.
func budgetServer(t *testing.T, bundle *domain.Bundle, heartbeat time.Duration, provider app.ProviderRouter) *httptest.Server {
	t.Helper()
	auth := &mockAuth{resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) { return bundle, nil }}
	reg := health.New("test")
	reg.MarkStarted()
	application := app.New(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithBudget(budget.NewChecker(budget.CheckerOptions{Logger: zap.NewNop()})),
		app.WithLogger(zap.NewNop()),
	)
	srv := httptest.NewServer(NewRouter(RouterDeps{
		App:               application,
		Logger:            zap.NewNop(),
		Health:            reg,
		HeartbeatInterval: heartbeat,
	}))
	t.Cleanup(srv.Close)
	return srv
}

func fastProvider() app.ProviderRouter {
	return &mockStreamProvider{
		mockProvider: mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
				return successResponse(), nil
			},
		},
	}
}

// chatCall POSTs a chat completion and returns the response the client sees.
func chatCall(t *testing.T, srv *httptest.Server, stream bool) *http.Response {
	t.Helper()
	body := `{"model":"gpt-4","messages":[{"role":"user","content":"hi"}]}`
	if stream {
		body = `{"model":"gpt-4","messages":[{"role":"user","content":"hi"}],"stream":true}`
	}
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader([]byte(body)))
	require.NoError(t, err)
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = io.Copy(io.Discard, resp.Body)
		_ = resp.Body.Close()
	})
	return resp
}

// @scenario "Soft budget emits warning header but allows the call"
func TestRouter_BudgetWarning_NonStreamingResponseCarriesHeader(t *testing.T) {
	srv := budgetServer(t, budgetScopeBundle("warn", 100, 95), 0, fastProvider())

	resp := chatCall(t, srv, false)

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "project:95", resp.Header.Get(budgetWarningHeader))
}

// The streaming path commits its header block inside writeSSE, so a warning
// attached anywhere after that never reaches the client. Coding agents run
// almost entirely on streaming calls, which makes this the path that matters.
/** @scenario "Streaming responses carry the warning header too" */
func TestRouter_BudgetWarning_StreamingResponseCarriesHeader(t *testing.T) {
	srv := budgetServer(t, budgetScopeBundle("warn", 100, 95), 0, fastProvider())

	resp := chatCall(t, srv, true)

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "text/event-stream", resp.Header.Get("Content-Type"))
	assert.Equal(t, "project:95", resp.Header.Get(budgetWarningHeader))
}

// A hard-cap budget on approach is the case customers actually hit: the
// control plane already calls this a soft warning, the request is still
// served, and the header is the only warning before the 402 starts.
/** @scenario "A hard cap warns on approach before it starts rejecting" */
func TestRouter_BudgetWarning_HardCapOnApproachWarnsBeforeBlocking(t *testing.T) {
	srv := budgetServer(t, budgetScopeBundle("block", 100, 85.86), 0, fastProvider())

	resp := chatCall(t, srv, false)

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "project:85", resp.Header.Get(budgetWarningHeader))
}

// Below the soft threshold there is nothing to say, and a header on every
// response would train callers to ignore it.
/** @scenario "No warning header well under the limit" */
func TestRouter_BudgetWarning_AbsentWellUnderTheLimit(t *testing.T) {
	srv := budgetServer(t, budgetScopeBundle("block", 100, 40), 0, fastProvider())

	resp := chatCall(t, srv, false)

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Empty(t, resp.Header.Get(budgetWarningHeader))
}

// A hard cap that is actually spent rejects the call; the warning header
// belongs to responses that went through, not to the 402.
func TestRouter_BudgetWarning_ExhaustedHardCapBlocksWithoutWarning(t *testing.T) {
	srv := budgetServer(t, budgetScopeBundle("block", 100, 100), 0, fastProvider())

	resp := chatCall(t, srv, false)

	assert.Equal(t, http.StatusPaymentRequired, resp.StatusCode)
	assert.Empty(t, resp.Header.Get(budgetWarningHeader))
}

// The non-streaming keep-alive commits the response header block the moment
// it writes its first byte, which happens while dispatch is still running.
// Every meta header used to be written only after dispatch returned, so any
// completion slower than the heartbeat interval silently lost all of them —
// and a long completion is exactly when a budget is worth warning about.
/** @scenario "A long-running completion still reports the warning" */
func TestRouter_BudgetWarning_SurvivesAHeartbeatCommittedResponse(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	srv := budgetServer(t, budgetScopeBundle("warn", 100, 95), 20*time.Millisecond,
		slowSuccessProvider(entered, release))

	type outcome struct {
		resp *http.Response
		err  error
	}
	results := make(chan outcome, 1)
	go func() {
		req, err := http.NewRequest(http.MethodPost, srv.URL+"/v1/chat/completions", bytes.NewReader(chatBody()))
		if err != nil {
			results <- outcome{nil, err}
			return
		}
		req.Header.Set("Authorization", "Bearer vk-lw-test")
		resp, err := http.DefaultClient.Do(req)
		results <- outcome{resp, err}
	}()

	waitOrFatal(t, entered, "provider was never dialed")
	// Hold the provider past a couple of heartbeat ticks so the header block
	// is committed before dispatch returns.
	time.Sleep(100 * time.Millisecond)
	close(release)

	var res outcome
	select {
	case res = <-results:
	case <-time.After(2 * time.Second):
		t.Fatal("client never received a response")
	}
	require.NoError(t, res.err)
	defer res.resp.Body.Close()
	_, _ = io.Copy(io.Discard, res.resp.Body)

	require.Equal(t, "true", res.resp.Header.Get("X-LangWatch-Heartbeat-Active"),
		"the heartbeat must have fired, otherwise this test proves nothing")
	assert.Equal(t, "project:95", res.resp.Header.Get(budgetWarningHeader))
	assert.NotEmpty(t, res.resp.Header.Get("X-LangWatch-Gateway-Request-Id"),
		"the heartbeat commit must not swallow the other meta headers either")
}

// Every applicable budget contributes, so an operator can see which scope is
// the one running out.
/** @scenario "Every applicable budget over the threshold is named" */
func TestRouter_BudgetWarning_ListsEveryScopeOverTheThreshold(t *testing.T) {
	bundle := testBundle()
	bundle.Config.Budget.Scopes = []domain.BudgetScope{
		{Scope: "organization", Window: "month", LimitMicroUSD: 1_000_000, SpentMicroUSD: 840_000, OnBreach: "block"},
		{Scope: "project", Window: "day", LimitMicroUSD: 1_000_000, SpentMicroUSD: 200_000, OnBreach: "block"},
		{Scope: "virtual_key", Window: "day", LimitMicroUSD: 1_000_000, SpentMicroUSD: 990_000, OnBreach: "warn"},
	}
	srv := budgetServer(t, bundle, 0, fastProvider())

	resp := chatCall(t, srv, false)

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, "organization:84,virtual_key:99", resp.Header.Get(budgetWarningHeader))
}

// dialRecorder records which credential each dispatch used, so
// chain-filtering tests can assert who was dialed off a real HTTP round
// trip. dispatchFn runs on the server goroutine while the test goroutine
// reads the result, so the recording is mutex-guarded and read through a
// snapshot accessor rather than a raw slice.
type dialRecorder struct {
	mu     sync.Mutex
	dialed []string
}

func (r *dialRecorder) record(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.dialed = append(r.dialed, id)
}

func (r *dialRecorder) snapshot() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.dialed...)
}

func recordingProvider(rec *dialRecorder) app.ProviderRouter {
	return &mockStreamProvider{
		mockProvider: mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, cred domain.Credential) (*domain.Response, error) {
				rec.record(cred.ID)
				return successResponse(), nil
			},
		},
	}
}

// A provider-filtered budget constrains one vendor, not the request: with a
// second provider in reach the call succeeds over the wire, the exhausted
// vendor is skipped, and the warning header names the filtered budget so the
// caller hears WHY the routing changed (contract §4.6).
func TestRouter_FilteredBudget_BreachedProviderIsRoutedAround(t *testing.T) {
	rec := &dialRecorder{}
	bundle := testBundle()
	bundle.Credentials = []domain.Credential{
		{ID: "mp_primary", ProviderID: domain.ProviderOpenAI, APIKey: "sk-1"},
		{ID: "mp_secondary", ProviderID: domain.ProviderOpenAI, APIKey: "sk-2"},
	}
	bundle.Config.Fallback.MaxAttempts = 2
	bundle.Config.Budget.Scopes = []domain.BudgetScope{{
		ID: "gb_primary", Scope: "virtual_key", ScopeID: "vk-test|provider:mp_primary",
		ProviderKey: "mp_primary", Window: "day",
		LimitMicroUSD: 25_000_000, SpentMicroUSD: 25_000_000, OnBreach: "block",
	}}
	srv := budgetServer(t, bundle, 0, recordingProvider(rec))

	resp := chatCall(t, srv, false)

	assert.Equal(t, http.StatusOK, resp.StatusCode)
	assert.Equal(t, []string{"mp_secondary"}, rec.snapshot())
	assert.Equal(t, "virtual_key/mp_primary:100", resp.Header.Get(budgetWarningHeader))
}

// When the provider-filtered breach leaves nothing to dispatch to, the 402
// envelope must name the budget that emptied the chain: the caller is
// otherwise left guessing which of up to six budget dimensions to raise.
func TestRouter_FilteredBudget_EmptyChainReturns402NamingTheBudget(t *testing.T) {
	bundle := testBundle()
	bundle.Config.Budget.Scopes = []domain.BudgetScope{{
		ID: "gb_only", Scope: "virtual_key", ScopeID: "vk-test|provider:cred-1",
		ProviderKey: "cred-1", Window: "day",
		LimitMicroUSD: 25_000_000, SpentMicroUSD: 26_000_000, OnBreach: "block",
	}}
	srv := budgetServer(t, bundle, 0, fastProvider())

	resp := chatCall(t, srv, false)

	require.Equal(t, http.StatusPaymentRequired, resp.StatusCode)
	var envelope struct {
		Error struct {
			Type    string         `json:"type"`
			Message string         `json:"message"`
			Meta    map[string]any `json:"meta"`
		} `json:"error"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&envelope))
	assert.Equal(t, "budget_exceeded", envelope.Error.Type)
	assert.Equal(t, "gb_only", envelope.Error.Meta["budget_id"])
	assert.Equal(t, "cred-1", envelope.Error.Meta["budget_provider"])
	assert.Contains(t, envelope.Error.Message, "cred-1",
		"the message must say which provider's allowance ran out")
}

// The plain unfiltered 402 now names its budget too: scope and window ride
// the envelope meta so the admin knows which allowance to raise.
func TestRouter_Budget_402NamesTheBlockedBudget(t *testing.T) {
	bundle := testBundle()
	bundle.Config.Budget.Scopes = []domain.BudgetScope{{
		ID: "gb_project", Scope: "project", ScopeID: "proj-test", Window: "month",
		LimitMicroUSD: 100_000_000, SpentMicroUSD: 100_000_000, OnBreach: "block",
	}}
	srv := budgetServer(t, bundle, 0, fastProvider())

	resp := chatCall(t, srv, false)

	require.Equal(t, http.StatusPaymentRequired, resp.StatusCode)
	var envelope struct {
		Error struct {
			Message string         `json:"message"`
			Meta    map[string]any `json:"meta"`
		} `json:"error"`
	}
	require.NoError(t, json.NewDecoder(resp.Body).Decode(&envelope))
	assert.Equal(t, "gb_project", envelope.Error.Meta["budget_id"])
	assert.Equal(t, "project", envelope.Error.Meta["budget_scope"])
	assert.Equal(t, "month", envelope.Error.Meta["budget_window"])
	assert.Contains(t, envelope.Error.Message, "project spending limit")
}
