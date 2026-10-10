package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type keyRecorder struct{ seen []domain.PresentedKey }

func (k *keyRecorder) Resolve(_ context.Context, key domain.PresentedKey) (*domain.Bundle, error) {
	k.seen = append(k.seen, key)
	return &domain.Bundle{VirtualKeyID: "vk"}, nil
}

func serveThroughAuth(t *testing.T, resolver *keyRecorder, headers map[string]string) {
	t.Helper()
	handler := AuthMiddleware(resolver)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	for name, value := range headers {
		req.Header.Set(name, value)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code)
}

func TestAuthMiddleware_LicenseToken_CarriesTheInstanceHeader(t *testing.T) {
	resolver := &keyRecorder{}
	token := domain.LicenseTokenPrefix + strings.Repeat("a", 64)

	serveThroughAuth(t, resolver, map[string]string{
		"Authorization":        "Bearer " + token,
		"X-LangWatch-Instance": "  instance-a ",
	})

	assert.Equal(t, []domain.PresentedKey{{Token: token, InstanceID: "instance-a"}}, resolver.seen)
}

// A virtual key must resolve and cache the same whatever headers ride along,
// so the instance header is not read for one.
func TestAuthMiddleware_VirtualKey_IgnoresTheInstanceHeader(t *testing.T) {
	resolver := &keyRecorder{}
	virtualKey := "vk-lw-" + strings.Repeat("A", 26)

	serveThroughAuth(t, resolver, map[string]string{
		"Authorization":        "Bearer " + virtualKey,
		"X-LangWatch-Instance": "instance-a",
	})

	assert.Equal(t, []domain.PresentedKey{{Token: virtualKey}}, resolver.seen)
}
