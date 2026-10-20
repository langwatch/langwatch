package idpsim

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "A tenant can assert a second factor in its ID tokens"
func TestAmrIsAssertedOnlyOnceConfigured(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	user := tenant.Users()[0]

	raw, err := s.mintIDToken(tenant, user, audience{ClientID: "client-1"})
	require.NoError(t, err)
	claims, err := parseIDToken(t, tenant, raw)
	require.NoError(t, err)
	assert.NotContains(t, claims, "amr")

	rec := postControl(t, s, "/control/t/1/config", `{"amr":["pwd","mfa"]}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Contains(t, rec.Body.String(), `"amr":["pwd","mfa"]`)

	raw, err = s.mintIDToken(tenant, user, audience{ClientID: "client-1"})
	require.NoError(t, err)
	claims, err = parseIDToken(t, tenant, raw)
	require.NoError(t, err)
	assert.Equal(t, []any{"pwd", "mfa"}, claims["amr"])
}

// @scenario "A tenant can assert a second factor in its ID tokens"
func TestAmrIsClearedByAnEmptyListAndByReset(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)

	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/config", `{"amr":["mfa"]}`).Code)
	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/config", `{"amr":[]}`).Code)
	assert.Empty(t, tenant.Amr())

	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/config", `{"amr":["mfa"]}`).Code)
	tenant.Reset()
	assert.Empty(t, tenant.Amr())
}

// @scenario "A tenant can assert a second factor in its ID tokens"
func TestAmrOverridesALegacyOktaTenantsDefault(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	tenant.SetLegacyProvider(LegacyProviderOkta)
	parse := func() any {
		raw, err := s.mintIDToken(tenant, tenant.Users()[0], audience{ClientID: "client-1"})
		require.NoError(t, err)
		claims, err := parseIDToken(t, tenant, raw)
		require.NoError(t, err)
		return claims["amr"]
	}
	assert.Equal(t, []any{"pwd"}, parse())

	tenant.SetAmr([]string{"pwd", "mfa"})
	assert.Equal(t, []any{"pwd", "mfa"}, parse())
}
