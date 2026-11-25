package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Spec: specs/ai-gateway/a2a-proxy.feature
//
// @scenario "a call without a valid virtual key is refused uncacheable too"
func TestA2ARouteRefusesAMissingOrWrongKeyWithNoStore(t *testing.T) {
	reg := health.New("test")
	reg.MarkStarted()
	proxied := false
	auth := &mockAuth{resolveFn: func(ctx context.Context, _ string) (*domain.Bundle, error) {
		return nil, herr.New(ctx, domain.ErrInvalidAPIKey, nil)
	}}
	router := NewRouter(RouterDeps{
		App:    app.New(app.WithAuth(auth)),
		Logger: zap.NewNop(),
		Health: reg,
		A2A:    http.HandlerFunc(func(http.ResponseWriter, *http.Request) { proxied = true }),
	})

	for _, key := range []string{"", "Bearer vk-lw-wrong"} {
		req := httptest.NewRequest(http.MethodPost, "/a2a/billing", strings.NewReader(`{}`))
		if key != "" {
			req.Header.Set("Authorization", key)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)

		assert.Equal(t, http.StatusUnauthorized, rec.Code, key)
		assert.Equal(t, "no-store", rec.Header().Get("Cache-Control"), key)
	}
	assert.False(t, proxied, "the proxy must not run without a valid key")
}
