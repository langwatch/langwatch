package httpapi

// The HTTP boundary of the realtime session mints: the auth header an
// ElevenLabs SDK sends, and the status a caller at its session cap sees.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "An ElevenLabs SDK reaches the mint with its own auth header"
func TestElevenLabsAuthHeaderResolvesTheVirtualKey(t *testing.T) {
	t.Parallel()

	// The mint mirrors ElevenLabs' own path, so an SDK reaches it by base
	// URL alone. Without this header it would also need its auth rewired,
	// which is the whole change the mirroring exists to avoid.
	req := httptest.NewRequest(http.MethodGet,
		"/v1/convai/conversation/get-signed-url?agent_id=agent_1", nil)
	req.Header.Set("xi-api-key", "vk-lw-secret")

	assert.Equal(t, "vk-lw-secret", extractToken(req))
}

func TestEveryAcceptedAuthHeaderResolvesTheVirtualKey(t *testing.T) {
	t.Parallel()

	for name, set := range map[string]func(*http.Request){
		"Authorization": func(r *http.Request) { r.Header.Set("Authorization", "Bearer vk-lw-secret") },
		"x-api-key":     func(r *http.Request) { r.Header.Set("X-Api-Key", "vk-lw-secret") },
		"x-goog-api-key": func(r *http.Request) {
			r.Header.Set("X-Goog-Api-Key", "vk-lw-secret")
		},
		"xi-api-key": func(r *http.Request) { r.Header.Set("Xi-Api-Key", "vk-lw-secret") },
	} {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
			set(req)
			assert.Equal(t, "vk-lw-secret", extractToken(req))
		})
	}
}

// @scenario "A cap refusal answers HTTP 429"
func TestRealtimeErrorCodesCarryTheirOwnStatuses(t *testing.T) {
	t.Parallel()

	registerErrorStatuses()

	// 429, like the rate limit: a slot frees when a call ends, so a client
	// should back off and retry rather than treat the refusal as terminal.
	assert.Equal(t, http.StatusTooManyRequests,
		herr.HTTPStatus(herr.New(t.Context(), domain.ErrRealtimeSessionLimit, nil)))
	// 503: the control plane failed us, not the caller.
	assert.Equal(t, http.StatusServiceUnavailable,
		herr.HTTPStatus(herr.New(t.Context(), domain.ErrRealtimeRegistryUnavailable, nil)))
}

// fakeRegistry is the control plane's session record, as the routes see it.
type fakeRegistry struct {
	reserved  []domain.RealtimeReservation
	released  []domain.RealtimeRelease
	reports   []domain.RealtimeUsageReport
	receipt   domain.RealtimeUsageReceipt
	reportErr error
}

func (f *fakeRegistry) Reserve(_ context.Context, r domain.RealtimeReservation) error {
	f.reserved = append(f.reserved, r)
	return nil
}

func (f *fakeRegistry) Correlate(context.Context, domain.RealtimeCorrelation) error { return nil }

func (f *fakeRegistry) Release(_ context.Context, r domain.RealtimeRelease) error {
	f.released = append(f.released, r)
	return nil
}

func (f *fakeRegistry) ReportUsage(_ context.Context, r domain.RealtimeUsageReport) (domain.RealtimeUsageReceipt, error) {
	if f.reportErr != nil {
		return domain.RealtimeUsageReceipt{}, f.reportErr
	}
	f.reports = append(f.reports, r)
	return f.receipt, nil
}

// tokenRouter serves the mint routes with a vendor that answers one token.
func tokenRouter(registry *fakeRegistry, capture *domain.Request, config domain.BundleConfig, creds ...domain.Credential) http.Handler {
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, req *domain.Request, _ domain.Credential) (*domain.Response, error) {
			if capture != nil {
				*capture = *req
			}
			return &domain.Response{
				StatusCode: http.StatusOK,
				Body:       []byte(`{"token":"sutkn_abc","langwatch":{"session_id":"` + req.RealtimeSession.SessionID + `"}}`),
			}, nil
		},
	}
	auth := &mockAuth{resolveFn: func(context.Context, string) (*domain.Bundle, error) {
		bundle := testBundle()
		bundle.Credentials = creds
		config.Fallback = domain.FallbackConfig{MaxAttempts: 1}
		bundle.Config = config
		return bundle, nil
	}}
	return buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithRealtimeSessions(registry),
		app.WithLogger(zap.NewNop()),
	)
}

func mintToken(router http.Handler, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, target, nil)
	req.Header.Set("xi-api-key", "vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// @scenario "An ElevenLabs single-use token is minted for each socket type"
func TestSingleUseTokenRouteMintsEachTokenType(t *testing.T) {
	t.Parallel()

	for tokenType, want := range map[string]struct {
		model string
		kind  domain.RealtimeSessionKind
	}{
		"tts_websocket":   {"eleven_multilingual_v2", domain.RealtimeKindTTSSocket},
		"ttd_websocket":   {"eleven_v3_conversational", domain.RealtimeKindTTSSocket},
		"realtime_scribe": {"scribe_v2_realtime", domain.RealtimeKindSTTSocket},
		"batch_scribe":    {"scribe_v2", domain.RealtimeKindSTTBatch},
	} {
		t.Run(tokenType, func(t *testing.T) {
			t.Parallel()
			registry := &fakeRegistry{}
			var captured domain.Request
			router := tokenRouter(registry, &captured, domain.BundleConfig{}, elevenLabsCred())

			rec := mintToken(router, "/v1/single-use-token/"+tokenType)

			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			sessionID := rec.Header().Get("X-LangWatch-Session-Id")
			require.NotEmpty(t, sessionID)
			assert.JSONEq(t, `{"token":"sutkn_abc","langwatch":{"session_id":"`+sessionID+`"}}`, rec.Body.String(),
				"the vendor's own body, with the session id beside it")

			assert.Equal(t, domain.ElevenLabsSingleUseTokenSurface(), captured.Surface)
			assert.Equal(t, domain.ElevenLabsTokenType(tokenType), captured.RealtimeSession.TokenType)
			require.Len(t, registry.reserved, 1)
			assert.Equal(t, want.model, registry.reserved[0].Model, "the default of the socket this token opens")
			assert.Equal(t, want.kind, registry.reserved[0].Kind)
			assert.Equal(t, sessionID, registry.reserved[0].SessionID)
		})
	}
}

// @scenario "An unknown token type is refused"
func TestSingleUseTokenRouteRefusesAnUnknownTokenType(t *testing.T) {
	t.Parallel()

	registry := &fakeRegistry{}
	rec := mintToken(tokenRouter(registry, nil, domain.BundleConfig{}, elevenLabsCred()),
		"/v1/single-use-token/convai")

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	for _, name := range []string{"tts_websocket", "ttd_websocket", "realtime_scribe", "batch_scribe"} {
		assert.Contains(t, rec.Body.String(), name)
	}
	assert.Empty(t, registry.reserved)
}

// @scenario "The single-use token route is served only by an ElevenLabs credential"
func TestSingleUseTokenRouteRefusesAKeyWithNoElevenLabsCredential(t *testing.T) {
	t.Parallel()

	registry := &fakeRegistry{}
	router := tokenRouter(registry, nil, domain.BundleConfig{},
		domain.Credential{ID: "cred-1", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"})

	rec := mintToken(router, "/v1/single-use-token/tts_websocket")

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), string(domain.ErrProviderNotBound))
	assert.Empty(t, registry.reserved, "nothing is booked for a mint no credential can serve")
}

// @scenario "The model_id query parameter decides the token's model"
func TestSingleUseTokenRouteTakesTheModelFromTheQuery(t *testing.T) {
	t.Parallel()

	t.Run("named model is booked", func(t *testing.T) {
		t.Parallel()
		registry := &fakeRegistry{}
		rec := mintToken(tokenRouter(registry, nil, domain.BundleConfig{}, elevenLabsCred()),
			"/v1/single-use-token/tts_websocket?model_id=eleven_v3")
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "eleven_v3", registry.reserved[0].Model)
	})

	t.Run("alias resolves", func(t *testing.T) {
		t.Parallel()
		registry := &fakeRegistry{}
		config := domain.BundleConfig{ModelAliases: map[string]domain.ModelAlias{
			"fast-voice": {ProviderID: domain.ProviderElevenLabs, Model: "eleven_flash_v2_5"},
		}}
		rec := mintToken(tokenRouter(registry, nil, config, elevenLabsCred()),
			"/v1/single-use-token/tts_websocket?model_id=fast-voice")
		require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
		assert.Equal(t, "eleven_flash_v2_5", registry.reserved[0].Model)
		assert.Equal(t, "fast-voice", registry.reserved[0].RequestedModel)
	})

	t.Run("model outside the allowlist is refused", func(t *testing.T) {
		t.Parallel()
		registry := &fakeRegistry{}
		config := domain.BundleConfig{AllowedModels: []string{"eleven_flash_v2_5"}}
		rec := mintToken(tokenRouter(registry, nil, config, elevenLabsCred()),
			"/v1/single-use-token/tts_websocket")
		assert.Contains(t, rec.Body.String(), string(domain.ErrModelNotAllowed),
			"the default model is judged by the allowlist like a named one")
		assert.Empty(t, registry.reserved)
	})
}

func usageRouter(registry *fakeRegistry) http.Handler {
	return buildRouter(
		app.WithAuth(audioAuth()),
		app.WithRealtimeSessions(registry),
		app.WithLogger(zap.NewNop()),
	)
}

func postSession(router http.Handler, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/v1/realtime/sessions/"+path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// @scenario "A usage report answers its cost and the budget state"
func TestRealtimeUsageRouteAnswersCostsInDollarsAndTheBudgetState(t *testing.T) {
	t.Parallel()

	registry := &fakeRegistry{receipt: domain.RealtimeUsageReceipt{
		Status:             domain.RealtimeReportRecorded,
		CostNanoUSD:        1_250_000,
		SessionCostNanoUSD: 20_000_000,
		Budget:             domain.RealtimeBudgetState{Exceeded: true, Scope: "virtual_key", BudgetID: "bud_1"},
	}}
	rec := postSession(usageRouter(registry), "req_1/usage",
		`{"type":"response.done","response":{"id":"resp_1","usage":{"input_tokens":10,"output_tokens":4}}}`)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	assert.JSONEq(t, `{"session_id":"req_1","status":"recorded","cost_usd":0.00125,"session_cost_usd":0.02,
	  "budget":{"exceeded":true,"scope":"virtual_key","budget_id":"bud_1"}}`, rec.Body.String())

	require.Len(t, registry.reports, 1)
	assert.Equal(t, "resp_1", registry.reports[0].ReportKey)
	assert.Equal(t, "req_1", registry.reports[0].SessionID)
	assert.Equal(t, "vk-test", registry.reports[0].VirtualKeyID)
}

func TestRealtimeUsageRouteOmitsTheBudgetNameWhenNothingIsExceeded(t *testing.T) {
	t.Parallel()

	registry := &fakeRegistry{receipt: domain.RealtimeUsageReceipt{Status: domain.RealtimeReportClosed}}
	rec := postSession(usageRouter(registry), "req_1/usage", `{"usage":{"input_tokens":10,"output_tokens":4}}`)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"session_id":"req_1","status":"closed","cost_usd":0,"session_cost_usd":0,
	  "budget":{"exceeded":false}}`, rec.Body.String())
}

// @scenario "A close ends the session with no usage"
func TestRealtimeCloseRouteTakesAnEmptyBodyOrADuration(t *testing.T) {
	t.Parallel()

	for name, tc := range map[string]struct {
		body     string
		duration int64
	}{
		"empty body":    {body: ``},
		"with duration": {body: `{"duration_ms":42000}`, duration: 42000},
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			registry := &fakeRegistry{receipt: domain.RealtimeUsageReceipt{
				Status: domain.RealtimeReportClosed, SessionCostNanoUSD: 3_000_000_000,
			}}
			rec := postSession(usageRouter(registry), "req_1/close", tc.body)

			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			var answer map[string]any
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &answer))
			assert.Equal(t, "closed", answer["status"])
			assert.InDelta(t, 3.0, answer["session_cost_usd"], 1e-9)

			require.Len(t, registry.reports, 1)
			assert.True(t, registry.reports[0].Final)
			assert.Nil(t, registry.reports[0].Usage)
			assert.Equal(t, tc.duration, registry.reports[0].DurationMS)
		})
	}
}

func TestRealtimeCloseRouteRefusesABodyThatIsNotAnObject(t *testing.T) {
	t.Parallel()

	registry := &fakeRegistry{}
	rec := postSession(usageRouter(registry), "req_1/close", `[1]`)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Empty(t, registry.reports)
}

// @scenario "A report against a session the key does not own answers 404"
func TestRealtimeUsageRouteAnswers404ForAnUnknownSession(t *testing.T) {
	t.Parallel()

	registry := &fakeRegistry{reportErr: herr.New(context.Background(), domain.ErrNotFound, herr.M{
		"message": "no open realtime session with that id belongs to this key",
	})}
	for _, target := range []string{"req_other/usage", "req_other/close"} {
		rec := postSession(usageRouter(registry), target, `{"input_tokens":1,"output_tokens":1,"final":true}`)
		assert.Equal(t, http.StatusNotFound, rec.Code, target)
	}
}

// @scenario "A usage body that is not a report is refused"
func TestRealtimeUsageRouteRefusesABodyThatIsNotAReport(t *testing.T) {
	t.Parallel()

	registry := &fakeRegistry{}
	rec := postSession(usageRouter(registry), "req_1/usage", `{"type":"session.created"}`)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Empty(t, registry.reports)
}

// @scenario "A token mint over budget is refused before anything is booked"
func TestSingleUseTokenRouteStopsAtAnExhaustedBudget(t *testing.T) {
	t.Parallel()

	registry := &fakeRegistry{}
	dialed := false
	router := buildRouter(
		app.WithAuth(audioAuth(elevenLabsCred())),
		app.WithProviders(&mockProvider{
			dispatchFn: func(context.Context, *domain.Request, domain.Credential) (*domain.Response, error) {
				dialed = true
				return &domain.Response{StatusCode: http.StatusOK, Body: []byte(`{"token":"sutkn_abc"}`)}, nil
			},
		}),
		app.WithBudget(&mockBudget{
			precheckFn: func(context.Context, *domain.Bundle) (domain.BudgetDecision, error) {
				return domain.BudgetDecision{Verdict: domain.BudgetBlock}, nil
			},
		}),
		app.WithRealtimeSessions(registry),
		app.WithLogger(zap.NewNop()),
	)

	rec := mintToken(router, "/v1/single-use-token/tts_websocket")

	assert.Equal(t, http.StatusPaymentRequired, rec.Code, rec.Body.String())
	assert.Empty(t, registry.reserved)
	assert.False(t, dialed, "no token is minted for a key with nothing left to spend")
}
