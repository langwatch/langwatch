package idpsim

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func auth0Server(t *testing.T) (*Server, *Tenant, *User) {
	t.Helper()
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	tenant.SetLegacyProvider(LegacyProviderAuth0)
	return s, tenant, tenant.Users()[0]
}

func auth0Post(s *Server, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, testBase+"/oauth/token", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return do(s, req)
}

func managementToken(t *testing.T, s *Server) string {
	t.Helper()
	rec := auth0Post(s, `{"grant_type":"client_credentials","client_id":"m2m","client_secret":"x","audience":"`+testBase+`/api/v2/"}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var body struct {
		AccessToken string `json:"access_token"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return body.AccessToken
}

func patchPassword(s *Server, token, id, password string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPatch, testBase+"/api/v2/users/"+id,
		strings.NewReader(`{"password":"`+password+`","connection":"Username-Password-Authentication"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	return do(s, req)
}

func passwordGrant(s *Server, email, password string) int {
	return auth0Post(s, `{"grant_type":"password","username":"`+email+`","password":"`+password+`","scope":"openid"}`).Code
}

// @scenario "An Auth0 tenant checks and changes a password the way the product asks"
func TestAuth0PasswordChangeRoundTrip(t *testing.T) {
	s, tenant, user := auth0Server(t)

	assert.Equal(t, http.StatusOK, passwordGrant(s, user.Email, Auth0DefaultPassword))
	wrong := auth0Post(s, `{"grant_type":"password","username":"`+user.Email+`","password":"nope"}`)
	assert.Equal(t, http.StatusForbidden, wrong.Code)
	assert.Contains(t, wrong.Body.String(), `"error":"invalid_grant"`)

	rec := patchPassword(s, managementToken(t, s), tenant.OIDCSubject(user), "a-new-password-1")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	assert.Equal(t, http.StatusForbidden, passwordGrant(s, user.Email, Auth0DefaultPassword))
	assert.Equal(t, http.StatusOK, passwordGrant(s, user.Email, "a-new-password-1"))
}

// @scenario "An Auth0 tenant checks and changes a password the way the product asks"
func TestAuth0ManagementRefusals(t *testing.T) {
	s, tenant, user := auth0Server(t)
	id := tenant.OIDCSubject(user)

	assert.Equal(t, http.StatusUnauthorized, patchPassword(s, "not-a-token", id, "a-new-password-1").Code)

	weak := patchPassword(s, managementToken(t, s), id, "short")
	assert.Equal(t, http.StatusBadRequest, weak.Code)
	assert.Contains(t, weak.Body.String(), "PasswordStrengthError")

	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/config", `{"auth0Scopes":["read:users"]}`).Code)
	narrow := patchPassword(s, managementToken(t, s), id, "a-new-password-1")
	assert.Equal(t, http.StatusForbidden, narrow.Code)
	assert.Contains(t, narrow.Body.String(), `"errorCode":"insufficient_scope"`)

	tenant.Reset()
	assert.Equal(t, []string{auth0UpdateUsersScope}, tenant.Auth0ManagementScopes())
	assert.Equal(t, Auth0DefaultPassword, tenant.Auth0Password(user.ID))
}

// @scenario "An Auth0 tenant checks and changes a password the way the product asks"
func TestAuth0RootTokenNeedsAnAuth0Tenant(t *testing.T) {
	s := newTestServer(t, 1)
	assert.Equal(t, http.StatusNotFound, auth0Post(s, `{"grant_type":"client_credentials"}`).Code)
}
