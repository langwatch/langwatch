package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/health"
)

// Tests pin the Go-only-mode fallback handler that serves non-/go/*
// requests when nlpgo runs without a Python child (npx
// @langwatch/server / fully-migrated topology).
//
// The contract: a 502 with a self-explaining body. 502 (not 404)
// because:
//
//  1. Existing TS-app retry logic catches "child upstream unavailable"
//     legacy 502s; staying on 502 means clients keep working without
//     branching for the new Go-only deployment shape.
//  2. 404 would suggest the URL is wrong, sending operators chasing
//     phantom typos. The path IS valid in the legacy dual-process
//     topology — it's just not served by THIS binary.
//
// Body explains the most common cause (forgot to force the FF on for
// every project) so the operator's first action is the right one.

func newRouterWithoutChildProxy() http.Handler {
	return NewRouter(RouterDeps{
		Logger:  nil,
		Health:  health.New("test"),
		Version: "test",
		// App, ChildProxy, OTel intentionally nil — this exercises the
		// pure-fallback codepath. /go/* routes that need App will fail
		// independently; the test only hits non-/go/* paths.
	})
}

func TestRouter_GoOnlyModeFallback_Returns502OnLegacyPath(t *testing.T) {
	router := newRouterWithoutChildProxy()
	req := httptest.NewRequest(http.MethodPost, "/studio/execute", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d; want 502 (matches legacy 'child upstream unavailable' shape so client retry logic stays unchanged)", rec.Code)
	}
	body := rec.Body.String()
	mustContain := []string{
		"Go-only mode",
		"NLPGO_CHILD_BYPASS=true",
		"FEATURE_FLAG_FORCE_ENABLE=release_nlp_go_engine_enabled",
		"/studio/execute",
	}
	for _, want := range mustContain {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q so the operator can't self-diagnose; full body: %q", want, body)
		}
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/plain") {
		t.Errorf("Content-Type = %q; want text/plain so curl/grep work without a JSON parser", ct)
	}
}

func TestRouter_GoOnlyModeFallback_Also502sOnUnknownGetPath(t *testing.T) {
	// MethodNotAllowed should ALSO route to the fallback — operators
	// hitting /proxy/v1/* with a method the Go playground proxy doesn't
	// support, or hitting random paths via curl, get the same clear
	// message rather than chi's default 405.
	router := newRouterWithoutChildProxy()
	req := httptest.NewRequest(http.MethodGet, "/some/path/that/does/not/exist", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d; want 502 from goOnlyModeFallback (NotFound + MethodNotAllowed both route there)", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "/some/path/that/does/not/exist") {
		t.Errorf("body must echo the attempted path so operator-side diagnostics work; got: %q", rec.Body.String())
	}
}
