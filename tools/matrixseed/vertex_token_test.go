package matrixseed

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// tokenServer answers the JWT-bearer grant, checking the assertion's
// signature against pub, the way Google's token endpoint does.
func tokenServer(t *testing.T, pub *rsa.PublicKey, status int) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil || r.Form.Get("grant_type") != "urn:ietf:params:oauth:grant-type:jwt-bearer" {
			http.Error(w, "bad grant", http.StatusBadRequest)
			return
		}
		parts := strings.Split(r.Form.Get("assertion"), ".")
		if len(parts) != 3 {
			http.Error(w, "not a JWT", http.StatusBadRequest)
			return
		}
		sig, _ := base64.RawURLEncoding.DecodeString(parts[2])
		sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
		if rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig) != nil {
			http.Error(w, "bad signature", http.StatusUnauthorized)
			return
		}
		claims, _ := base64.RawURLEncoding.DecodeString(parts[1])
		if !strings.Contains(string(claims), vertexScope) {
			http.Error(w, "no scope", http.StatusBadRequest)
			return
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"access_token":"ya29.minted"}`))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// vertexKey starts a token server answering with status and returns a
// service-account key whose token_uri points at it.
func vertexKey(t *testing.T, status int) (string, *httptest.Server) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	ts := tokenServer(t, &key.PublicKey, status)
	raw, _ := json.Marshal(map[string]string{
		"type": "service_account", "client_email": "matrix@example.iam.gserviceaccount.com",
		"private_key": string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})),
		"token_uri":   ts.URL,
	})
	return string(raw), ts
}

/** @scenario "The Vertex cache cell gets a token minted from the service-account key" */
func TestMintVertexTokenExchangesASignedAssertion(t *testing.T) {
	keyJSON, ts := vertexKey(t, http.StatusOK)
	got, err := mintVertexToken(context.Background(), ts.Client(), keyJSON)
	if err != nil || got != "ya29.minted" {
		t.Fatalf("token=%q err=%v", got, err)
	}
}

/** @scenario "The Vertex cache cell gets a token minted from the service-account key" */
func TestMintVertexTokenRefusalIsAnErrorNotAToken(t *testing.T) {
	keyJSON, ts := vertexKey(t, http.StatusForbidden)
	if got, err := mintVertexToken(context.Background(), ts.Client(), keyJSON); err == nil || got != "" {
		t.Fatalf("a refused grant must yield no token: token=%q err=%v", got, err)
	}
	if _, err := mintVertexToken(context.Background(), ts.Client(), `{"type":"service_account"}`); err == nil {
		t.Fatal("a key with no client_email or private_key must be refused before any request")
	}
}

func vertexEnv(keyJSON string) map[string]string {
	return map[string]string{"VERTEX_SERVICE_ACCOUNT_JSON": keyJSON, "VERTEX_PROJECT": "langwatch", "VERTEX_LOCATION": "us-central1"}
}

/** @scenario "The Vertex cache cell gets a token minted from the service-account key" */
func TestRunExportsTheMintedVertexToken(t *testing.T) {
	keyJSON, _ := vertexKey(t, http.StatusOK)
	_, server := newStub(t, nil)
	result := run(t, server.URL, vertexEnv(keyJSON))
	if got := exported(result)["VERTEX_ACCESS_TOKEN"]; got != "ya29.minted" {
		t.Fatalf("VERTEX_ACCESS_TOKEN = %q, want the minted token; warnings=%v", got, result.Warnings)
	}
	if len(result.Warnings) != 0 || result.Err() != nil {
		t.Fatalf("a minted token warns of nothing: warnings=%v err=%v", result.Warnings, result.Err())
	}
}

/** @scenario "The Vertex cache cell gets a token minted from the service-account key" */
func TestRunWarnsAndExportsNoTokenWhenTheExchangeIsRefused(t *testing.T) {
	keyJSON, _ := vertexKey(t, http.StatusForbidden)
	_, server := newStub(t, nil)
	result := run(t, server.URL, vertexEnv(keyJSON))
	if _, ok := exported(result)["VERTEX_ACCESS_TOKEN"]; ok {
		t.Fatal("a refused exchange must export no VERTEX_ACCESS_TOKEN")
	}
	if len(result.Warnings) != 1 || !strings.Contains(result.Warnings[0], "Vertex cache cell skips") {
		t.Fatalf("want one warning that the cell skips, got %v", result.Warnings)
	}
	if strings.Contains(result.Warnings[0], "ya29.minted") || !strings.Contains(result.Warnings[0], "HTTP 403") {
		t.Fatalf("the warning must keep the status and drop the endpoint's body: %s", result.Warnings[0])
	}
	if result.Err() != nil {
		t.Fatalf("a refused exchange only skips a cell, it does not fail the seed: %v", result.Err())
	}
}
