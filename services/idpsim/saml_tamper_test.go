package idpsim

import (
	"encoding/base64"
	"encoding/json"
	"html"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"

	"github.com/crewjam/saml"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testACS = "https://sp.example/saml/acs"

// testSP is a crewjam service provider trusting tenant 1, the product's stand-in.
func testSP(s *Server) *saml.ServiceProvider {
	tenant, _ := s.Tenant(1)
	idp := s.samlIDP(tenant)
	return &saml.ServiceProvider{
		EntityID:    "https://sp.example/saml/metadata",
		AcsURL:      mustParseURL(testACS),
		IDPMetadata: idp.Metadata(),
	}
}

// ssoResponse runs one SP-initiated sign-in at tenant 1 and returns the SAML response XML.
func ssoResponse(t *testing.T, s *Server) []byte {
	t.Helper()
	target := testBase + "/t/1/saml/sso?SAMLRequest=" + url.QueryEscape(samlRedirectRequest(t))
	rec := do(s, httptest.NewRequest(http.MethodGet, target, nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	match := regexp.MustCompile(`name="SAMLResponse" value="([^"]+)"`).FindStringSubmatch(rec.Body.String())
	require.NotNil(t, match)
	decoded, err := base64.StdEncoding.DecodeString(html.UnescapeString(match[1]))
	require.NoError(t, err)
	return decoded
}

func postControl(t *testing.T, s *Server, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(s, httptest.NewRequest(http.MethodPost, testBase+path, strings.NewReader(body)))
}

// callControl invokes a control handler directly, for routes server.go does not mount yet.
func callControl(s *Server, h http.HandlerFunc, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, testBase+"/control/t/1/x", strings.NewReader(body))
	req.SetPathValue("tenant", "1")
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

func activityKinds(t *testing.T, s *Server) string {
	t.Helper()
	raw, err := json.Marshal(getJSON(t, s, "/control/t/1/activity"))
	require.NoError(t, err)
	return string(raw)
}

// @scenario "A SAML response can be broken once in each way a service provider must refuse"
func TestSAMLTamperModesAreRefusedByAServiceProvider(t *testing.T) {
	modes := []TamperMode{
		TamperSAMLBadSignature, TamperSAMLUnsigned, TamperSAMLWrongAudience, TamperSAMLWrongRecipient,
		TamperSAMLExpired, TamperSAMLNotYetValid, TamperSAMLWrongInResponseTo,
	}
	for _, mode := range modes {
		t.Run(string(mode), func(t *testing.T) {
			s := newTestServer(t, 1)
			sp := testSP(s)
			rec := postControl(t, s, "/control/t/1/tamper", `{"mode":"`+string(mode)+`"}`)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

			_, err := sp.ParseXMLResponse(ssoResponse(t, s), []string{"id-test-1"}, sp.AcsURL)
			require.Error(t, err, "a %s response must not verify", mode)
			_, err = sp.ParseXMLResponse(ssoResponse(t, s), []string{"id-test-1"}, sp.AcsURL)
			require.NoError(t, err, "the break is one-shot")

			activity := activityKinds(t, s)
			assert.Contains(t, activity, "fault.tamper")
			assert.Contains(t, activity, "deliberately broke it: "+string(mode))
		})
	}
}

// @scenario "A replayed SAML assertion repeats the previous assertion's ID"
func TestSAMLReplayedAssertion(t *testing.T) {
	s := newTestServer(t, 1)
	sp := testSP(s)
	first, err := sp.ParseXMLResponse(ssoResponse(t, s), []string{"id-test-1"}, sp.AcsURL)
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/tamper", `{"mode":"saml-replayed-assertion"}`).Code)
	replayed, err := sp.ParseXMLResponse(ssoResponse(t, s), []string{"id-test-1"}, sp.AcsURL)
	require.NoError(t, err, "a replay verifies; refusing it is the service provider's job")
	assert.Equal(t, first.ID, replayed.ID)
}

// @scenario "An unknown tamper mode is refused"
func TestUnknownTamperModeRefused(t *testing.T) {
	s := newTestServer(t, 1)
	rec := postControl(t, s, "/control/t/1/tamper", `{"mode":"saml-sideways"}`)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), "saml-unsigned")
}

// @scenario "A tenant's clock can run ahead of or behind the service provider's"
func TestSAMLClockSkewBothWays(t *testing.T) {
	cases := map[string]struct {
		skew    string
		refused bool
	}{"ahead": {"600", true}, "behind": {"-600", true}, "within tolerance": {"30", false}}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			s := newTestServer(t, 1)
			sp := testSP(s)
			rec := postControl(t, s, "/control/t/1/config", `{"skewSeconds":`+tc.skew+`}`)
			require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
			assert.Contains(t, rec.Body.String(), `"skewSeconds":`+tc.skew)

			_, err := sp.ParseXMLResponse(ssoResponse(t, s), []string{"id-test-1"}, sp.AcsURL)
			assert.Equal(t, tc.refused, err != nil, "err=%v", err)
			assert.Contains(t, activityKinds(t, s), "fault.skew")
		})
	}
}

// @scenario "An unsolicited SAML response carries the chosen RelayState and no InResponseTo"
func TestSAMLUnsolicitedResponse(t *testing.T) {
	s := newTestServer(t, 1)
	rec := callControl(s, s.handleControlSAMLUnsolicited,
		`{"acsUrl":"`+testACS+`","entityId":"https://sp.example/saml/metadata","email":"admin@acme1.test","relayState":"/settings/members"}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var form struct{ URL, SAMLResponse, RelayState string }
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &form))
	assert.Equal(t, testACS, form.URL)
	assert.Equal(t, "/settings/members", form.RelayState)
	decoded, err := base64.StdEncoding.DecodeString(form.SAMLResponse)
	require.NoError(t, err)
	assert.NotContains(t, string(decoded), "InResponseTo")

	sp := testSP(s)
	_, err = sp.ParseXMLResponse(decoded, nil, sp.AcsURL)
	require.Error(t, err, "a service provider that only accepts solicited responses refuses it")
	sp.AllowIDPInitiated = true
	assertion, err := sp.ParseXMLResponse(decoded, nil, sp.AcsURL)
	require.NoError(t, err)
	assert.Equal(t, "admin@acme1.test", assertion.Subject.NameID.Value)
	assert.Contains(t, activityKinds(t, s), "RelayState /settings/members")
}

// @scenario "An unsolicited SAML response needs an ACS URL and an active user"
func TestSAMLUnsolicitedRefusals(t *testing.T) {
	s := newTestServer(t, 1)
	assert.Equal(t, http.StatusBadRequest, callControl(s, s.handleControlSAMLUnsolicited, `{"email":"admin@acme1.test"}`).Code)
	assert.Equal(t, http.StatusForbidden,
		callControl(s, s.handleControlSAMLUnsolicited, `{"acsUrl":"`+testACS+`","email":"nobody@acme1.test"}`).Code)
	assert.Contains(t, activityKinds(t, s), "is not an active user")
}

// @scenario "A user disabled at the IdP is refused at sign-in"
func TestDisabledUserRefusedAtTheIdP(t *testing.T) {
	s := newTestServer(t, 1)
	rec := callControl(s, s.handleControlUserActive, `{"user":"admin@acme1.test","active":false}`)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	target := testBase + "/t/1/saml/sso?login_hint=admin%40acme1.test&SAMLRequest=" + url.QueryEscape(samlRedirectRequest(t))
	assert.Equal(t, http.StatusBadRequest, do(s, httptest.NewRequest(http.MethodGet, target, nil)).Code)
	authorize := testBase + "/t/1/oauth/authorize?response_type=code&client_id=app&state=s" +
		"&redirect_uri=https%3A%2F%2Fapp.example%2Fcb&login_hint=admin%40acme1.test"
	oidc := do(s, httptest.NewRequest(http.MethodGet, authorize, nil))
	assert.NotContains(t, oidc.Header().Get("Location"), "code=")
	assert.Equal(t, http.StatusForbidden,
		callControl(s, s.handleControlSAMLUnsolicited, `{"acsUrl":"`+testACS+`","email":"admin@acme1.test"}`).Code)
	assert.Contains(t, activityKinds(t, s), "disabled admin@acme1.test at the IdP")

	assert.Equal(t, http.StatusBadRequest, callControl(s, s.handleControlUserActive, `{"user":"admin@acme1.test"}`).Code)
	assert.Equal(t, http.StatusNotFound, callControl(s, s.handleControlUserActive, `{"user":"nobody@acme1.test","active":true}`).Code)
}
