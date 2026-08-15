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
	// Naming the provider is what separates this from the opaque errors it
	// replaces; a hint that does not say which slot is missing would leave
	// the caller exactly where they started.
	assert.Contains(t, rec.Body.String(), "bedrock")
	assert.Contains(t, rec.Body.String(), "virtual key")
}
