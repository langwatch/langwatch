package langyagent

import (
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
)

// freePortForTest mirrors getFreePort but with t.Fatal on error so tests
// stay clean. Using a separate helper keeps the production getFreePort
// signature unchanged.
func freePortForTest(t *testing.T) int {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	port := l.Addr().(*net.TCPAddr).Port
	_ = l.Close()
	return port
}

func TestGenerateBearerToken_UniqueAndLongEnough(t *testing.T) {
	a, err := generateBearerToken()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	b, err := generateBearerToken()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if a == b {
		t.Errorf("expected two calls to produce different tokens; both = %q", a)
	}
	if len(a) != 64 {
		t.Errorf("expected 64 hex chars (32 random bytes), got len=%d", len(a))
	}
}

// authProxy must let through a request that carries the right Bearer token
// and reject one that doesn't (or that carries a different token). Verifies
// the basic credential gate.
func TestAuthProxy_BearerGate(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Backend should never see the Authorization header — authproxy
		// strips it after the compare.
		if r.Header.Get("Authorization") != "" {
			t.Errorf("backend received Authorization header; expected stripped")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, "ok")
	}))
	defer backend.Close()

	internalPort, err := strconv.Atoi(strings.TrimPrefix(backend.URL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatalf("parse backend port: %v", err)
	}

	token := "test-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	port := freePortForTest(t)
	proxy, err := startAuthProxy(port, internalPort, token, zap.NewNop())
	if err != nil {
		t.Fatalf("startAuthProxy: %v", err)
	}
	defer proxy.shutdown()
	waitForListenerOrFail(t, port)

	cases := []struct {
		name       string
		auth       string
		wantStatus int
	}{
		{"valid token", "Bearer " + token, http.StatusOK},
		{"missing header", "", http.StatusUnauthorized},
		{"wrong token", "Bearer different-token", http.StatusUnauthorized},
		{"wrong scheme", "Basic " + token, http.StatusUnauthorized},
		{"empty bearer", "Bearer ", http.StatusUnauthorized},
		{"prefix shorter than expected", "Bearer", http.StatusUnauthorized},
		{"trailing junk", "Bearer " + token + "x", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/", port), nil)
			if tc.auth != "" {
				req.Header.Set("Authorization", tc.auth)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("request: %v", err)
			}
			defer resp.Body.Close()
			if resp.StatusCode != tc.wantStatus {
				t.Errorf("status: got %d, want %d", resp.StatusCode, tc.wantStatus)
			}
		})
	}
}

// Two workers' bearer tokens must not interchange. Reuses the same
// backend (the test isn't proving end-to-end isolation, only that each
// proxy enforces its own token).
func TestAuthProxy_TokensDoNotInterchangeAcrossProxies(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	internalPort, _ := strconv.Atoi(strings.TrimPrefix(backend.URL, "http://127.0.0.1:"))

	tokenA := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	tokenB := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	portA := freePortForTest(t)
	portB := freePortForTest(t)
	proxyA, err := startAuthProxy(portA, internalPort, tokenA, zap.NewNop())
	if err != nil {
		t.Fatalf("startAuthProxy A: %v", err)
	}
	defer proxyA.shutdown()
	proxyB, err := startAuthProxy(portB, internalPort, tokenB, zap.NewNop())
	if err != nil {
		t.Fatalf("startAuthProxy B: %v", err)
	}
	defer proxyB.shutdown()
	waitForListenerOrFail(t, portA)
	waitForListenerOrFail(t, portB)

	// Sibling worker A tries to call worker B's proxy with A's token →
	// the headline cross-worker bypass attempt. Must 401.
	req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/", portB), nil)
	req.Header.Set("Authorization", "Bearer "+tokenA)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("cross-proxy request: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401 for cross-worker token reuse, got %d", resp.StatusCode)
	}
}

// waitForListenerOrFail polls a TCP port for a brief window. Hides the
// startAuthProxy goroutine race window from individual tests; failing
// here means the proxy didn't come up at all, which is a real fault.
func waitForListenerOrFail(t *testing.T, port int) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 50*time.Millisecond)
		if err == nil {
			_ = conn.Close()
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("authproxy did not bind 127.0.0.1:%d in time", port)
}
