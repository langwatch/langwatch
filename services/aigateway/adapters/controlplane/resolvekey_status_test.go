package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

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

// The vk_expires_at claim is what lets the gateway enforce the expiration date
// on its own, so its three wire shapes must all decode to the right thing: a
// date, or "this key never expires". A missing claim is the same answer as a
// null one, because a control plane older than the claim sends neither.
//
// @scenario "the token carries the key's expiration date to the gateway"
func TestExtractClaims_VirtualKeyExpiresAt(t *testing.T) {
	expiresAt := time.Now().Add(5 * time.Minute).Truncate(time.Second)

	cases := []struct {
		name  string
		claim any
		set   bool
		want  time.Time
	}{
		{
			name:  "present",
			claim: float64(expiresAt.Unix()),
			set:   true,
			want:  expiresAt,
		},
		{
			name: "absent",
			set:  false,
			want: time.Time{},
		},
		{
			name:  "null",
			claim: nil,
			set:   true,
			want:  time.Time{},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			m := map[string]any{
				"vk_id":  "vk_01HZX",
				"org_id": "org_01HZX",
				"exp":    float64(time.Now().Add(15 * time.Minute).Unix()),
			}
			if tc.set {
				m["vk_expires_at"] = tc.claim
			}

			bundle := claimsToBundle(extractClaims(m))

			assert.True(t, bundle.VirtualKeyExpiresAt.Equal(tc.want),
				"got %v, want %v", bundle.VirtualKeyExpiresAt, tc.want)
			pastTheDate := bundle.KeyExpired(time.Now().Add(10 * time.Minute))
			if tc.want.IsZero() {
				assert.False(t, pastTheDate, "a key with no date never expires")
			} else {
				assert.True(t, pastTheDate, "a key with a date expires once it passes")
			}
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
