package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestTraceRegistryMiddleware_PairsConfigProjectWithConfigToken(t *testing.T) {
	registry := customertracebridge.NewRegistry()
	bundle := &domain.Bundle{
		ProjectID: "project-from-stale-jwt",
		Config: domain.BundleConfig{
			TraceProjectID:   "project-from-fresh-config",
			ProjectOTLPToken: "token-from-fresh-config",
		},
	}
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	handler := TraceRegistryMiddleware(registry, "https://ingest.example.com")(next)
	request := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	request = request.WithContext(context.WithValue(request.Context(), bundleCtxKey{}, bundle))
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	require.Equal(t, http.StatusNoContent, recorder.Code)
	endpoint, headers, ok := registry.Lookup("project-from-fresh-config")
	require.True(t, ok)
	assert.Equal(t, "https://ingest.example.com", endpoint)
	assert.Equal(t, map[string]string{"X-Auth-Token": "token-from-fresh-config"}, headers)
	_, _, staleRegistered := registry.Lookup("project-from-stale-jwt")
	assert.False(t, staleRegistered, "the JWT project must never be paired with the config token")
}
