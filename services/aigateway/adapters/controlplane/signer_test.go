package controlplane

import (
	"net/http"
	"net/url"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewSigner_RequiresSecret(t *testing.T) {
	_, err := NewSigner("", "node-1")
	require.ErrorIs(t, err, ErrEmptySecret)
}

func TestNewSigner_AcceptsNonEmptySecret(t *testing.T) {
	s, err := NewSigner("my-secret", "node-42")
	require.NoError(t, err)
	assert.NotNil(t, s)
}

func TestSign_SetsHeaders(t *testing.T) {
	s, err := NewSigner("my-secret", "node-42")
	require.NoError(t, err)

	req, err := http.NewRequest(http.MethodPost, "http://localhost/api", nil)
	require.NoError(t, err)

	body := []byte(`{"model":"gpt-4"}`)
	s.Sign(req, body)

	assert.NotEmpty(t, req.Header.Get("X-LangWatch-Gateway-Timestamp"), "timestamp header should be set")
	assert.NotEmpty(t, req.Header.Get("X-LangWatch-Gateway-Signature"), "signature header should be set")
	assert.Equal(t, "node-42", req.Header.Get("X-LangWatch-Gateway-Node"), "node ID header should be set")
}

func TestSign_DeterministicMAC(t *testing.T) {
	s, err := NewSigner("deterministic-secret", "node-1")
	require.NoError(t, err)

	body := []byte(`{"model":"gpt-4","messages":[]}`)

	// Sign twice with the same body
	req1, err := http.NewRequest(http.MethodPost, "http://localhost/api", nil)
	require.NoError(t, err)
	s.Sign(req1, body)

	req2, err := http.NewRequest(http.MethodPost, "http://localhost/api", nil)
	require.NoError(t, err)
	s.Sign(req2, body)

	ts1 := req1.Header.Get("X-LangWatch-Gateway-Timestamp")
	ts2 := req2.Header.Get("X-LangWatch-Gateway-Timestamp")
	sig1 := req1.Header.Get("X-LangWatch-Gateway-Signature")
	sig2 := req2.Header.Get("X-LangWatch-Gateway-Signature")

	// If timestamps match (same second), signatures must be identical
	if ts1 == ts2 {
		assert.Equal(t, sig1, sig2, "same timestamp + same body should produce same signature")
	}
	// Regardless, both signatures should be non-empty hex strings
	assert.NotEmpty(t, sig1)
	assert.NotEmpty(t, sig2)
}

// The same vector is asserted by the TypeScript verifier's rule test, so the
// two ends cannot drift apart on how a query is canonicalised.
func TestCanonicalPathSortsAndEncodesTheQuery(t *testing.T) {
	u, err := url.Parse("/api/internal/gateway/budget-bucket-spend?end_user_id=a%20b%2Bc~*!&budget_id=x%2Fy&a=2&a=1&n=%C3%A9&flag")
	require.NoError(t, err)

	assert.Equal(t,
		"/api/internal/gateway/budget-bucket-spend?a=1&a=2&budget_id=x%2Fy&end_user_id=a%20b%2Bc~%2A%21&flag=&n=%C3%A9",
		CanonicalPath(u))
	assert.Equal(t, "/api/internal/gateway/health", CanonicalPath(&url.URL{Path: "/api/internal/gateway/health"}))
}
