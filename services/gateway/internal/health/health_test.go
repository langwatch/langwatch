package health

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLivenessAlwaysOKWhenNoChecks(t *testing.T) {
	r := New("test")
	rec := httptest.NewRecorder()
	r.Liveness(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d", rec.Code)
	}
}

func TestReadinessFailsWhenAnyCheckFails(t *testing.T) {
	r := New("test")
	r.RegisterReadiness("cp", func() (bool, string) { return true, "" })
	r.RegisterReadiness("cache", func() (bool, string) { return false, errDetail(errors.New("cold")) })
	rec := httptest.NewRecorder()
	r.Readiness(rec, httptest.NewRequest("GET", "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
	var resp response
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Checks["cp"] != "ok" || resp.Checks["cache"] == "" {
		t.Errorf("checks: %+v", resp.Checks)
	}
}

func TestStartupGatedByMarkStarted(t *testing.T) {
	r := New("test")
	r.RegisterReadiness("cache", func() (bool, string) { return true, "" })
	rec := httptest.NewRecorder()
	r.Startup(rec, httptest.NewRequest("GET", "/startupz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("before MarkStarted: expected 503, got %d", rec.Code)
	}
	r.MarkStarted()
	rec = httptest.NewRecorder()
	r.Startup(rec, httptest.NewRequest("GET", "/startupz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("after MarkStarted: expected 200, got %d", rec.Code)
	}
}

func TestReadinessFlipsTo503OnDrain(t *testing.T) {
	r := New("test")
	r.RegisterReadiness("cache", func() (bool, string) { return true, "" })
	rec := httptest.NewRecorder()
	r.Readiness(rec, httptest.NewRequest("GET", "/readyz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("pre-drain: expected 200, got %d", rec.Code)
	}

	r.MarkDraining()
	rec = httptest.NewRecorder()
	r.Readiness(rec, httptest.NewRequest("GET", "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("during drain: expected 503, got %d", rec.Code)
	}
	var resp response
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Status != "draining" {
		t.Errorf("status=%q want draining", resp.Status)
	}
	if !r.Draining() {
		t.Error("Draining() should be true")
	}
}

func TestDrainDoesNotAffectLivenessOrStartup(t *testing.T) {
	r := New("test")
	r.MarkStarted()
	r.MarkDraining()

	rec := httptest.NewRecorder()
	r.Liveness(rec, httptest.NewRequest("GET", "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("liveness during drain: expected 200, got %d", rec.Code)
	}

	rec = httptest.NewRecorder()
	r.Startup(rec, httptest.NewRequest("GET", "/startupz", nil))
	if rec.Code != http.StatusOK {
		t.Errorf("startupz during drain: expected 200, got %d", rec.Code)
	}
}

func errDetail(e error) string { return e.Error() }
