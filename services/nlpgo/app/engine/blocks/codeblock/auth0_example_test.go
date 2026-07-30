package codeblock_test

// Executes examples/auth0_code_agent.py — the canonical authenticated code
// agent — through the real runner.py subprocess, against a stub Auth0 token
// endpoint and a stub protected API. langwatch/langwatch#6337.
//
// These tests are the load-bearing proof that a custom code agent can perform
// an OAuth2 client-credentials exchange: they assert on what the stub
// endpoints RECEIVED (grant type, client id, audience, the minted token on
// the downstream call), not on the text of the Python. A hardcoded token or a
// commented-up scaffold cannot pass them.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// loadAuth0Example reads the committed example unmodified — the test runs the
// exact file the recipe teaches, no second copy.
func loadAuth0Example(t *testing.T) string {
	t.Helper()
	code, err := os.ReadFile(filepath.Join("examples", "auth0_code_agent.py"))
	require.NoError(t, err)
	return string(code)
}

type tokenRequest struct {
	GrantType    string `json:"grant_type"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	Audience     string `json:"audience"`
}

// auth0Stubs is a stub token endpoint + stub protected API pair. The token
// endpoint mints a fresh token per run; the API rejects anything else.
type auth0Stubs struct {
	tokenServer *httptest.Server
	apiServer   *httptest.Server

	mu            sync.Mutex
	mintedToken   string
	tokenRequests []tokenRequest
	apiAuthHeader string
	rejectToken   bool
}

func newAuth0Stubs(t *testing.T, clientSecret string) *auth0Stubs {
	t.Helper()
	s := &auth0Stubs{mintedToken: "minted-token-d41d8cd98f00"}

	s.tokenServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// No require/assert in handlers (testifylint go-require): a contract
		// violation surfaces as a 4xx, which fails the test at the caller.
		// Enforce the full token-request HTTP contract, not just a parseable
		// body: POST, the /oauth/token path, and a JSON content type.
		if r.Method != http.MethodPost || r.URL.Path != "/oauth/token" ||
			!strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		var req tokenRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		s.tokenRequests = append(s.tokenRequests, req)
		reject := s.rejectToken
		s.mu.Unlock()
		if reject || req.ClientSecret != clientSecret {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"error":"access_denied"}`)
			return
		}
		fmt.Fprintf(w, `{"access_token":%q,"token_type":"Bearer","expires_in":86400}`, s.mintedToken)
	}))
	t.Cleanup(s.tokenServer.Close)

	s.apiServer = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/chat" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		s.apiAuthHeader = r.Header.Get("Authorization")
		s.mu.Unlock()
		if r.Header.Get("Authorization") != "Bearer "+s.mintedToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		fmt.Fprint(w, `{"reply":"hello from the protected api"}`)
	}))
	t.Cleanup(s.apiServer.Close)

	return s
}

func auth0Request(stubs *auth0Stubs, code, clientSecret string) codeblock.Request {
	return codeblock.Request{
		Code: code,
		// The conversation message is the agent's ONLY input; credentials
		// and endpoint coordinates all ride the secrets namespace, so the
		// whole configuration is expressible through Settings -> Secrets
		// (no static value mappings — see langwatch/langwatch#6371).
		Inputs:          map[string]any{"message": "ping"},
		DeclaredOutputs: []string{"output"},
		Secrets: map[string]string{
			"AUTH0_CLIENT_ID":     "test-client-id",
			"AUTH0_CLIENT_SECRET": clientSecret,
			"AUTH0_TOKEN_URL":     stubs.tokenServer.URL + "/oauth/token",
			"AUTH0_AUDIENCE":      "https://api.acme-scenario.internal",
			"AUTH0_API_URL":       stubs.apiServer.URL + "/chat",
		},
	}
}

// @scenario "The committed example completes a real client-credentials exchange"
func TestAuth0CodeAgent_ClientCredentialsExchange(t *testing.T) {
	requirePython(t)
	// Run-unique so a stale match can never satisfy the leak assertions.
	clientSecret := fmt.Sprintf("s3cr3t-must-not-leak-%d", os.Getpid())
	stubs := newAuth0Stubs(t, clientSecret)

	res, err := newExec(t).Execute(context.Background(),
		auth0Request(stubs, loadAuth0Example(t), clientSecret))
	require.NoError(t, err)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)

	// The token endpoint received exactly one client-credentials request
	// carrying the seeded id, secret and audience.
	require.Len(t, stubs.tokenRequests, 1)
	got := stubs.tokenRequests[0]
	assert.Equal(t, "client_credentials", got.GrantType)
	assert.Equal(t, "test-client-id", got.ClientID)
	assert.Equal(t, clientSecret, got.ClientSecret)
	assert.Equal(t, "https://api.acme-scenario.internal", got.Audience)

	// The downstream call carried the exact token the stub minted this run.
	assert.Equal(t, "Bearer "+stubs.mintedToken, stubs.apiAuthHeader)

	// The declared output carries the protected API's payload.
	assert.Equal(t, "hello from the protected api", res.Outputs["output"])

	// The secret value appears in no captured output stream.
	assert.NotContains(t, res.Stdout, clientSecret)
	assert.NotContains(t, res.Stderr, clientSecret)

	// The whole exchange fit the runner's wall-clock budget — the bound
	// scenario's budget clause, asserted rather than assumed.
	assert.Less(t, res.DurationMS, int64(60_000))
}

// @scenario "A rejected token request fails loudly and without the secret"
func TestAuth0CodeAgent_RejectedCredentialsFailLoudlyWithoutTheSecret(t *testing.T) {
	requirePython(t)
	clientSecret := fmt.Sprintf("s3cr3t-must-not-leak-%d", os.Getpid())
	stubs := newAuth0Stubs(t, clientSecret)
	stubs.rejectToken = true

	res, err := newExec(t).Execute(context.Background(),
		auth0Request(stubs, loadAuth0Example(t), clientSecret))
	require.NoError(t, err)

	// The run fails — it does not succeed with an empty output. This is the
	// property langwatch/langwatch#6340 shows the scenario adapter then
	// swallows; at THIS layer the error is structured and present.
	require.NotNil(t, res.Error, "a rejected credential must fail the run")
	assert.Contains(t, res.Error.Message, "401")
	// The failure names the token endpoint — the bound scenario requires the
	// upstream rejection AND its source to be identifiable from the error.
	assert.Contains(t, res.Error.Message, "/oauth/token")

	// The failure names the auth step without reproducing the credential.
	combined := strings.Join([]string{res.Error.Message, res.Error.Traceback, res.Stdout, res.Stderr}, "\n")
	assert.NotContains(t, combined, clientSecret)
}

// @scenario "The credential comes from the project secret, not from a baked-in value"
func TestAuth0CodeAgent_SecretComesFromTheProjectSecretNotABakedInValue(t *testing.T) {
	requirePython(t)
	// Two executions with two different secret values: the value the token
	// endpoint receives must change with the project secret. A baked-in
	// credential cannot pass this.
	for i, clientSecret := range []string{"rotation-value-one", "rotation-value-two"} {
		stubs := newAuth0Stubs(t, clientSecret)
		res, err := newExec(t).Execute(context.Background(),
			auth0Request(stubs, loadAuth0Example(t), clientSecret))
		require.NoError(t, err)
		require.Nil(t, res.Error, "run %d: %+v", i, res.Error)
		require.Len(t, stubs.tokenRequests, 1)
		assert.Equal(t, clientSecret, stubs.tokenRequests[0].ClientSecret)
	}
}
