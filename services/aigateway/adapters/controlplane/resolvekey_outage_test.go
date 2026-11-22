package controlplane

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/jwtverify"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "a control plane that cannot answer resolve-key tells the client to retry"
func TestResolveKey_OutageIsRetryable(t *testing.T) {
	cases := []struct {
		name    string
		handler http.HandlerFunc
		closed  bool
	}{
		{name: "unreachable", closed: true},
		{name: "5xx", handler: func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusBadGateway) }},
		{name: "unreadable body", handler: func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte("not json")) }},
		{name: "unverifiable token", handler: func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(`{"jwt":"not-a-jwt"}`)) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := httptest.NewServer(tc.handler)
			if tc.closed {
				srv.Close()
			} else {
				defer srv.Close()
			}
			cp := NewClient(ClientOptions{
				BaseURL:    srv.URL,
				Sign:       func(_ *http.Request, _ []byte) {},
				HTTPClient: &http.Client{},
				Verifier:   jwtverify.NewJWTVerifier("jwt-secret", ""),
			})

			_, err := cp.ResolveKey(context.Background(), domain.PresentedKey{Token: "vk-lw-whatever"})
			require.ErrorIs(t, err, domain.ErrAuthUpstream)
			var unavailable herr.E
			require.ErrorAs(t, err, &unavailable)
			assert.True(t, unavailable.Retryable, "auth_upstream_unavailable tells the client to retry")
		})
	}
}
