package idpsim

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func parseIDToken(t *testing.T, tenant *Tenant, raw string) (jwt.MapClaims, error) {
	t.Helper()
	claims := jwt.MapClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) {
		return &tenant.Key.PublicKey, nil
	}, jwt.WithIssuer(tenant.Issuer()), jwt.WithAudience("client-1"), jwt.WithValidMethods([]string{"RS256"}))
	return claims, err
}

func TestLegacyLegacyProviderShapesIssuerSubjectAndClaims(t *testing.T) {
	cases := []struct {
		provider LegacyProvider
		issuer   string
		sub      string
	}{
		{LegacyProviderAuth0, testBase + "/", `^auth0\|[0-9a-f]{24}$`},
		{LegacyProviderOkta, testBase + "/t/1/oauth2/default", `^00u[0-9A-Za-z]{17}$`},
		{LegacyProviderCognito, testBase + "/t/1/eu-west-1_idpsimT1", `^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`},
		{LegacyProviderOneLogin, testBase + "/t/1/oidc/2", `^[1-9][0-9]{8}$`},
	}
	for _, tc := range cases {
		t.Run(string(tc.provider), func(t *testing.T) {
			s := newTestServer(t, 1)
			tenant, _ := s.Tenant(1)
			tenant.SetLegacyProvider(tc.provider)
			user := tenant.Users()[0]
			raw, err := s.mintIDToken(tenant, user, audience{ClientID: "client-1", Nonce: "n1"})
			require.NoError(t, err)
			claims, err := parseIDToken(t, tenant, raw)
			require.NoError(t, err)
			assert.Equal(t, tc.issuer, claims["iss"])
			assert.Regexp(t, tc.sub, claims["sub"])
			if tc.provider == LegacyProviderCognito {
				assert.Equal(t, "id", claims["token_use"])
				assert.Equal(t, user.UserName, claims["cognito:username"])
				assert.Contains(t, claims, "cognito:groups")
				assert.NotContains(t, claims, "groups")
			}

			rec := httptest.NewRecorder()
			path := strings.TrimPrefix(tenant.DiscoveryURL(), testBase)
			s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
			require.Equal(t, http.StatusOK, rec.Code, path)
			var doc map[string]any
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &doc))
			assert.Equal(t, tc.issuer, doc["issuer"])
		})
	}
}

func TestTamperBreaksOnlyTheNextToken(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	user := tenant.Users()[0]
	mint := func(nonce string) string {
		raw, err := s.mintIDToken(tenant, user, audience{ClientID: "client-1", Nonce: nonce})
		require.NoError(t, err)
		return raw
	}

	tenant.ArmTamper(TamperBadSignature)
	_, err := parseIDToken(t, tenant, mint("a"))
	require.ErrorIs(t, err, jwt.ErrTokenSignatureInvalid)

	tenant.ArmTamper(TamperWrongAudience)
	_, err = parseIDToken(t, tenant, mint("b"))
	require.ErrorIs(t, err, jwt.ErrTokenInvalidAudience)

	tenant.ArmTamper(TamperExpired)
	_, err = parseIDToken(t, tenant, mint("c"))
	require.ErrorIs(t, err, jwt.ErrTokenExpired)

	tenant.ArmTamper(TamperReplayedNonce)
	claims, err := parseIDToken(t, tenant, mint("d"))
	require.NoError(t, err)
	assert.Equal(t, "c", claims["nonce"], "the nonce of the previous token, not the one requested")

	claims, err = parseIDToken(t, tenant, mint("e"))
	require.NoError(t, err, "the tamper is one-shot")
	assert.Equal(t, "e", claims["nonce"])
}

func TestControlLegacyEndpoints(t *testing.T) {
	s := newTestServer(t, 1)
	h := s.Handler()
	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
		return rec
	}
	assert.Equal(t, http.StatusConflict, do(http.MethodGet, "/control/t/1/legacy-env", "").Code)
	assert.Equal(t, http.StatusBadRequest, do(http.MethodPost, "/control/t/1/legacy-provider", `{"provider":"bogus"}`).Code)
	require.Equal(t, http.StatusOK, do(http.MethodPost, "/control/t/1/legacy-provider", `{"provider":"okta"}`).Code)
	assert.Equal(t, http.StatusBadRequest, do(http.MethodPost, "/control/t/1/tamper", `{"mode":"later"}`).Code)
	assert.Equal(t, http.StatusOK, do(http.MethodPost, "/control/t/1/tamper", `{"mode":"expired"}`).Code)

	env := do(http.MethodGet, "/control/t/1/legacy-env", "").Body.String()
	assert.Contains(t, env, "AUTH_PROVIDER=okta\n")
	assert.Contains(t, env, "OKTA_CLIENT_ID=langwatch-legacy-okta\n")
	assert.Contains(t, env, "OKTA_ISSUER="+testBase+"/t/1/oauth2/default\n")
}

func TestAuth0WebhookIsSignedTheWayTheStackVerifies(t *testing.T) {
	const secret = "test-only-webhook-secret"
	var got struct {
		path, auth, sig string
		body            []byte
	}
	stack := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got.path, got.auth, got.sig = r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("X-LangWatch-Signature")
		got.body, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte(`{"received":true}`))
	}))
	defer stack.Close()

	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	user := tenant.Users()[0]
	rec := httptest.NewRecorder()
	body := `{"target":"` + stack.URL + `/","secret":"` + secret + `","token":"scim-tok","user":"` + user.Email + `"}`
	s.Handler().ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/control/t/1/auth0-webhook", strings.NewReader(body)))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.NotContains(t, rec.Body.String(), secret)

	assert.Equal(t, auth0WebhookPath, got.path)
	assert.Equal(t, "Bearer scim-tok", got.auth)
	parts := map[string]string{}
	for _, piece := range strings.Split(got.sig, ",") {
		k, v, _ := strings.Cut(piece, "=")
		parts[k] = v
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts["t"] + "." + string(got.body)))
	assert.Equal(t, hex.EncodeToString(mac.Sum(nil)), parts["v1"])

	var events []struct {
		Data struct {
			Type    string `json:"type"`
			Details struct {
				Operation string `json:"operation"`
				UserName  string `json:"userName"`
			} `json:"details"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(got.body, &events))
	require.Len(t, events, 1)
	assert.Equal(t, "sscim", events[0].Data.Type)
	assert.Equal(t, "create", events[0].Data.Details.Operation)
	assert.Equal(t, user.Email, events[0].Data.Details.UserName)
}
