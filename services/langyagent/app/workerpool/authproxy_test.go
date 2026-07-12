package workerpool

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

// freePortForTest mirrors GetFreePort but with t.Fatal on error so tests stay
// clean.
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
	a, err := GenerateBearerToken()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	b, err := GenerateBearerToken()
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

// authProxy must let through a request that carries the right Bearer token and
// reject one that doesn't (or carries a different token). It also must present
// opencode's own Basic credential to the backend on every forwarded request
// (Fix A′, ADR-033) — it REPLACES Authorization, it no longer strips it.
func TestAuthProxy_BearerGate(t *testing.T) {
	const openCodePassword = "op-password-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	wantBasic := "Basic " + base64.StdEncoding.EncodeToString([]byte("opencode:"+openCodePassword))

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != wantBasic {
			t.Errorf("backend got Authorization %q, want %q", got, wantBasic)
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
	proxy, err := StartAuthProxy(context.Background(), port, internalPort, token, openCodePassword)
	if err != nil {
		t.Fatalf("StartAuthProxy: %v", err)
	}
	defer proxy.Shutdown()
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

// Two workers' bearer tokens must not interchange — the headline cross-worker
// bypass attempt. Worker A calling worker B's proxy with A's token must 401.
func TestAuthProxy_TokensDoNotInterchangeAcrossProxies(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	internalPort, _ := strconv.Atoi(strings.TrimPrefix(backend.URL, "http://127.0.0.1:"))

	tokenA := "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	tokenB := "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	passwordA := "opencode-password-a-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	passwordB := "opencode-password-b-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	portA := freePortForTest(t)
	portB := freePortForTest(t)
	proxyA, err := StartAuthProxy(context.Background(), portA, internalPort, tokenA, passwordA)
	if err != nil {
		t.Fatalf("StartAuthProxy A: %v", err)
	}
	defer proxyA.Shutdown()
	proxyB, err := StartAuthProxy(context.Background(), portB, internalPort, tokenB, passwordB)
	if err != nil {
		t.Fatalf("StartAuthProxy B: %v", err)
	}
	defer proxyB.Shutdown()
	waitForListenerOrFail(t, portA)
	waitForListenerOrFail(t, portB)

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

// TestWorkerIsolation_SiblingCannotAuthenticateWithoutPassword is the
// integration test for the core security property in
// specs/langy/langy-worker-isolation.feature: a sibling that reaches worker B's
// opencode port without B's password is rejected 401, while B's own authProxy —
// wired with B's password — gets through. The fake backend reproduces the exact
// Basic-auth behavior opencode exhibits when OPENCODE_SERVER_PASSWORD is set.
func TestWorkerIsolation_SiblingCannotAuthenticateWithoutPassword(t *testing.T) {
	password := "worker-b-opencode-password-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	wantBasic := "Basic " + base64.StdEncoding.EncodeToString([]byte("opencode:"+password))

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != wantBasic {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()
	internalPort, err := strconv.Atoi(strings.TrimPrefix(backend.URL, "http://127.0.0.1:"))
	if err != nil {
		t.Fatalf("parse backend port: %v", err)
	}

	t.Run("sibling with no credential is rejected", func(t *testing.T) {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/", internalPort))
		if err != nil {
			t.Fatalf("sibling request: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("sibling reaching worker B unauthenticated got %d, want 401", resp.StatusCode)
		}
	})

	t.Run("sibling with the wrong password is rejected", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/", internalPort), nil)
		req.SetBasicAuth("opencode", "not-worker-b's-password")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("sibling request: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("sibling with wrong password got %d, want 401", resp.StatusCode)
		}
	})

	t.Run("authProxy with the real password gets through", func(t *testing.T) {
		bearer := "bearer-for-worker-b-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
		externalPort := freePortForTest(t)
		proxy, err := StartAuthProxy(context.Background(), externalPort, internalPort, bearer, password)
		if err != nil {
			t.Fatalf("StartAuthProxy: %v", err)
		}
		defer proxy.Shutdown()
		waitForListenerOrFail(t, externalPort)

		req, _ := http.NewRequest(http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/", externalPort), nil)
		req.Header.Set("Authorization", "Bearer "+bearer)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("authProxy request: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("authProxy path to worker B got %d, want 200", resp.StatusCode)
		}
	})
}

// waitForListenerOrFail polls a TCP port for a brief window. Failing here means
// the proxy didn't come up at all, which is a real fault.
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
