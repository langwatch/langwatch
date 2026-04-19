package auth

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// Verify the HMAC canonical string + signature byte-exactly matches the
// scheme agreed in the channel (Alexis's Hono middleware uses the same).
// Canonical string: METHOD + '\n' + PATH + '\n' + hex(sha256(body))
//
// This is a cross-implementation contract test: if either side drifts, the
// control plane will reject all gateway calls.
func TestHMACCanonicalStringMatchesContract(t *testing.T) {
	const secret = "shared-test-secret-32byteslong!!"
	body := []byte(`{"key_presented":"lw_vk_live_01HZX","gateway_node_id":"gw-a"}`)

	gotSig := ""
	gotNode := ""
	gotContentType := ""
	gotPath := ""
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotSig = r.Header.Get("X-LangWatch-Gateway-Signature")
		gotNode = r.Header.Get("X-LangWatch-Gateway-Node")
		gotContentType = r.Header.Get("Content-Type")
		gotPath = r.URL.Path

		buf := make([]byte, 0, 1024)
		tmp := make([]byte, 256)
		for {
			n, err := r.Body.Read(tmp)
			if n > 0 {
				buf = append(buf, tmp[:n]...)
			}
			if err != nil {
				break
			}
		}
		if !bytes.Equal(buf, body) {
			t.Errorf("body bytes drifted on wire: got %q", string(buf))
		}
		w.WriteHeader(http.StatusInternalServerError) // force error path to stop
	}))
	defer srv.Close()

	r := NewHTTPResolver(HTTPResolverOptions{
		BaseURL:        srv.URL,
		InternalSecret: secret,
		JWTSecret:      "unused-here",
		GatewayNodeID:  "gw-a",
		Timeout:        time.Second,
	}).(*httpResolver)
	// Call sign directly on a known request so we can assert the exact sig.
	req, _ := http.NewRequestWithContext(context.Background(), "POST", srv.URL+"/api/internal/gateway/resolve-key", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	r.signRequest(req, body)

	// Use the injectable-timestamp form so the test vector is deterministic.
	// Canonical: METHOD + \n + PATH + \n + TS + \n + hex(sha256(body)).
	req, _ = http.NewRequestWithContext(context.Background(), "POST", srv.URL+"/api/internal/gateway/resolve-key", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	const ts = int64(1734567890)
	r.signRequestAt(req, body, ts)

	bodyHash := sha256.Sum256(body)
	canonical := "POST\n/api/internal/gateway/resolve-key\n1734567890\n" + hex.EncodeToString(bodyHash[:])
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	wantSig := hex.EncodeToString(mac.Sum(nil))

	if got := req.Header.Get("X-LangWatch-Gateway-Signature"); got != wantSig {
		t.Fatalf("signature mismatch:\n got  %q\n want %q\n canonical: %q", got, wantSig, canonical)
	}
	if got := req.Header.Get("X-LangWatch-Gateway-Timestamp"); got != "1734567890" {
		t.Fatalf("timestamp header: %q", got)
	}

	// Send the signed request through the real http client to cover wire
	// encoding; server echoes nothing useful but the test checks the server
	// saw the same signature we computed locally.
	_, _ = r.http.Do(req)
	if gotSig != wantSig {
		t.Errorf("server saw different sig: %q vs %q", gotSig, wantSig)
	}
	if gotNode != "gw-a" {
		t.Errorf("node header: %q", gotNode)
	}
	if gotContentType != "application/json" {
		t.Errorf("content-type header: %q", gotContentType)
	}
	if gotPath != "/api/internal/gateway/resolve-key" {
		t.Errorf("path: %q", gotPath)
	}
}

// An empty-body GET still must sign, with hex(sha256("")) as body hash.
func TestHMACGetRequestUsesEmptyBodyHash(t *testing.T) {
	const secret = "s"
	const ts = int64(1734567890)
	r := NewHTTPResolver(HTTPResolverOptions{InternalSecret: secret, JWTSecret: secret, GatewayNodeID: "n"}).(*httpResolver)
	req, _ := http.NewRequestWithContext(context.Background(), "GET", "http://ignored/api/internal/gateway/changes?since=10&timeout_s=25", nil)
	r.signRequestAt(req, nil, ts)
	emptyHash := sha256.Sum256(nil)
	canonical := "GET\n/api/internal/gateway/changes\n1734567890\n" + hex.EncodeToString(emptyHash[:])
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	want := hex.EncodeToString(mac.Sum(nil))
	if got := req.Header.Get("X-LangWatch-Gateway-Signature"); got != want {
		t.Fatalf("GET sig mismatch:\n got  %q\n want %q\n canonical: %q", got, want, canonical)
	}
}

// When no internal secret is configured (dev mode), signRequest must not
// set the signature header (so server logs reveal the misconfiguration
// loudly instead of sending a garbage signature).
func TestHMACNoSecretNoSignature(t *testing.T) {
	r := NewHTTPResolver(HTTPResolverOptions{InternalSecret: "", JWTSecret: "j", GatewayNodeID: "n"}).(*httpResolver)
	req, _ := http.NewRequestWithContext(context.Background(), "GET", "http://ignored/api/internal/gateway/changes", nil)
	r.signRequestAt(req, nil, 1734567890)
	if got := req.Header.Get("X-LangWatch-Gateway-Signature"); got != "" {
		t.Errorf("expected no signature in dev mode, got %q", got)
	}
	if got := req.Header.Get("X-LangWatch-Gateway-Timestamp"); got != "" {
		t.Errorf("expected no timestamp in dev mode, got %q", got)
	}
}
