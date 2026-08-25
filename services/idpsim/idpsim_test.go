package idpsim

import (
	"bytes"
	"compress/flate"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"maps"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/net/dns/dnsmessage"
)

const testBase = "http://idp.example"

func newTestServer(t *testing.T, tenants int) *Server {
	t.Helper()
	s, err := NewServer(Config{Addr: ":0", BaseURL: testBase, Tenants: tenants})
	require.NoError(t, err)
	return s
}

func do(s *Server, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	return rec
}

func getJSON(t *testing.T, s *Server, path string) map[string]any {
	t.Helper()
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+path, nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var out map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

// @scenario "Each tenant publishes its own OIDC discovery document"
func TestDiscoveryDocumentPerTenant(t *testing.T) {
	s := newTestServer(t, 2)
	doc := getJSON(t, s, "/t/2/.well-known/openid-configuration")
	assert.Equal(t, testBase+"/t/2", doc["issuer"])
	for _, key := range []string{"authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"} {
		endpoint, ok := doc[key].(string)
		require.True(t, ok, key)
		assert.True(t, strings.HasPrefix(endpoint, testBase+"/t/2/"), "%s=%s must live under the issuer", key, endpoint)
	}
}

// completeCodeFlow drives authorize → token for tenant 1's admin and returns
// the token response.
func completeCodeFlow(t *testing.T, s *Server, authorizeParams url.Values, tokenForm url.Values) map[string]any {
	t.Helper()
	q := url.Values{
		"response_type": {"code"},
		"client_id":     {"test-client"},
		"redirect_uri":  {"https://app.example/api/auth/callback/oidc"},
		"scope":         {"openid email profile"},
		"state":         {"st-1"},
		"nonce":         {"n-1"},
		"login_hint":    {"admin@acme1.test"},
	}
	maps.Copy(q, authorizeParams)
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/oauth/authorize?"+q.Encode(), nil))
	require.Equal(t, http.StatusFound, rec.Code, rec.Body.String())
	loc, err := url.Parse(rec.Header().Get("Location"))
	require.NoError(t, err)
	require.Equal(t, "st-1", loc.Query().Get("state"))
	code := loc.Query().Get("code")
	require.NotEmpty(t, code)

	form := url.Values{
		"grant_type":   {"authorization_code"},
		"code":         {code},
		"client_id":    {"test-client"},
		"redirect_uri": {q.Get("redirect_uri")},
	}
	maps.Copy(form, tokenForm)
	req := httptest.NewRequest(http.MethodPost, testBase+"/t/1/oauth/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokenRec := do(s, req)
	var out map[string]any
	require.NoError(t, json.Unmarshal(tokenRec.Body.Bytes(), &out))
	out["_status"] = tokenRec.Code
	return out
}

// jwksKeyfunc builds a jwt keyfunc from a tenant's published JWKS.
func jwksKeyfunc(t *testing.T, s *Server, tenant int) jwt.Keyfunc {
	t.Helper()
	doc := getJSON(t, s, fmt.Sprintf("/t/%d/oauth/jwks", tenant))
	keys := doc["keys"].([]any)
	require.Len(t, keys, 1)
	key := keys[0].(map[string]any)
	nBytes, err := base64.RawURLEncoding.DecodeString(key["n"].(string))
	require.NoError(t, err)
	eBytes, err := base64.RawURLEncoding.DecodeString(key["e"].(string))
	require.NoError(t, err)
	pub := &rsa.PublicKey{N: new(big.Int).SetBytes(nBytes), E: int(new(big.Int).SetBytes(eBytes).Int64())}
	return func(*jwt.Token) (any, error) { return pub, nil }
}

// @scenario "The authorization code flow completes without a real user"
func TestAuthorizationCodeFlow(t *testing.T) {
	s := newTestServer(t, 1)
	out := completeCodeFlow(t, s, nil, nil)
	require.Equal(t, http.StatusOK, out["_status"])

	idToken, ok := out["id_token"].(string)
	require.True(t, ok)
	parsed, err := jwt.Parse(idToken, jwksKeyfunc(t, s, 1), jwt.WithValidMethods([]string{"RS256"}))
	require.NoError(t, err)
	claims := parsed.Claims.(jwt.MapClaims)
	assert.Equal(t, testBase+"/t/1", claims["iss"])
	assert.Equal(t, "t1-user-admin", claims["sub"])
	assert.Equal(t, "admin@acme1.test", claims["email"])
	assert.Equal(t, "n-1", claims["nonce"])
}

// @scenario "An authorize request without a login hint offers the tenant's users"
func TestAuthorizeAccountPicker(t *testing.T) {
	s := newTestServer(t, 1)
	q := url.Values{
		"response_type": {"code"}, "client_id": {"c"},
		"redirect_uri": {"https://app.example/cb"},
	}
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/oauth/authorize?"+q.Encode(), nil))
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()
	assert.Contains(t, body, "admin@acme1.test")
	assert.Contains(t, body, "member@acme1.test")
	assert.Contains(t, body, "login_hint")
}

// pkceParams derives an S256 challenge pair the way a client would.
func pkceParams() (verifier string, challengeParams url.Values) {
	verifier = "test-verifier-test-verifier-test-verifier-42"
	sum := sha256.Sum256([]byte(verifier))
	return verifier, url.Values{
		"code_challenge":        {base64.RawURLEncoding.EncodeToString(sum[:])},
		"code_challenge_method": {"S256"},
	}
}

// @scenario "PKCE is enforced once a challenge was presented"
func TestPKCEEnforcement(t *testing.T) {
	s := newTestServer(t, 1)
	verifier, challenge := pkceParams()

	missing := completeCodeFlow(t, s, challenge, nil)
	assert.Equal(t, http.StatusBadRequest, missing["_status"])
	assert.Equal(t, "invalid_grant", missing["error"])

	wrong := completeCodeFlow(t, s, challenge, url.Values{"code_verifier": {"not-the-verifier"}})
	assert.Equal(t, http.StatusBadRequest, wrong["_status"])

	right := completeCodeFlow(t, s, challenge, url.Values{"code_verifier": {verifier}})
	assert.Equal(t, http.StatusOK, right["_status"])
	assert.NotEmpty(t, right["id_token"])
}

// @scenario "An authorization code is single-use"
func TestAuthorizationCodeSingleUse(t *testing.T) {
	s := newTestServer(t, 1)
	q := url.Values{
		"response_type": {"code"}, "client_id": {"c"},
		"redirect_uri": {"https://app.example/cb"}, "login_hint": {"admin@acme1.test"},
	}
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/oauth/authorize?"+q.Encode(), nil))
	require.Equal(t, http.StatusFound, rec.Code)
	loc, _ := url.Parse(rec.Header().Get("Location"))
	code := loc.Query().Get("code")

	exchange := func() int {
		form := url.Values{
			"grant_type": {"authorization_code"}, "code": {code},
			"client_id": {"c"}, "redirect_uri": {"https://app.example/cb"},
		}
		req := httptest.NewRequest(http.MethodPost, testBase+"/t/1/oauth/token", strings.NewReader(form.Encode()))
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		return do(s, req).Code
	}
	assert.Equal(t, http.StatusOK, exchange())
	assert.Equal(t, http.StatusBadRequest, exchange())
}

// @scenario "The userinfo endpoint returns the authenticated user's claims"
func TestUserinfo(t *testing.T) {
	s := newTestServer(t, 1)
	out := completeCodeFlow(t, s, nil, nil)
	require.Equal(t, http.StatusOK, out["_status"])

	req := httptest.NewRequest(http.MethodGet, testBase+"/t/1/oauth/userinfo", nil)
	req.Header.Set("Authorization", "Bearer "+out["access_token"].(string))
	rec := do(s, req)
	require.Equal(t, http.StatusOK, rec.Code)
	var claims map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &claims))
	assert.Equal(t, "t1-user-admin", claims["sub"])
	assert.Equal(t, "admin@acme1.test", claims["email"])
	assert.Equal(t, "Ada Admin", claims["name"])

	bare := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/oauth/userinfo", nil))
	assert.Equal(t, http.StatusUnauthorized, bare.Code)
}

// @scenario "A tenant can mint Auth0-style SAML-brokered subjects"
func TestSamlpSubjects(t *testing.T) {
	s := newTestServer(t, 1)
	req := httptest.NewRequest(http.MethodPost, testBase+"/control/t/1/config",
		strings.NewReader(`{"samlpSubjects":true}`))
	require.Equal(t, http.StatusOK, do(s, req).Code)

	out := completeCodeFlow(t, s, nil, nil)
	require.Equal(t, http.StatusOK, out["_status"])
	parsed, err := jwt.Parse(out["id_token"].(string), jwksKeyfunc(t, s, 1), jwt.WithValidMethods([]string{"RS256"}))
	require.NoError(t, err)
	sub := parsed.Claims.(jwt.MapClaims)["sub"].(string)
	assert.True(t, strings.HasPrefix(sub, "samlp|"), "sub=%s", sub)
}

// @scenario "Each tenant publishes SAML IdP metadata with its signing certificate"
func TestSAMLMetadata(t *testing.T) {
	s := newTestServer(t, 1)
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/saml/metadata", nil))
	require.Equal(t, http.StatusOK, rec.Code)
	body := rec.Body.String()
	tenant, _ := s.Tenant(1)
	assert.Contains(t, body, `entityID="`+testBase+`/t/1/saml/metadata"`)
	assert.Contains(t, body, testBase+"/t/1/saml/sso")
	assert.Contains(t, stripWhitespace(body), base64.StdEncoding.EncodeToString(tenant.Cert.Raw))
}

func stripWhitespace(s string) string {
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' {
			return -1
		}
		return r
	}, s)
}

// samlRedirectRequest builds a redirect-binding AuthnRequest aimed at tenant 1.
func samlRedirectRequest(t *testing.T) string {
	t.Helper()
	xmlReq := fmt.Sprintf(`<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="id-test-1" Version="2.0" IssueInstant=%q Destination=%q AssertionConsumerServiceURL="https://sp.example/saml/acs" ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"><saml:Issuer>https://sp.example/saml/metadata</saml:Issuer></samlp:AuthnRequest>`,
		time.Now().UTC().Format(time.RFC3339), testBase+"/t/1/saml/sso")
	var buf bytes.Buffer
	fw, err := flate.NewWriter(&buf, flate.DefaultCompression)
	require.NoError(t, err)
	_, err = fw.Write([]byte(xmlReq))
	require.NoError(t, err)
	require.NoError(t, fw.Close())
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

// @scenario "A SAML authentication request produces a signed response for a seeded user"
func TestSAMLSSO(t *testing.T) {
	s := newTestServer(t, 1)
	target := testBase + "/t/1/saml/sso?SAMLRequest=" + url.QueryEscape(samlRedirectRequest(t))
	rec := do(s, httptest.NewRequest(http.MethodGet, target, nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	body := rec.Body.String()
	assert.Contains(t, body, `action="https://sp.example/saml/acs"`)

	match := regexp.MustCompile(`name="SAMLResponse" value="([^"]+)"`).FindStringSubmatch(body)
	require.NotNil(t, match, "no SAMLResponse form field in: %s", body)
	decoded, err := base64.StdEncoding.DecodeString(html.UnescapeString(match[1]))
	require.NoError(t, err)
	response := string(decoded)

	tenant, _ := s.Tenant(1)
	assert.Contains(t, response, "SignatureValue")
	assert.Contains(t, stripWhitespace(response), base64.StdEncoding.EncodeToString(tenant.Cert.Raw))
	assert.Contains(t, response, "admin@acme1.test")
}

func scimRequest(method, path, token, body string) *http.Request {
	req := httptest.NewRequest(method, testBase+path, strings.NewReader(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/scim+json")
	return req
}

// @scenario "SCIM requests without the tenant's bearer token are refused"
func TestSCIMAuth(t *testing.T) {
	s := newTestServer(t, 1)
	assert.Equal(t, http.StatusUnauthorized, do(s, scimRequest(http.MethodGet, "/t/1/scim/v2/Users", "", "")).Code)
	assert.Equal(t, http.StatusUnauthorized, do(s, scimRequest(http.MethodGet, "/t/1/scim/v2/Users", "wrong-token", "")).Code)
}

// @scenario "Users can be provisioned and deprovisioned over SCIM"
func TestSCIMUserLifecycle(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	token := tenant.SCIMToken

	created := do(s, scimRequest(http.MethodPost, "/t/1/scim/v2/Users", token,
		`{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"newhire@acme1.test","name":{"givenName":"New","familyName":"Hire"},"emails":[{"value":"newhire@acme1.test","primary":true}],"active":true}`))
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
	var user map[string]any
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &user))
	id := user["id"].(string)

	listed := do(s, scimRequest(http.MethodGet, "/t/1/scim/v2/Users?filter="+url.QueryEscape(`userName eq "newhire@acme1.test"`), token, ""))
	require.Equal(t, http.StatusOK, listed.Code)
	var list map[string]any
	require.NoError(t, json.Unmarshal(listed.Body.Bytes(), &list))
	assert.InDelta(t, 1, list["totalResults"], 0)

	patched := do(s, scimRequest(http.MethodPatch, "/t/1/scim/v2/Users/"+id, token,
		`{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[{"op":"Replace","value":{"active":false}}]}`))
	require.Equal(t, http.StatusOK, patched.Code, patched.Body.String())
	var afterPatch map[string]any
	require.NoError(t, json.Unmarshal(patched.Body.Bytes(), &afterPatch))
	assert.Equal(t, false, afterPatch["active"])
}

// @scenario "Groups can be managed over SCIM"
func TestSCIMGroups(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	token := tenant.SCIMToken

	created := do(s, scimRequest(http.MethodPost, "/t/1/scim/v2/Groups", token,
		`{"schemas":["urn:ietf:params:scim:schemas:core:2.0:Group"],"displayName":"Engineering","members":[{"value":"t1-user-admin"}]}`))
	require.Equal(t, http.StatusCreated, created.Code, created.Body.String())
	var group map[string]any
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &group))

	fetched := do(s, scimRequest(http.MethodGet, "/t/1/scim/v2/Groups/"+group["id"].(string), token, ""))
	require.Equal(t, http.StatusOK, fetched.Code)
	var got map[string]any
	require.NoError(t, json.Unmarshal(fetched.Body.Bytes(), &got))
	members := got["members"].([]any)
	require.Len(t, members, 1)
	assert.Equal(t, "t1-user-admin", members[0].(map[string]any)["value"])
}

// @scenario "A tenant's directory can be pushed at a SCIM service provider"
func TestSCIMPush(t *testing.T) {
	s := newTestServer(t, 1)
	var mu struct {
		paths  []string
		tokens []string
	}
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.paths = append(mu.paths, r.Method+" "+r.URL.Path)
		mu.tokens = append(mu.tokens, r.Header.Get("Authorization"))
		writeJSON(w, http.StatusCreated, map[string]any{"id": "target-" + randomToken()[:6]})
	}))
	defer target.Close()

	tenant, _ := s.Tenant(1)
	tenant.AddGroup(&Group{ID: "g1", Name: "Everyone", MemberIDs: []string{"t1-user-admin"}})

	req := httptest.NewRequest(http.MethodPost, testBase+"/control/t/1/scim-push",
		strings.NewReader(fmt.Sprintf(`{"target":%q,"token":"push-token"}`, target.URL+"/scim/v2")))
	rec := do(s, req)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var result map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &result))
	assert.InDelta(t, 2, result["usersCreated"], 0)
	assert.InDelta(t, 1, result["groupsCreated"], 0)

	require.Len(t, mu.paths, 3)
	assert.Equal(t, "POST /scim/v2/Users", mu.paths[0])
	assert.Equal(t, "POST /scim/v2/Groups", mu.paths[2])
	for _, tok := range mu.tokens {
		assert.Equal(t, "Bearer push-token", tok)
	}
}

// buildDNSQuery packs one question the way a stub resolver would.
func buildDNSQuery(t *testing.T, domain string, qtype uint16) []byte {
	t.Helper()
	name, err := dnsmessage.NewName(domain)
	require.NoError(t, err)
	msg := dnsmessage.Message{
		Header: dnsmessage.Header{ID: 42, RecursionDesired: true},
		Questions: []dnsmessage.Question{{
			Name: name, Type: dnsmessage.Type(qtype), Class: dnsmessage.ClassINET,
		}},
	}
	packed, err := msg.Pack()
	require.NoError(t, err)
	return packed
}

// parseDNSReply unpacks the reply into its response code and TXT strings.
func parseDNSReply(t *testing.T, reply []byte) (rcode int, txt []string) {
	t.Helper()
	var msg dnsmessage.Message
	require.NoError(t, msg.Unpack(reply))
	for i := range msg.Answers {
		if body, ok := msg.Answers[i].Body.(*dnsmessage.TXTResource); ok {
			txt = append(txt, body.TXT...)
		}
	}
	return int(msg.RCode), txt
}

// queryDNS sends one query to the simulator's DNS listener and returns the
// reply.
func queryDNS(t *testing.T, addr, domain string, qtype uint16) (rcode int, txt []string) {
	t.Helper()
	conn, err := net.Dial("udp", addr)
	require.NoError(t, err)
	defer func() { _ = conn.Close() }()
	query := buildDNSQuery(t, domain, qtype)
	_, err = conn.Write(query)
	require.NoError(t, err)
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(2*time.Second)))
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	require.NoError(t, err)
	return parseDNSReply(t, buf[:n])
}

// @scenario "A configured TXT record is served over DNS for verification"
func TestDNSTXTAnswer(t *testing.T) {
	s := newTestServer(t, 1)
	dns, err := startDNS(t.Context(), "127.0.0.1:0", s.verification, s.recordDNSLookup)
	require.NoError(t, err)

	s.verification.SetTXT("custom.example.com", []string{"langwatch-verification=abc123"})
	rcode, txt := queryDNS(t, dns.Addr(), "custom.example.com.", 16)
	assert.Equal(t, 0, rcode)
	assert.Contains(t, txt, "langwatch-verification=abc123")

	// Every tenant's own domain is pre-configured.
	rcode, txt = queryDNS(t, dns.Addr(), "acme1.test.", 16)
	assert.Equal(t, 0, rcode)
	require.NotEmpty(t, txt)
	assert.Contains(t, txt[0], "langwatch-domain-verification=")
}

// @scenario "An unconfigured domain gets a name error over DNS"
func TestDNSNameError(t *testing.T) {
	s := newTestServer(t, 1)
	dns, err := startDNS(t.Context(), "127.0.0.1:0", s.verification, s.recordDNSLookup)
	require.NoError(t, err)
	rcode, _ := queryDNS(t, dns.Addr(), "nobody-configured.example.", 16)
	assert.Equal(t, 3, rcode) // NXDOMAIN
}

// @scenario "A verification token is served over HTTP for non-DNS verification"
func TestWellKnownVerification(t *testing.T) {
	s := newTestServer(t, 1)
	s.verification.SetToken("verify-me.example.com", "token-xyz")

	byHost := httptest.NewRequest(http.MethodGet, "http://verify-me.example.com/.well-known/langwatch-verification.txt", nil)
	rec := do(s, byHost)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "token-xyz", rec.Body.String())

	byQuery := httptest.NewRequest(http.MethodGet, testBase+"/.well-known/langwatch-verification.txt?domain=verify-me.example.com", nil)
	rec = do(s, byQuery)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "token-xyz", rec.Body.String())

	missing := httptest.NewRequest(http.MethodGet, "http://unknown.example.com/.well-known/langwatch-verification.txt", nil)
	assert.Equal(t, http.StatusNotFound, do(s, missing).Code)
}

// @scenario "Tenants in the range are cryptographically isolated"
func TestTenantIsolation(t *testing.T) {
	s := newTestServer(t, 2)
	out := completeCodeFlow(t, s, nil, nil)
	require.Equal(t, http.StatusOK, out["_status"])

	_, err := jwt.Parse(out["id_token"].(string), jwksKeyfunc(t, s, 2), jwt.WithValidMethods([]string{"RS256"}))
	require.Error(t, err, "tenant 1's token must not verify against tenant 2's JWKS")

	one, _ := s.Tenant(1)
	two, _ := s.Tenant(2)
	assert.NotEqual(t, one.Key.N, two.Key.N)
}

// @scenario "The control API resets a tenant to its seeded state"
func TestControlReset(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)

	created := do(s, scimRequest(http.MethodPost, "/t/1/scim/v2/Users", tenant.SCIMToken,
		`{"userName":"extra@acme1.test"}`))
	require.Equal(t, http.StatusCreated, created.Code)
	require.Len(t, tenant.Users(), 3)

	rec := do(s, httptest.NewRequest(http.MethodPost, testBase+"/control/t/1/reset", strings.NewReader("{}")))
	require.Equal(t, http.StatusOK, rec.Code)
	users := tenant.Users()
	require.Len(t, users, 2)
	assert.Equal(t, "admin@acme1.test", users[0].Email)
}
