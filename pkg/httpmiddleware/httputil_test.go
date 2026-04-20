package httpmiddleware

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- RequestID middleware ---

func TestRequestID_Generated(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := GetRequestID(r.Context())
		assert.NotEmpty(t, id, "context should have a request ID")
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusOK, rec.Code)
	respID := rec.Header().Get("X-Request-Id")
	assert.NotEmpty(t, respID, "response should have X-Request-Id header")
	assert.True(t, len(respID) > 4, "generated ID should be longer than prefix")
}

func TestRequestID_FromClient(t *testing.T) {
	handler := RequestID(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "client-id-99", GetRequestID(r.Context()))
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Request-Id", "client-id-99")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, "client-id-99", rec.Header().Get("X-Request-Id"))
}

// --- RequireBearer middleware ---

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
}

func TestRequireBearer_ValidToken(t *testing.T) {
	handler := RequireBearer("secret-token", "test", okHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer secret-token")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestRequireBearer_MissingToken(t *testing.T) {
	handler := RequireBearer("secret-token", "test", okHandler())

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestRequireBearer_WrongToken(t *testing.T) {
	handler := RequireBearer("secret-token", "test", okHandler())

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer wrong-token")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestRequireBearer_EmptyToken(t *testing.T) {
	handler := RequireBearer("", "test", okHandler())

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, http.StatusOK, rec.Code, "empty token config should passthrough")
}

// --- Version middleware ---

func TestVersion_SetsHeader(t *testing.T) {
	handler := Version("X-App-Version", "v2.1.0")(okHandler())

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	assert.Equal(t, "v2.1.0", rec.Header().Get("X-App-Version"))
}

// --- MaxBodyBytes middleware ---

func TestMaxBodyBytes_RejectsLargeContentLength(t *testing.T) {
	handler := MaxBodyBytes(1024)(okHandler())

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.ContentLength = 2048

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
}

// --- IsLoopbackAddr ---

func TestIsLoopbackAddr(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{"127.0.0.1:8080", true},
		{"localhost:80", true},
		{"0.0.0.0:80", false},
		{"1.2.3.4:80", false},
	}

	for _, tc := range tests {
		t.Run(tc.addr, func(t *testing.T) {
			assert.Equal(t, tc.want, IsLoopbackAddr(tc.addr))
		})
	}
}

// --- InFlight middleware ---

// atomicGauge is a simple Gauge implementation for testing.
type atomicGauge struct {
	n int64
}

func (g *atomicGauge) Inc() { atomic.AddInt64(&g.n, 1) }
func (g *atomicGauge) Dec() { atomic.AddInt64(&g.n, -1) }

func TestInFlight(t *testing.T) {
	g := &atomicGauge{}
	var captured int64

	inner := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		captured = atomic.LoadInt64(&g.n)
		w.WriteHeader(http.StatusOK)
	})

	handler := InFlight(g)(inner)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, int64(1), captured, "gauge should be 1 during request")
	assert.Equal(t, int64(0), atomic.LoadInt64(&g.n), "gauge should be 0 after request")
}
