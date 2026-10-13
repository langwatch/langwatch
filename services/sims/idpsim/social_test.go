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

// socialCode runs a social authorize request with a login hint and returns the code.
func socialCode(t *testing.T, s *Server, authorizePath string) string {
	t.Helper()
	q := url.Values{
		"response_type": {"code"}, "client_id": {"idpsim-social"}, "state": {"st"},
		"redirect_uri": {"https://app.example/api/auth/callback/x"}, "login_hint": {"admin@acme1.test"},
		"nonce": {"n-1"},
	}
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+authorizePath+"?"+q.Encode(), nil))
	require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
	back, err := url.Parse(rec.Header().Get("Location"))
	require.NoError(t, err)
	require.Equal(t, "st", back.Query().Get("state"))
	return back.Query().Get("code")
}

func socialExchange(t *testing.T, s *Server, tokenPath, code, accept string) *httptest.ResponseRecorder {
	t.Helper()
	form := url.Values{
		"grant_type": {"authorization_code"}, "code": {code}, "client_id": {"idpsim-social"},
		"client_secret": {"anything"}, "redirect_uri": {"https://app.example/api/auth/callback/x"},
	}
	req := httptest.NewRequest(http.MethodPost, testBase+tokenPath, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	rec := do(s, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return rec
}

func bearerGet(t *testing.T, s *Server, path, token string, into any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, testBase+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := do(s, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), into))
}

// @scenario "Signing in with GitHub at the simulator round-trips a GitHub-shaped profile"
func TestSocialGitHubRoundTrip(t *testing.T) {
	s := newTestServer(t, 1)
	code := socialCode(t, s, "/t/1/social/github/login/oauth/authorize")

	form, err := url.ParseQuery(socialExchange(t, s, "/t/1/social/github/login/oauth/access_token", code, "").Body.String())
	require.NoError(t, err, "GitHub answers a form unless asked for JSON")
	assert.Equal(t, "bearer", form.Get("token_type"))
	token := form.Get("access_token")
	require.NotEmpty(t, token)

	var profile map[string]any
	bearerGet(t, s, "/t/1/social/github/user", token, &profile)
	assert.Equal(t, "admin@acme1.test", profile["email"])
	assert.IsType(t, float64(0), profile["id"], "GitHub ids are numbers")
	var emails []map[string]any
	bearerGet(t, s, "/t/1/social/github/user/emails", token, &emails)
	require.Len(t, emails, 1)
	assert.Equal(t, true, emails[0]["primary"])
	assert.Equal(t, true, emails[0]["verified"])

	kinds := map[string]bool{}
	for _, ev := range activityOf(t, s, 1) {
		kinds[ev["kind"].(string)] = true
	}
	for _, k := range []string{"social.github.authorize", "social.github.token", "social.github.userinfo", "social.github.emails"} {
		assert.True(t, kinds[k], "activity carries %s", k)
	}
}

// @scenario "Signing in with Google or Microsoft at the simulator returns a signed ID token in the provider's shape"
func TestSocialIDTokenProviders(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	for provider, paths := range map[string][2]string{
		"google":    {"/t/1/social/google/o/oauth2/v2/auth", "/t/1/social/google/token"},
		"microsoft": {"/t/1/social/microsoft/common/oauth2/v2.0/authorize", "/t/1/social/microsoft/common/oauth2/v2.0/token"},
	} {
		code := socialCode(t, s, paths[0])
		var body map[string]any
		require.NoError(t, json.Unmarshal(socialExchange(t, s, paths[1], code, "application/json").Body.Bytes(), &body))
		parsed, err := jwt.Parse(body["id_token"].(string), jwksKeyfunc(t, s, 1), jwt.WithValidMethods([]string{"RS256"}))
		require.NoError(t, err, provider)
		claims := parsed.Claims.(jwt.MapClaims)
		assert.Equal(t, "admin@acme1.test", claims["email"], provider)
		assert.Equal(t, "n-1", claims["nonce"], provider)
		if provider == "microsoft" {
			assert.Equal(t, testBase+"/t/1/social/microsoft/"+tenant.AzureTenantID()+"/v2.0", claims["iss"])
			assert.Equal(t, tenant.AzureTenantID(), claims["tid"])
		} else {
			assert.Equal(t, testBase+"/t/1/social/google", claims["iss"])
			assert.Len(t, claims["sub"], 21)
		}
	}
	doc := getJSON(t, s, "/t/1/social/google/.well-known/openid-configuration")
	assert.Equal(t, testBase+"/t/1/social/google/token", doc["token_endpoint"])
}

// @scenario "The social account picker links back into the provider and can be cancelled"
func TestSocialPickerAndCancel(t *testing.T) {
	s := newTestServer(t, 1)
	q := url.Values{
		"response_type": {"code"}, "client_id": {"c"}, "state": {"st"},
		"redirect_uri": {"https://app.example/api/auth/callback/gitlab"},
	}
	page := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/social/gitlab/oauth/authorize?"+q.Encode(), nil))
	require.Equal(t, http.StatusOK, page.Code)
	assert.Contains(t, page.Body.String(), "idpsim console")

	picker := getJSON(t, s, "/api/t/1/sign-in?"+q.Encode()+"&social=gitlab")
	assert.Equal(t, "gitlab", picker["provider"])
	href := picker["users"].([]any)[0].(map[string]any)["href"].(string)
	assert.True(t, strings.HasPrefix(href, "/t/1/social/gitlab/oauth/authorize?"), href)
	assert.NotContains(t, href, "social=")

	cancelled := do(s, httptest.NewRequest(http.MethodGet, testBase+picker["cancelHref"].(string), nil))
	require.Equal(t, http.StatusFound, cancelled.Code)
	back, err := url.Parse(cancelled.Header().Get("Location"))
	require.NoError(t, err)
	assert.Equal(t, "access_denied", back.Query().Get("error"))
	assert.Equal(t, "st", back.Query().Get("state"))
	assert.Empty(t, back.Query().Get("code"))
	ev, ok := findEvent(activityOf(t, s, 1), "social.gitlab.authorize")
	require.True(t, ok)
	assert.Equal(t, OutcomeRefused, ev["outcome"])
}
