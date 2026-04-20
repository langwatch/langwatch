package authcache

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSign_SetsHeaders(t *testing.T) {
	s := NewSigner("my-secret", "node-42")
	req, err := http.NewRequest("POST", "http://localhost/api", nil)
	require.NoError(t, err)

	body := []byte(`{"model":"gpt-4"}`)
	s.Sign(req, body)

	assert.NotEmpty(t, req.Header.Get("X-Gateway-Timestamp"), "timestamp header should be set")
	assert.NotEmpty(t, req.Header.Get("X-Gateway-Signature"), "signature header should be set")
	assert.Equal(t, "node-42", req.Header.Get("X-Gateway-Node-ID"), "node ID header should be set")
}

func TestSign_EmptySecret(t *testing.T) {
	s := NewSigner("", "node-1")
	req, err := http.NewRequest("POST", "http://localhost/api", nil)
	require.NoError(t, err)

	s.Sign(req, []byte(`{"model":"gpt-4"}`))

	assert.Empty(t, req.Header.Get("X-Gateway-Timestamp"), "no headers should be set with empty secret")
	assert.Empty(t, req.Header.Get("X-Gateway-Signature"), "no headers should be set with empty secret")
	assert.Empty(t, req.Header.Get("X-Gateway-Node-ID"), "no headers should be set with empty secret")
}

func TestSign_DeterministicMAC(t *testing.T) {
	s := NewSigner("deterministic-secret", "node-1")
	body := []byte(`{"model":"gpt-4","messages":[]}`)

	// Sign twice with the same body
	req1, err := http.NewRequest("POST", "http://localhost/api", nil)
	require.NoError(t, err)
	s.Sign(req1, body)

	req2, err := http.NewRequest("POST", "http://localhost/api", nil)
	require.NoError(t, err)
	s.Sign(req2, body)

	ts1 := req1.Header.Get("X-Gateway-Timestamp")
	ts2 := req2.Header.Get("X-Gateway-Timestamp")
	sig1 := req1.Header.Get("X-Gateway-Signature")
	sig2 := req2.Header.Get("X-Gateway-Signature")

	// If timestamps match (same second), signatures must be identical
	if ts1 == ts2 {
		assert.Equal(t, sig1, sig2, "same timestamp + same body should produce same signature")
	}
	// Regardless, both signatures should be non-empty hex strings
	assert.NotEmpty(t, sig1)
	assert.NotEmpty(t, sig2)
}
