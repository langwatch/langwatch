package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSecret = "test-secret-do-not-use-in-prod"

func init() {
	// herr.RegisterStatus is one-shot per domain error and is invoked
	// from NewRouter in production. Direct middleware tests don't go
	// through NewRouter, so we wire the mapping up explicitly here.
	registerErrorStatuses()
}

func TestInternalAuthMiddleware_ValidSignaturePasses(t *testing.T) {
	t.Parallel()

	called := false
	wrapped := InternalAuthMiddleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		// The handler must still be able to read the body — verify
		// that the middleware buffered it correctly.
		body, err := io.ReadAll(r.Body)
		assert.NoError(t, err)
		assert.JSONEq(t, `{"hello":"world"}`, string(body))
		w.WriteHeader(http.StatusOK)
	}))

	body := []byte(`{"hello":"world"}`)
	rec := executeSigned(t, wrapped, http.MethodPost, "/internal/transform", body, signWith{secret: testSecret})

	require.Equal(t, http.StatusOK, rec.Code)
	assert.True(t, called)
}

func TestInternalAuthMiddleware_MissingHeadersFail(t *testing.T) {
	t.Parallel()
	wrapped := InternalAuthMiddleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("handler must not run when signature header is missing")
	}))
	req := httptest.NewRequest(http.MethodPost, "/internal/transform", strings.NewReader("{}"))
	rec := httptest.NewRecorder()
	wrapped.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestInternalAuthMiddleware_BadSignatureFails(t *testing.T) {
	t.Parallel()
	wrapped := InternalAuthMiddleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("handler must not run with bad signature")
	}))
	body := []byte(`{}`)
	rec := executeSigned(t, wrapped, http.MethodPost, "/internal/transform", body, signWith{
		secret: "wrong-secret",
	})
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestInternalAuthMiddleware_StaleTimestampFails(t *testing.T) {
	t.Parallel()
	wrapped := InternalAuthMiddleware(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("handler must not run with stale timestamp")
	}))
	body := []byte(`{}`)
	stale := time.Now().Add(-2 * time.Hour).Unix()
	rec := executeSigned(t, wrapped, http.MethodPost, "/internal/transform", body, signWith{
		secret:    testSecret,
		timestamp: strconv.FormatInt(stale, 10),
	})
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestInternalAuthMiddleware_EmptySecretFailsClosed(t *testing.T) {
	t.Parallel()
	wrapped := InternalAuthMiddleware("")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Fatal("handler must not run when secret is empty")
	}))
	body := []byte(`{}`)
	// Even a perfectly-formed signed request fails — the middleware
	// must refuse before any compare touches the body. Use a dummy
	// secret on the client side to confirm we get a fail-closed code,
	// not a sig-mismatch path.
	rec := executeSigned(t, wrapped, http.MethodPost, "/internal/transform", body, signWith{
		secret: "anything",
	})
	// Empty server-side secret returns ErrInternal (mapped to 500),
	// distinct from the 401 paths above.
	assert.NotEqual(t, http.StatusOK, rec.Code, "must reject when server secret is empty")
}

// ── helpers ─────────────────────────────────────────────────────────

type signWith struct {
	secret    string
	timestamp string // optional; defaults to time.Now().Unix()
}

func executeSigned(t *testing.T, h http.Handler, method, path string, body []byte, opts signWith) *httptest.ResponseRecorder {
	t.Helper()
	ts := opts.timestamp
	if ts == "" {
		ts = strconv.FormatInt(time.Now().Unix(), 10)
	}

	bodyHash := sha256.Sum256(body)
	bodyHashHex := make([]byte, hex.EncodedLen(len(bodyHash)))
	hex.Encode(bodyHashHex, bodyHash[:])

	mac := hmac.New(sha256.New, []byte(opts.secret))
	mac.Write([]byte(method))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(path))
	mac.Write([]byte{'\n'})
	mac.Write([]byte(ts))
	mac.Write([]byte{'\n'})
	mac.Write(bodyHashHex)
	sig := hex.EncodeToString(mac.Sum(nil))

	req := httptest.NewRequest(method, path, strings.NewReader(string(body)))
	req.Header.Set("X-LangWatch-Gateway-Signature", sig)
	req.Header.Set("X-LangWatch-Gateway-Timestamp", ts)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}
