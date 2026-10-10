package dashboard

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func limitsServer(limits Limits) *Server {
	return New(Config{
		Stacks:    func() []domain.Stack { return nil },
		SharedURL: func(svc string) string { return "https://" + svc + ".langwatch.localhost" },
		Limits:    limits,
	})
}

func limitRequest(s *Server, method, path, body string, sameOrigin bool) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if sameOrigin {
		req.Header.Set("Sec-Fetch-Site", "same-origin")
	}
	rec := httptest.NewRecorder()
	s.routes().ServeHTTP(rec, req)
	return rec
}

// @scenario "The hub reads and edits the machine limits over HTTP"
func TestLimitsOverHTTP(t *testing.T) {
	var set struct {
		name  string
		value int
	}
	var unset string
	s := limitsServer(Limits{
		Report: func() domain.LimitsReport {
			return domain.LimitsReport{TotalRAMBytes: 64 << 30, CPUs: 16, Limits: []domain.LimitValue{{Name: "redis-maxmemory-mb", Value: 512, Source: "default"}}}
		},
		Set: func(name string, value int) (string, error) {
			if value < 64 {
				return "", errors.New("redis-maxmemory-mb must be at least 64")
			}
			set.name, set.value = name, value
			return name + " saved", nil
		},
		Unset: func(name string) (string, error) { unset = name; return name + " reset", nil },
	})

	t.Run("when the page reads the limits", func(t *testing.T) {
		rec := limitRequest(s, http.MethodGet, "/api/limits", "", false)
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"redis-maxmemory-mb"`) || !strings.Contains(rec.Body.String(), `"totalRamBytes"`) {
			t.Fatalf("status %d body %s", rec.Code, rec.Body)
		}
	})

	t.Run("when the page saves a value", func(t *testing.T) {
		rec := limitRequest(s, http.MethodPut, "/api/limits/redis-maxmemory-mb", `{"value": 256}`, true)
		if rec.Code != http.StatusOK || set.name != "redis-maxmemory-mb" || set.value != 256 {
			t.Fatalf("status %d, set %+v, body %s", rec.Code, set, rec.Body)
		}
	})

	t.Run("when the page resets a limit", func(t *testing.T) {
		rec := limitRequest(s, http.MethodDelete, "/api/limits/redis-maxmemory-mb", "", true)
		if rec.Code != http.StatusOK || unset != "redis-maxmemory-mb" {
			t.Fatalf("status %d, unset %q, body %s", rec.Code, unset, rec.Body)
		}
	})

	t.Run("when the value is refused", func(t *testing.T) {
		rec := limitRequest(s, http.MethodPut, "/api/limits/redis-maxmemory-mb", `{"value": 8}`, true)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "at least 64") {
			t.Errorf("status %d body %s, want 400 carrying the reason", rec.Code, rec.Body)
		}
	})

	t.Run("when the body names no value", func(t *testing.T) {
		if rec := limitRequest(s, http.MethodPut, "/api/limits/redis-maxmemory-mb", `{}`, true); rec.Code != http.StatusBadRequest {
			t.Errorf("status %d, want 400", rec.Code)
		}
	})

	t.Run("when another origin tries to change a limit", func(t *testing.T) {
		for _, method := range []string{http.MethodPut, http.MethodDelete} {
			if rec := limitRequest(s, method, "/api/limits/redis-maxmemory-mb", `{"value": 256}`, false); rec.Code != http.StatusForbidden {
				t.Errorf("%s status %d, want 403", method, rec.Code)
			}
		}
	})

	t.Run("given a haven with no limits wired", func(t *testing.T) {
		bare := limitsServer(Limits{})
		if rec := limitRequest(bare, http.MethodGet, "/api/limits", "", false); rec.Code != http.StatusNotImplemented {
			t.Errorf("status %d, want 501", rec.Code)
		}
	})
}
