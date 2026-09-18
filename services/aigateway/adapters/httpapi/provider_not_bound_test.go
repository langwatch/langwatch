package httpapi

// Binds specs/ai-gateway/model-disambiguation.feature: the scenario for a
// model prefix naming a provider the virtual key has no slot for. The
// envelope is the whole point of the scenario — a 400 whose body names the
// provider and says how to bind it — so it is asserted here at the HTTP
// boundary rather than at the dispatcher, where the wire shape is invisible.

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

	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "Unknown provider prefix on VK returns 400 with clear envelope"
func TestChat_UnknownProviderPrefixReturnsNotBoundEnvelope(t *testing.T) {
	dispatched := false
	provider := &mockProvider{
		dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
			dispatched = true
			return successResponse(), nil
		},
	}
	auth := &mockAuth{
		resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
			// An OpenAI slot and nothing else: the key works, it just has
			// no bedrock binding. This is the shape that used to reach
			// Bifrost and come back as an opaque provider-config error.
			return testBundle(), nil
		},
	}
	router := buildRouter(
		app.WithAuth(auth),
		app.WithProviders(provider),
		app.WithModels(modelresolver.New()),
		app.WithLogger(zap.NewNop()),
	)

	body := `{"model":"bedrock/claude-3-haiku","messages":[{"role":"user","content":"hi"}]}`
	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk-lw-test")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	require.Equal(t, http.StatusBadRequest, rec.Code)
	assert.False(t, dispatched, "a request naming an unbound provider must not reach any provider")

	var env struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
			Hint    string `json:"hint"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env), "body: %s", rec.Body.String())
	assert.Equal(t, string(domain.ErrProviderNotBound), env.Error.Code)
	// Naming the provider AND why it is unavailable is what separates this
	// from the opaque errors it replaces: a caller must learn both which
	// provider was refused and that it is not reachable from the key's scope.
	assert.Contains(t, rec.Body.String(), "bedrock")
	assert.Contains(t, rec.Body.String(), "not reachable from this key's scope")
}

// @scenario "A provider-native route refuses a key with no provider that speaks it"
//
// The Gemini surface forwards the body and the URL path to Google as they
// arrived, so a key with no Google credential has to be refused. Before this,
// the chain fell through and the body went to OpenAI, which answered 404 for
// a model it never had. Asserted at the HTTP boundary because the point of
// the scenario is that the caller reads a refusal naming the missing slot,
// and that no vendor saw the prompt.
func TestGeminiPassthrough_NoGoogleCredentialRefusesBeforeAnyProvider(t *testing.T) {
	for _, path := range []string{
		"/v1beta/models/gemini-2.5-flash:generateContent",
		"/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
	} {
		t.Run(path, func(t *testing.T) {
			dispatched := false
			provider := &mockStreamProvider{
				mockProvider: mockProvider{
					dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
						dispatched = true
						return successResponse(), nil
					},
				},
				dispatchStreamFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (domain.StreamIterator, error) {
					dispatched = true
					return &emptyStreamIter{}, nil
				},
			}
			auth := &mockAuth{
				resolveFn: func(_ context.Context, _ string) (*domain.Bundle, error) {
					// An OpenAI slot and nothing else. The key works; it just
					// cannot reach Google.
					return testBundle(), nil
				},
			}
			router := buildRouter(
				app.WithAuth(auth),
				app.WithProviders(provider),
				app.WithModels(modelresolver.New()),
				app.WithLogger(zap.NewNop()),
			)

			body := `{"contents":[{"role":"user","parts":[{"text":"hi"}]}]}`
			req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
			req.Header.Set("X-Goog-Api-Key", "vk-lw-test")
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			require.Equal(t, http.StatusBadRequest, rec.Code, rec.Body.String())
			assert.False(t, dispatched, "the prompt must not reach any provider on a route this key cannot speak")

			var env struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &env), "body: %s", rec.Body.String())
			assert.Equal(t, string(domain.ErrProviderNotBound), env.Error.Code)
			// Naming both providers is what makes the refusal actionable: the
			// caller has to know which slot to bind.
			assert.Contains(t, rec.Body.String(), "gemini")
			assert.Contains(t, rec.Body.String(), "vertex")
		})
	}
}
