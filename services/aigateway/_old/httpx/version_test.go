package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestVersionHeaderAddedOnSuccess(t *testing.T) {
	h := Version("v1.2.3")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/models", nil))
	if got := rec.Header().Get("X-LangWatch-Gateway-Version"); got != "v1.2.3" {
		t.Errorf("header=%q want v1.2.3", got)
	}
}

func TestVersionHeaderAddedOnError(t *testing.T) {
	// Error paths should still carry the version — operators need it
	// when debugging "which pod returned this 500".
	h := Version("v1.2.3")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/chat/completions", nil))
	if got := rec.Header().Get("X-LangWatch-Gateway-Version"); got != "v1.2.3" {
		t.Errorf("header=%q want v1.2.3", got)
	}
}

func TestVersionEmptyIsPassthrough(t *testing.T) {
	h := Version("")(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest("GET", "/v1/models", nil))
	if got := rec.Header().Get("X-LangWatch-Gateway-Version"); got != "" {
		t.Errorf("empty version should not set header, got %q", got)
	}
}
