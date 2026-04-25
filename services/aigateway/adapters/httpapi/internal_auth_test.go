package httpapi

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const testSecret = "5e09bc8e6a89cb33f8c6e3aafd2ce9f3a1d3f2e8c2c75a78937ab3a4cb9b1e5f"

func TestMain(m *testing.M) {
	registerErrorStatuses()
	m.Run()
}

func TestInternalAuth_AbsentHeaderFallsThrough(t *testing.T) {
	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	called := false
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		if BundleFromContext(r.Context()) != nil {
			t.Fatalf("bundle should not be set when no internal-auth header is present")
		}
	}))

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", strings.NewReader("{}"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if !called {
		t.Fatalf("next handler must run when internal-auth header is absent")
	}
}

func TestInternalAuth_SuccessOpenAI(t *testing.T) {
	body := []byte(`{"model":"openai/gpt-5-mini","messages":[]}`)
	creds := mustEncodeInline(t, map[string]any{
		"provider": "openai",
		"openai":   map[string]string{"api_key": "sk-test", "api_base": "https://api.openai.com/v1"},
	})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", body, creds, "proj_acme")

	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	var capturedBundle *domain.Bundle
	var capturedBody []byte
	h := mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedBundle = BundleFromContext(r.Context())
		capturedBody, _ = io.ReadAll(r.Body)
	}))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	if rec.Code != 200 {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if capturedBundle == nil {
		t.Fatalf("expected synthetic bundle on context")
	}
	if capturedBundle.ProjectID != "proj_acme" {
		t.Fatalf("expected projectID proj_acme, got %q", capturedBundle.ProjectID)
	}
	if len(capturedBundle.Credentials) != 1 {
		t.Fatalf("expected 1 credential, got %d", len(capturedBundle.Credentials))
	}
	cred := capturedBundle.Credentials[0]
	if cred.ProviderID != domain.ProviderOpenAI {
		t.Fatalf("expected ProviderOpenAI, got %q", cred.ProviderID)
	}
	if cred.APIKey != "sk-test" {
		t.Fatalf("expected APIKey sk-test, got %q", cred.APIKey)
	}
	if cred.Extra["api_base"] != "https://api.openai.com/v1" {
		t.Fatalf("expected Extra[api_base], got %v", cred.Extra)
	}
	if !bytes.Equal(capturedBody, body) {
		t.Fatalf("body must be re-readable by the handler unchanged")
	}
}

func TestInternalAuth_SuccessAzure(t *testing.T) {
	creds := mustEncodeInline(t, map[string]any{
		"provider": "azure",
		"azure": map[string]any{
			"api_key":       "azk",
			"api_base":      "https://acme.openai.azure.com",
			"api_version":   "2024-05-01-preview",
			"extra_headers": map[string]string{"X-Tag": "acme"},
		},
	})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", []byte(`{}`), creds, "proj_a")

	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	var b *domain.Bundle
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b = BundleFromContext(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), req)

	if b == nil || b.Credentials[0].ProviderID != domain.ProviderAzure {
		t.Fatalf("expected azure credential, got %#v", b)
	}
	if b.Credentials[0].APIKey != "azk" {
		t.Fatalf("expected APIKey azk, got %q", b.Credentials[0].APIKey)
	}
	if b.Credentials[0].Extra["api_base"] != "https://acme.openai.azure.com" {
		t.Fatalf("expected Extra[api_base], got %v", b.Credentials[0].Extra)
	}
	if b.Credentials[0].Extra["api_version"] != "2024-05-01-preview" {
		t.Fatalf("expected Extra[api_version], got %v", b.Credentials[0].Extra)
	}
	// extra_headers was a JSON object — middleware re-marshals it as a JSON string.
	got := b.Credentials[0].Extra["extra_headers"]
	if !strings.Contains(got, "X-Tag") || !strings.Contains(got, "acme") {
		t.Fatalf("expected extra_headers to round-trip as JSON, got %q", got)
	}
}

func TestInternalAuth_SuccessBedrock(t *testing.T) {
	creds := mustEncodeInline(t, map[string]any{
		"provider": "bedrock",
		"bedrock": map[string]string{
			"aws_access_key_id":     "AKIA",
			"aws_secret_access_key": "secret",
			"aws_region_name":       "us-east-1",
		},
	})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", []byte(`{}`), creds, "p1")
	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	var b *domain.Bundle
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b = BundleFromContext(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), req)
	if b == nil || b.Credentials[0].ProviderID != domain.ProviderBedrock {
		t.Fatalf("expected bedrock credential, got %#v", b)
	}
	if b.Credentials[0].APIKey != "" {
		t.Fatalf("bedrock APIKey should be empty (creds in Extra), got %q", b.Credentials[0].APIKey)
	}
	if b.Credentials[0].Extra["aws_access_key_id"] != "AKIA" {
		t.Fatalf("expected aws_access_key_id in Extra")
	}
}

func TestInternalAuth_SuccessVertex(t *testing.T) {
	creds := mustEncodeInline(t, map[string]any{
		"provider": "vertex_ai",
		"vertex_ai": map[string]string{
			"vertex_credentials": `{"type":"service_account"}`,
			"vertex_project":     "acme-vertex",
			"vertex_location":    "us-central1",
		},
	})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", []byte(`{}`), creds, "p1")
	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	var b *domain.Bundle
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b = BundleFromContext(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), req)
	if b == nil || b.Credentials[0].ProviderID != domain.ProviderVertex {
		t.Fatalf("expected vertex credential, got %#v", b)
	}
	if b.Credentials[0].Extra["vertex_project"] != "acme-vertex" {
		t.Fatalf("expected vertex_project")
	}
	if b.Credentials[0].Extra["vertex_credentials"] != `{"type":"service_account"}` {
		t.Fatalf("expected vertex_credentials inline")
	}
}

func TestInternalAuth_SuccessCustomMapsToOpenAI(t *testing.T) {
	creds := mustEncodeInline(t, map[string]any{
		"provider": "custom",
		"custom":   map[string]string{"api_key": "k", "api_base": "https://api.together.xyz/v1"},
	})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", []byte(`{}`), creds, "p1")
	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	var b *domain.Bundle
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b = BundleFromContext(r.Context())
	})).ServeHTTP(httptest.NewRecorder(), req)
	if b == nil || b.Credentials[0].ProviderID != domain.ProviderOpenAI {
		t.Fatalf("custom must map to openai provider for OpenAI-compat dispatch, got %#v", b)
	}
	if b.Credentials[0].Extra["api_base"] != "https://api.together.xyz/v1" {
		t.Fatalf("expected api_base in Extra")
	}
}

func TestInternalAuth_TamperedBodyRejected(t *testing.T) {
	body := []byte(`{"model":"openai/gpt-5-mini"}`)
	creds := mustEncodeInline(t, map[string]any{"provider": "openai", "openai": map[string]string{"api_key": "k"}})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", body, creds, "p1")

	// Tamper: replace body with different bytes after signing.
	req.Body = io.NopCloser(strings.NewReader(`{"model":"openai/EVIL"}`))

	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	called := false
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})).ServeHTTP(rec, req)
	if called {
		t.Fatalf("handler must not run on tampered body")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on tampered body, got %d", rec.Code)
	}
}

func TestInternalAuth_TamperedCredsRejected(t *testing.T) {
	creds := mustEncodeInline(t, map[string]any{"provider": "openai", "openai": map[string]string{"api_key": "k"}})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", []byte(`{}`), creds, "p1")

	// Tamper: swap creds header for an evil one after signing.
	evil := mustEncodeInline(t, map[string]any{"provider": "openai", "openai": map[string]string{"api_key": "EVIL"}})
	req.Header.Set(HeaderInlineCredentials, evil)

	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	called := false
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
	})).ServeHTTP(rec, req)
	if called {
		t.Fatalf("handler must not run on tampered creds")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on tampered creds, got %d", rec.Code)
	}
}

func TestInternalAuth_StaleTimestampRejected(t *testing.T) {
	body := []byte(`{}`)
	creds := mustEncodeInline(t, map[string]any{"provider": "openai", "openai": map[string]string{"api_key": "k"}})

	staleTS := time.Now().Add(-10 * time.Minute).Unix()
	req := signWithTS(t, "POST", "/v1/chat/completions", body, creds, "p1", staleTS)

	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("handler must not run on stale timestamp")
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestInternalAuth_FutureTimestampRejected(t *testing.T) {
	body := []byte(`{}`)
	creds := mustEncodeInline(t, map[string]any{"provider": "openai", "openai": map[string]string{"api_key": "k"}})

	futureTS := time.Now().Add(10 * time.Minute).Unix()
	req := signWithTS(t, "POST", "/v1/chat/completions", body, creds, "p1", futureTS)

	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("handler must not run on future timestamp")
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestInternalAuth_MissingProjectIDRejected(t *testing.T) {
	creds := mustEncodeInline(t, map[string]any{"provider": "openai", "openai": map[string]string{"api_key": "k"}})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", []byte(`{}`), creds, "")

	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("handler must not run without project id")
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestInternalAuth_BadProviderRejected(t *testing.T) {
	creds := mustEncodeInline(t, map[string]any{"provider": "weird-llm"})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", []byte(`{}`), creds, "p1")

	mw := InternalAuthMiddleware(testSecret, 1024*1024)
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("handler must not run with unknown provider")
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
}

func TestInternalAuth_DisabledWhenSecretEmpty(t *testing.T) {
	creds := mustEncodeInline(t, map[string]any{"provider": "openai", "openai": map[string]string{"api_key": "k"}})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", []byte(`{}`), creds, "p1")

	mw := InternalAuthMiddleware("", 1024*1024)
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("handler must not run when middleware refuses (secret unset + header present)")
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 when secret is empty but inline-auth header is present, got %d", rec.Code)
	}
}

func TestInternalAuth_BodyOverMaxRejected(t *testing.T) {
	big := bytes.Repeat([]byte("a"), 1025)
	creds := mustEncodeInline(t, map[string]any{"provider": "openai", "openai": map[string]string{"api_key": "k"}})
	req := mustSignedReq(t, "POST", "/v1/chat/completions", big, creds, "p1")

	mw := InternalAuthMiddleware(testSecret, 1024)
	rec := httptest.NewRecorder()
	mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("handler must not run when body is too large to verify")
	})).ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on oversized body, got %d", rec.Code)
	}
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

func mustEncodeInline(t *testing.T, v map[string]any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal inline creds: %v", err)
	}
	return base64.StdEncoding.EncodeToString(b)
}

func mustSignedReq(t *testing.T, method, path string, body []byte, credsHeader, projectID string) *http.Request {
	t.Helper()
	return signWithTS(t, method, path, body, credsHeader, projectID, time.Now().Unix())
}

func signWithTS(t *testing.T, method, path string, body []byte, credsHeader, projectID string, ts int64) *http.Request {
	t.Helper()
	tsStr := strconv.FormatInt(ts, 10)
	sig := computeInternalSignature([]byte(testSecret), method, path, tsStr, body, credsHeader)

	req := httptest.NewRequest(method, path, bytes.NewReader(body))
	req.Header.Set(HeaderInternalAuth, sig)
	req.Header.Set(HeaderInternalTimestamp, tsStr)
	req.Header.Set(HeaderInlineCredentials, credsHeader)
	if projectID != "" {
		req.Header.Set(HeaderInternalProjectID, projectID)
	}
	return req
}

// Sanity check: hex(sha256("")) is what we'd compute for an empty body.
// Used in fuzz cases to ensure the canonical input is well-formed.
func init() {
	zero := sha256.Sum256(nil)
	if hex.EncodeToString(zero[:]) != "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" {
		panic(fmt.Sprintf("hex sha256 of empty: %s", hex.EncodeToString(zero[:])))
	}
}
