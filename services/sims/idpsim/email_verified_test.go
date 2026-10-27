package idpsim

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "A tenant can say its addresses are unverified in its ID tokens"
func TestEmailVerifiedFollowsTheTenantConfig(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	user := tenant.Users()[0]
	mint := func() map[string]any {
		raw, err := s.mintIDToken(tenant, user, audience{ClientID: "client-1"})
		require.NoError(t, err)
		claims, err := parseIDToken(t, tenant, raw)
		require.NoError(t, err)
		return claims
	}
	assert.Equal(t, true, mint()["email_verified"])

	rec := postControl(t, s, "/control/t/1/config", `{"emailVerified":"false"}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"emailVerified":"false"`)
	assert.Equal(t, false, mint()["email_verified"])

	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/config", `{"emailVerified":"omit"}`).Code)
	assert.NotContains(t, mint(), "email_verified")

	assert.Equal(t, http.StatusBadRequest, postControl(t, s, "/control/t/1/config", `{"emailVerified":"maybe"}`).Code)
	tenant.Reset()
	assert.Equal(t, true, mint()["email_verified"])
}
