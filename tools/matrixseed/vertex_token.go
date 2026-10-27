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
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// vertexScope is what the Vertex cache cell calls with its bearer token.
const vertexScope = "https://www.googleapis.com/auth/cloud-platform"

type serviceAccount struct {
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

// mintVertexToken exchanges a service-account key for an access token, by the
// JWT-bearer grant the key's own token_uri serves.
func mintVertexToken(ctx context.Context, hc *http.Client, keyJSON string) (string, error) {
	var sa serviceAccount
	if err := json.Unmarshal([]byte(keyJSON), &sa); err != nil {
		return "", fmt.Errorf("reading the service-account key: %w", err)
	}
	if sa.ClientEmail == "" || sa.PrivateKey == "" || sa.TokenURI == "" {
		return "", errors.New("the service-account key has no client_email, private_key or token_uri")
	}
	assertion, err := signAssertion(sa, time.Now())
	if err != nil {
		return "", err
	}
	form := url.Values{"grant_type": {"urn:ietf:params:oauth:grant-type:jwt-bearer"}, "assertion": {assertion}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, sa.TokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("building the token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("asking for a token: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if err != nil {
		return "", fmt.Errorf("reading the token answer: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("the token endpoint answered %d", resp.StatusCode)
	}
	var out struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || out.AccessToken == "" {
		return "", errors.New("the token endpoint answered no access_token")
	}
	return out.AccessToken, nil
}

// signAssertion builds the RS256 JWT the grant takes, valid for one hour.
func signAssertion(sa serviceAccount, now time.Time) (string, error) {
	block, _ := pem.Decode([]byte(sa.PrivateKey))
	if block == nil {
		return "", errors.New("the service-account private_key is not PEM")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return "", fmt.Errorf("parsing the service-account private_key: %w", err)
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return "", errors.New("the service-account private_key is not RSA")
	}
	enc := base64.RawURLEncoding
	header := enc.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`))
	claims, err := json.Marshal(map[string]any{
		"iss": sa.ClientEmail, "scope": vertexScope, "aud": sa.TokenURI,
		"iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
	})
	if err != nil {
		return "", fmt.Errorf("encoding the token claims: %w", err)
	}
	signing := header + "." + enc.EncodeToString(claims)
	sum := sha256.Sum256([]byte(signing))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		return "", fmt.Errorf("signing the token request: %w", err)
	}
	return signing + "." + enc.EncodeToString(sig), nil
}
