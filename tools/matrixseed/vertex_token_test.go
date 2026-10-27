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
		sig, _ := base64.RawURLEncoding.DecodeString(parts[len(parts)-1])
		sum := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
		if len(parts) != 3 || rsa.VerifyPKCS1v15(pub, crypto.SHA256, sum[:], sig) != nil {
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

func serviceAccountJSON(t *testing.T, tokenURI string) (string, *rsa.PublicKey) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	pemKey := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
	raw, _ := json.Marshal(map[string]string{
		"type": "service_account", "client_email": "matrix@example.iam.gserviceaccount.com",
		"private_key": pemKey, "token_uri": tokenURI,
	})
	return string(raw), &key.PublicKey
}

/** @scenario "The Vertex cache cell gets a token minted from the service-account key" */
func TestMintVertexTokenExchangesASignedAssertion(t *testing.T) {
	keyJSON, pub := serviceAccountJSON(t, "")
	ts := tokenServer(t, pub, http.StatusOK)
	keyJSON = strings.Replace(keyJSON, `"token_uri":""`, `"token_uri":"`+ts.URL+`"`, 1)
	got, err := mintVertexToken(context.Background(), ts.Client(), keyJSON)
	if err != nil || got != "ya29.minted" {
		t.Fatalf("token=%q err=%v", got, err)
	}
}

/** @scenario "The Vertex cache cell gets a token minted from the service-account key" */
func TestMintVertexTokenRefusalIsAnErrorNotAToken(t *testing.T) {
	keyJSON, pub := serviceAccountJSON(t, "")
	ts := tokenServer(t, pub, http.StatusForbidden)
	keyJSON = strings.Replace(keyJSON, `"token_uri":""`, `"token_uri":"`+ts.URL+`"`, 1)
	if got, err := mintVertexToken(context.Background(), ts.Client(), keyJSON); err == nil || got != "" {
		t.Fatalf("a refused grant must yield no token: token=%q err=%v", got, err)
	}
	if _, err := mintVertexToken(context.Background(), ts.Client(), `{"type":"service_account"}`); err == nil {
		t.Fatal("a key with no client_email or private_key must be refused before any request")
	}
}
