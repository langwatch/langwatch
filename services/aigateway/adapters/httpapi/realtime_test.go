package httpapi

// The HTTP boundary of the realtime session mints: the auth header an
// ElevenLabs SDK sends, and the status a caller at its session cap sees.
//
// Binds specs/ai-gateway/realtime-sessions.feature.

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/pkg/herr"
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
