package idpsim

import (
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type testJWKS struct {
	Keys []struct {
		Kid string `json:"kid"`
		N   string `json:"n"`
		E   string `json:"e"`
	} `json:"keys"`
}

func fetchJWKS(t *testing.T, s *Server) testJWKS {
	t.Helper()
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/oauth/jwks", nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var out testJWKS
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	return out
}

func (j testJWKS) kids() []string {
	out := []string{}
	for _, k := range j.Keys {
		out = append(out, k.Kid)
	}
	return out
}

// verifyAgainstJWKS checks a token the way a relying party does: find its kid in the JWKS, then verify.
func verifyAgainstJWKS(t *testing.T, s *Server, token string) error {
	t.Helper()
	jwks := fetchJWKS(t, s)
	_, err := jwt.Parse(token, func(tok *jwt.Token) (any, error) {
		for _, k := range jwks.Keys {
			if k.Kid != tok.Header["kid"] {
				continue
			}
			n, nErr := base64.RawURLEncoding.DecodeString(k.N)
			require.NoError(t, nErr)
			e, eErr := base64.RawURLEncoding.DecodeString(k.E)
			require.NoError(t, eErr)
			return &rsa.PublicKey{N: new(big.Int).SetBytes(n), E: int(new(big.Int).SetBytes(e).Int64())}, nil
		}
		return nil, errors.New("no key in the JWKS matches the token's kid")
	}, jwt.WithoutClaimsValidation())
	return err
}

func metadataBody(t *testing.T, s *Server) string {
	t.Helper()
	rec := do(s, httptest.NewRequest(http.MethodGet, testBase+"/t/1/saml/metadata", nil))
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	return stripWhitespace(rec.Body.String())
}

func mintTestToken(t *testing.T, s *Server) string {
	t.Helper()
	tenant, _ := s.Tenant(1)
	token, err := s.mintIDToken(tenant, tenant.Users()[0], audience{ClientID: "rp"})
	require.NoError(t, err)
	return token
}

func rotateKey(t *testing.T, s *Server, body string, status int) {
	t.Helper()
	rec := callControl(s, s.handleControlRotateKey, body)
	require.Equal(t, status, rec.Code, rec.Body.String())
}

// @scenario "Resetting a tenant clears its clock skew"
func TestResetClearsSkew(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/config", `{"skewSeconds":600}`).Code)
	_ = ssoResponse(t, s)
	require.NotEmpty(t, tenant.lastAssertion())

	require.Equal(t, http.StatusOK, postControl(t, s, "/control/t/1/reset", ``).Code)
	assert.Zero(t, tenant.Skew())
	assert.Empty(t, tenant.lastAssertion())
}

// @scenario "A tenant's clock skew survives a simulator restart"
func TestSkewSurvivesRestart(t *testing.T) {
	dir := t.TempDir()
	s := persistentServer(t, dir, 1)
	stateRequest(t, s, "POST", "/control/t/1/config", `{"skewSeconds":600}`, http.StatusOK)

	restarted := persistentServer(t, dir, 1)
	tenant, _ := restarted.Tenant(1)
	assert.Equal(t, 10*time.Minute, tenant.Skew())
}

// @scenario "After a key rotation both keys are published and the new one signs"
func TestRotationPublishesBothKeysAndSignsWithTheNewOne(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	oldCert := base64.StdEncoding.EncodeToString(tenant.Cert.Raw)
	rotateKey(t, s, ``, http.StatusOK)

	assert.Equal(t, []string{"t1-k2", "t1-k1"}, fetchJWKS(t, s).kids())
	md := metadataBody(t, s)
	assert.Equal(t, 2, strings.Count(md, `use="signing"`))
	assert.Contains(t, md, oldCert)
	assert.Contains(t, md, base64.StdEncoding.EncodeToString(tenant.Cert.Raw))

	token := mintTestToken(t, s)
	parsed, _, err := jwt.NewParser().ParseUnverified(token, jwt.MapClaims{})
	require.NoError(t, err)
	assert.Equal(t, "t1-k2", parsed.Header["kid"])
	require.NoError(t, verifyAgainstJWKS(t, s, token))
	sp := testSP(s)
	_, err = sp.ParseXMLResponse(ssoResponse(t, s), []string{"id-test-1"}, sp.AcsURL)
	require.NoError(t, err)
	assert.Contains(t, activityKinds(t, s), "fault.key")
}

// @scenario "After a key rotation both keys are published and the new one signs"
func TestRotatedKeysSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	s := persistentServer(t, dir, 1)
	tenant, _ := s.Tenant(1)
	require.NoError(t, tenant.RotateKey())
	require.NoError(t, s.saveState())
	before := fetchJWKS(t, s)

	restarted := persistentServer(t, dir, 1)
	assert.Equal(t, before, fetchJWKS(t, restarted))
	assert.Equal(t, []string{"t1-k2", "t1-k1"}, fetchJWKS(t, restarted).kids())
}

// @scenario "After the previous key is dropped only the new one is published"
func TestDropPreviousKeyPublishesOnlyTheNewOne(t *testing.T) {
	s := newTestServer(t, 1)
	tenant, _ := s.Tenant(1)
	oldCert := base64.StdEncoding.EncodeToString(tenant.Cert.Raw)
	rotateKey(t, s, ``, http.StatusOK)
	rotateKey(t, s, `{"dropPrevious":true}`, http.StatusOK)

	assert.Equal(t, []string{"t1-k2"}, fetchJWKS(t, s).kids())
	md := metadataBody(t, s)
	assert.Equal(t, 1, strings.Count(md, `use="signing"`))
	assert.NotContains(t, md, oldCert)
	rotateKey(t, s, `{"dropPrevious":true}`, http.StatusConflict)
}

// @scenario "A token signed by a dropped key no longer verifies"
func TestTokenSignedByDroppedKeyNoLongerVerifies(t *testing.T) {
	s := newTestServer(t, 1)
	old := mintTestToken(t, s)
	require.NoError(t, verifyAgainstJWKS(t, s, old))
	rotateKey(t, s, ``, http.StatusOK)
	require.NoError(t, verifyAgainstJWKS(t, s, old), "the previous key still verifies until dropped")
	rotateKey(t, s, `{"dropPrevious":true}`, http.StatusOK)

	require.Error(t, verifyAgainstJWKS(t, s, old))
	rotateKey(t, s, `{`, http.StatusBadRequest)
}
