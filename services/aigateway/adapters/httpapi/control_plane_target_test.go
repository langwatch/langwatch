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

const internalControlPlaneURL = "http://langwatch-app.internal-namespace.svc.cluster.local:5560"

func controlPlaneRouter() http.Handler {
	reg := health.New("test")
	reg.MarkStarted()
	return NewRouter(RouterDeps{
		App:                 app.New(),
		Logger:              zap.NewNop(),
		Health:              reg,
		InternalSecret:      testSecret,
		ControlPlaneBaseURL: internalControlPlaneURL,
	})
}

// @scenario "an unsigned request learns nothing about the control plane's address"
func TestControlPlaneTarget_UnsignedRequestsLearnNothing(t *testing.T) {
	router := controlPlaneRouter()

	for _, path := range []string{"/debug/control-plane", "/internal/control-plane"} {
		t.Run(path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

			assert.NotEqual(t, http.StatusOK, rec.Code)
			assert.NotContains(t, rec.Body.String(), "svc.cluster.local",
				"the control plane's in-cluster hostname must not reach an unsigned caller")
		})
	}
}

// @scenario "the gateway reports its resolved control-plane target to a signed internal request"
func TestControlPlaneTarget_SignedInternalRequestGetsTheURL(t *testing.T) {
	rec := executeSigned(t, controlPlaneRouter(), http.MethodGet, "/internal/control-plane", nil, signWith{secret: testSecret})

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))
	var body controlPlaneTargetResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, internalControlPlaneURL, body.ControlPlaneBaseURL)
}
