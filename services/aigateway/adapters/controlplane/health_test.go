package controlplane

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/jwtverify"
)

func healthTestClient(t *testing.T, srv *httptest.Server, secret string) *Client {
	t.Helper()
	signer, err := NewSigner(secret, "node-1")
	require.NoError(t, err)
	return NewClient(ClientOptions{
		BaseURL:    srv.URL,
		Sign:       signer.Sign,
		Verifier:   jwtverify.NewJWTVerifier("jwt-secret", ""),
		HTTPClient: srv.Client(),
	})
}

// @scenario "a mismatched internal secret shows up as a control-plane failure"
// The server side recomputes the signature over the same canonical string
// the control plane's verifier uses (METHOD\nPATH\nTS\nhex(sha256(body))),
// so a drift in how Health signs its empty-body GET fails here before it
// fails in production.
func TestClientHealth_SendsSignedGet(t *testing.T) {
	const secret = "test-secret"
	var (
		gotMethod, gotPath string
		sigOK              bool
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path

		ts := r.Header.Get("X-LangWatch-Gateway-Timestamp")
		presented := r.Header.Get("X-LangWatch-Gateway-Signature")
		bodyHash := sha256.Sum256(nil)
		canonical := fmt.Sprintf("%s\n%s\n%s\n%s", r.Method, r.URL.Path, ts, hex.EncodeToString(bodyHash[:]))
		mac := hmac.New(sha256.New, []byte(secret))
		mac.Write([]byte(canonical))
		sigOK = presented != "" && hmac.Equal([]byte(hex.EncodeToString(mac.Sum(nil))), []byte(presented))

		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer srv.Close()

	cp := healthTestClient(t, srv, secret)

	require.NoError(t, cp.Health(context.Background()))
	assert.Equal(t, http.MethodGet, gotMethod)
	assert.Equal(t, "/api/internal/gateway/health", gotPath)
	assert.True(t, sigOK, "probe must carry a valid HMAC signature over the canonical string")
}

// @scenario "a mismatched internal secret shows up as a control-plane failure"
// 401 is the secret-mismatch case specifically: the control plane is up and
// answering, it just refuses this gateway. It must read as a failed probe,
// not as a reachable control plane.
func TestClientHealth_Non200IsFailure(t *testing.T) {
	for _, status := range []int{http.StatusUnauthorized, http.StatusInternalServerError, http.StatusServiceUnavailable} {
		t.Run(fmt.Sprintf("status_%d", status), func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(status)
			}))
			defer srv.Close()

			cp := healthTestClient(t, srv, "test-secret")

			err := cp.Health(context.Background())
			require.Error(t, err)
			assert.Contains(t, err.Error(), fmt.Sprint(status))
		})
	}
}

func TestClientHealth_TransportFailureIsFailure(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	client := healthTestClient(t, srv, "test-secret")
	srv.Close()

	assert.Error(t, client.Health(context.Background()))
}
