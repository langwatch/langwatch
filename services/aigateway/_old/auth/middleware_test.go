package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/gateway/internal/httpx"
)

func mwTestCache(t *testing.T, fn func(string) (*Bundle, error)) *Cache {
	t.Helper()
	c, _ := NewCache(&fakeResolver{bundleFn: fn}, quietLogger(), CacheOptions{LRUSize: 10})
	return c
}

func TestMiddlewareAcceptsBearer(t *testing.T) {
	c := mwTestCache(t, nil)
	h := Middleware(c)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if b := BundleFromContext(r.Context()); b == nil || b.JWTClaims.VirtualKeyID != "vk_1" {
			t.Error("bundle missing from ctx")
		}
		w.WriteHeader(200)
	}))
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer lw_vk_live_testkey")
	req = req.WithContext(context.WithValue(req.Context(), struct{ k string }{"rid"}, "req_x"))
	rec := httptest.NewRecorder()
	httpx.RequestID(h).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMiddlewareAcceptsXApiKey(t *testing.T) {
	c := mwTestCache(t, nil)
	h := Middleware(c)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest("POST", "/v1/messages", nil)
	req.Header.Set("x-api-key", "lw_vk_live_anthropicstyle")
	rec := httptest.NewRecorder()
	httpx.RequestID(h).ServeHTTP(rec, req)
	if rec.Code != 200 {
		t.Fatalf("status: %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestMiddlewareMissingKeyReturns401Envelope(t *testing.T) {
	c := mwTestCache(t, nil)
	h := Middleware(c)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	rec := httptest.NewRecorder()
	httpx.RequestID(h).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d", rec.Code)
	}
	var env map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatal(err)
	}
	if env["error"].(map[string]any)["type"] != "invalid_api_key" {
		t.Errorf("error type: %+v", env)
	}
}

func TestMiddlewareRevokedKeyReturns401Revoked(t *testing.T) {
	c := mwTestCache(t, func(_ string) (*Bundle, error) { return nil, ErrKeyRevoked })
	h := Middleware(c)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(200) }))
	req := httptest.NewRequest("POST", "/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer revoked")
	rec := httptest.NewRecorder()
	httpx.RequestID(h).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status: %d", rec.Code)
	}
	var env map[string]any
	_ = json.NewDecoder(rec.Body).Decode(&env)
	if env["error"].(map[string]any)["type"] != "virtual_key_revoked" {
		t.Errorf("error type: %+v", env)
	}
}

// prevent "unused import" on time in package tests.
var _ = time.Second
