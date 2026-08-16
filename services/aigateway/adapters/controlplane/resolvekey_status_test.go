package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// A 403 from the control plane carries the reason in its error code, and the
// gateway has to forward the distinction: "extend the date", "ask an
// administrator" and "mint a new key" are three different actions, and a
// tenant told the wrong one takes the wrong one.
//
// @scenario "An expired key is rejected with its own error code"
func TestResolveKey_ForbiddenBodyDecidesTheCode(t *testing.T) {
	cases := []struct {
		name string
		body string
		want error
	}{
		{
			name: "expired",
			body: `{"error":{"type":"virtual_key_expired","code":"virtual_key_expired","message":"virtual key has expired"}}`,
			want: domain.ErrKeyExpired,
		},
		{
			name: "disabled",
			body: `{"error":{"type":"virtual_key_disabled","code":"virtual_key_disabled","message":"virtual key is disabled"}}`,
			want: domain.ErrKeyDisabled,
		},
		{
			name: "revoked",
			body: `{"error":{"type":"virtual_key_revoked","code":"virtual_key_revoked","message":"virtual key has been revoked"}}`,
			want: domain.ErrKeyRevoked,
		},
		{
			// A gateway older than the code it is told about must still
			// refuse the request, so an unrecognized 403 stays revoked.
			name: "a code this build has never heard of",
			body: `{"error":{"type":"virtual_key_hibernated","code":"virtual_key_hibernated","message":"?"}}`,
			want: domain.ErrKeyRevoked,
		},
		{
			// The code decides, never the prose beside it: a message is
			// written for a person and may name any other code.
			name: "a message naming a code the key is not",
			body: `{"error":{"code":"virtual_key_expired","message":"not virtual_key_disabled, and not virtual_key_revoked"}}`,
			want: domain.ErrKeyExpired,
		},
		{
			// A 403 the gateway cannot read at all is still a stop.
			name: "a body that is not the error envelope",
			body: `forbidden`,
			want: domain.ErrKeyRevoked,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				_, _ = w.Write([]byte(tc.body))
			}))
			defer srv.Close()

			cp := NewClient(ClientOptions{
				BaseURL:    srv.URL,
				Sign:       func(_ *http.Request, _ []byte) {},
				HTTPClient: srv.Client(),
			})

			_, err := cp.ResolveKey(context.Background(), "vk-lw-whatever")
			require.Error(t, err)
			assert.ErrorIs(t, err, tc.want)
		})
	}
}

// An unknown key and a bad credential are the same answer, and neither is a
// stop on a key that exists: 401 must not be read as one of the 403 codes.
func TestResolveKey_UnauthorizedIsAnInvalidKey(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":{"code":"virtual_key_not_found"}}`))
	}))
	defer srv.Close()

	cp := NewClient(ClientOptions{
		BaseURL:    srv.URL,
		Sign:       func(_ *http.Request, _ []byte) {},
		HTTPClient: srv.Client(),
	})

	_, err := cp.ResolveKey(context.Background(), "vk-lw-whatever")
	require.Error(t, err)
	require.NotErrorIs(t, err, domain.ErrKeyExpired)
	require.ErrorIs(t, err, domain.ErrInvalidAPIKey)
}
