package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/app"
)

// @scenario "the gateway exposes its resolved control-plane target on an unauthenticated debug endpoint"
func TestDebugControlPlaneEndpoint_ReportsResolvedURL(t *testing.T) {
	reg := health.New("test")
	reg.MarkStarted()
	router := NewRouter(RouterDeps{
		App:                 app.New(),
		Logger:              zap.NewNop(),
		Health:              reg,
		ControlPlaneBaseURL: "http://localhost:7580",
	})

	req := httptest.NewRequest(http.MethodGet, "/debug/control-plane", nil)
	req.Header.Set("Authorization", "") // no credential of any kind
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, "the endpoint must not require auth")
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

	var body debugControlPlaneResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, "http://localhost:7580", body.ControlPlaneBaseURL)
}
