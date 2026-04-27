package health

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLiveness_AllOK(t *testing.T) {
	reg := New("v1.0.0")
	reg.RegisterLiveness("check-a", func() (bool, string) { return true, "" })
	reg.RegisterLiveness("check-b", func() (bool, string) { return true, "" })

	rec := httptest.NewRecorder()
	reg.Liveness(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	assert.Equal(t, http.StatusOK, rec.Code)

	var body probeResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, "ok", body.Status)
	assert.Equal(t, "v1.0.0", body.Version)
}

func TestLiveness_Degraded(t *testing.T) {
	reg := New("v1.0.0")
	reg.RegisterLiveness("good", func() (bool, string) { return true, "" })
	reg.RegisterLiveness("bad", func() (bool, string) { return false, "connection lost" })

	rec := httptest.NewRecorder()
	reg.Liveness(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)

	var body probeResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, "degraded", body.Status)
	assert.Equal(t, "connection lost", body.Checks["bad"])
}

func TestReadiness_Draining(t *testing.T) {
	reg := New("v1.0.0")
	reg.MarkDraining()

	rec := httptest.NewRecorder()
	reg.Readiness(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)

	var body probeResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, "draining", body.Status)
}

func TestStartup_NotStarted(t *testing.T) {
	reg := New("v1.0.0")

	rec := httptest.NewRecorder()
	reg.Startup(rec, httptest.NewRequest(http.MethodGet, "/startupz", nil))

	assert.Equal(t, http.StatusServiceUnavailable, rec.Code)

	var body probeResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, "starting", body.Status)
}

func TestStartup_Started(t *testing.T) {
	reg := New("v1.0.0")
	reg.MarkStarted()

	rec := httptest.NewRecorder()
	reg.Startup(rec, httptest.NewRequest(http.MethodGet, "/startupz", nil))

	assert.Equal(t, http.StatusOK, rec.Code)

	var body probeResponse
	require.NoError(t, json.NewDecoder(rec.Body).Decode(&body))
	assert.Equal(t, "ok", body.Status)
}
