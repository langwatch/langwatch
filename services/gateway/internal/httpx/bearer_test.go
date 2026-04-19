package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
}

func TestRequireBearerPassesValidToken(t *testing.T) {
	h := RequireBearer("s3cret", "admin", okHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/debug/pprof/heap", nil)
	req.Header.Set("Authorization", "Bearer s3cret")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Errorf("code=%d want 204", rec.Code)
	}
}

func TestRequireBearerRejectsMissingHeader(t *testing.T) {
	h := RequireBearer("s3cret", "admin", okHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/debug/pprof/heap", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("code=%d want 401", rec.Code)
	}
	if rec.Header().Get("WWW-Authenticate") != `Bearer realm="admin"` {
		t.Errorf("WWW-Authenticate=%q want Bearer realm=\"admin\"", rec.Header().Get("WWW-Authenticate"))
	}
}

func TestRequireBearerRejectsWrongToken(t *testing.T) {
	h := RequireBearer("s3cret", "admin", okHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/debug/pprof/heap", nil)
	req.Header.Set("Authorization", "Bearer wrong")
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("code=%d want 401", rec.Code)
	}
}

func TestRequireBearerRejectsMalformedHeader(t *testing.T) {
	h := RequireBearer("s3cret", "admin", okHandler())
	for _, v := range []string{
		"",
		"s3cret",          // no scheme
		"bearer s3cret",   // lowercase scheme
		"Basic dXNlcjpwdw==",
		"Bearer",          // no token
	} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/debug/pprof/heap", nil)
		if v != "" {
			req.Header.Set("Authorization", v)
		}
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%q: code=%d want 401", v, rec.Code)
		}
	}
}

func TestRequireBearerEmptyTokenIsPassthrough(t *testing.T) {
	// Callers must enforce "token required" policy themselves — the
	// middleware only gates when a token is configured.
	h := RequireBearer("", "admin", okHandler())
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/debug/pprof/heap", nil)
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Errorf("code=%d want 204 (passthrough)", rec.Code)
	}
}

func TestIsLoopbackAddr(t *testing.T) {
	cases := []struct {
		addr string
		want bool
	}{
		{"127.0.0.1:6060", true},
		{"[::1]:6060", true},
		{"localhost:6060", true},
		{"0.0.0.0:6060", false},
		{"10.0.0.5:6060", false},
		{":6060", false}, // all interfaces
		{"", false},
		{"gateway.example.com:6060", false},
	}
	for _, c := range cases {
		if got := IsLoopbackAddr(c.addr); got != c.want {
			t.Errorf("IsLoopbackAddr(%q)=%v want %v", c.addr, got, c.want)
		}
	}
}
