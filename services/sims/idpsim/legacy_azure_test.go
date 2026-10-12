package idpsim

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const guidPattern = `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`

func azureTenant(t *testing.T) (*Server, *Tenant) {
	t.Helper()
	s := newTestServer(t, 2)
	tenant, _ := s.Tenant(1)
	tenant.SetLegacyProvider(LegacyProviderAzure)
	return s, tenant
}

func TestAzureShapesIssuerSubjectAndClaims(t *testing.T) {
	s, tenant := azureTenant(t)
	user := tenant.Users()[0]
	raw, err := s.mintIDToken(tenant, user, audience{ClientID: "client-1", Nonce: "n1"})
	require.NoError(t, err)
	claims, err := parseIDToken(t, tenant, raw)
	require.NoError(t, err)

	tid := tenant.AzureTenantID()
	assert.Regexp(t, guidPattern, tid)
	assert.Equal(t, testBase+"/"+tid+"/v2.0", claims["iss"])
	assert.Equal(t, tid, claims["tid"])
	assert.Equal(t, "2.0", claims["ver"])
	assert.Regexp(t, guidPattern, claims["oid"])
	assert.Regexp(t, `^[A-Za-z0-9_-]{43}$`, claims["sub"])
	assert.Equal(t, user.Email, claims["preferred_username"])
	assert.Equal(t, user.Email, claims["email"])
	for _, absent := range []string{"email_verified", "groups", "picture", "given_name"} {
		assert.NotContains(t, claims, absent)
	}
	other, _ := s.Tenant(2)
	assert.NotEqual(t, tid, other.AzureTenantID())
}

func TestAzureAuthorityPathsServeTheTenantFromTheHostRoot(t *testing.T) {
	s, tenant := azureTenant(t)
	tid := tenant.AzureTenantID()
	h := s.Handler()
	get := func(path string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, testBase+path, nil))
		return rec
	}

	disc := get("/" + tid + "/v2.0/.well-known/openid-configuration")
	require.Equal(t, http.StatusOK, disc.Code)
	var doc map[string]any
	require.NoError(t, json.Unmarshal(disc.Body.Bytes(), &doc))
	assert.Equal(t, tenant.Issuer(), doc["issuer"])
	assert.Equal(t, testBase+"/"+tid+"/oauth2/v2.0/token", doc["token_endpoint"])
	assert.Equal(t, http.StatusOK, get("/"+tid+"/discovery/v2.0/keys").Code)

	q := url.Values{
		"client_id": {"c"}, "response_type": {"code"}, "nonce": {"n-1"},
		"redirect_uri": {"https://app.example/api/auth/callback/azure-ad"},
		"login_hint":   {"admin@acme1.test"},
	}
	auth := get("/" + tid + "/oauth2/v2.0/authorize?" + q.Encode())
	require.Equal(t, http.StatusFound, auth.Code)
	loc, err := url.Parse(auth.Header().Get("Location"))
	require.NoError(t, err)

	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {loc.Query().Get("code")},
		"client_id": {"c"}, "redirect_uri": {q.Get("redirect_uri")},
	}
	req := httptest.NewRequest(http.MethodPost, testBase+"/"+tid+"/oauth2/v2.0/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var out struct {
		IDToken string `json:"id_token"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	claims := jwt.MapClaims{}
	_, err = jwt.ParseWithClaims(out.IDToken, claims, func(*jwt.Token) (any, error) {
		return &tenant.Key.PublicKey, nil
	}, jwt.WithIssuer(testBase+"/"+tid+"/v2.0"), jwt.WithAudience("c"))
	require.NoError(t, err)
	assert.Equal(t, tid, claims["tid"])

	other, _ := s.Tenant(2)
	assert.NotContains(t, get("/"+other.AzureTenantID()+"/discovery/v2.0/keys").Body.String(), `"keys"`,
		"a tenant that is not azure-shaped is not served from the root")
}

func TestAzureLegacyEnvNamesTheTenantNotAnIssuer(t *testing.T) {
	s, tenant := azureTenant(t)
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/control/t/1/legacy-env", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	env := rec.Body.String()
	assert.Contains(t, env, "AUTH_PROVIDER=azure-ad\n")
	assert.Contains(t, env, "AZURE_AD_CLIENT_ID=langwatch-legacy-azure\n")
	assert.Contains(t, env, "AZURE_AD_TENANT_ID="+tenant.AzureTenantID()+"\n")
	assert.NotContains(t, env, "ISSUER")

	set := httptest.NewRecorder()
	s.Handler().ServeHTTP(set, httptest.NewRequest(http.MethodPost, "/control/t/2/legacy-provider", strings.NewReader(`{"provider":"azure"}`)))
	assert.Equal(t, http.StatusOK, set.Code)
}
