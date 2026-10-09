package idpsim

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// LegacyProvider is the legacy provider a tenant impersonates for the product's
// deployment-wide AUTH_PROVIDER: issuer shape, subject format and claims.
type LegacyProvider string

// The legacy providers a tenant can impersonate; generic is plain OIDC.
const (
	LegacyProviderGeneric  LegacyProvider = "generic"
	LegacyProviderAuth0    LegacyProvider = "auth0"
	LegacyProviderOkta     LegacyProvider = "okta"
	LegacyProviderCognito  LegacyProvider = "cognito"
	LegacyProviderOneLogin LegacyProvider = "onelogin"
)

// providerEnvPrefix names each provider's env block in packages/config deployment-facts.
var providerEnvPrefix = map[LegacyProvider]string{
	LegacyProviderAuth0: "AUTH0", LegacyProviderOkta: "OKTA", LegacyProviderCognito: "COGNITO", LegacyProviderOneLogin: "ONELOGIN",
}

// TamperMode breaks the next ID token a tenant mints, once, so the product's
// rejection paths can be exercised.
type TamperMode string

// The one-shot ways to break the next ID token.
const (
	TamperNone          TamperMode = ""
	TamperBadSignature  TamperMode = "bad-signature"
	TamperWrongAudience TamperMode = "wrong-audience"
	TamperExpired       TamperMode = "expired"
	TamperReplayedNonce TamperMode = "replayed-nonce"
)

// wrongAudience is the aud a wrong-audience token carries.
const wrongAudience = "idpsim-wrong-audience"

func parseTamper(s string) (TamperMode, bool) {
	switch m := TamperMode(s); m {
	case TamperNone, TamperBadSignature, TamperWrongAudience, TamperExpired, TamperReplayedNonce:
		return m, true
	case "none":
		return TamperNone, true
	}
	return "", false
}

// LegacyProvider reports the provider the tenant impersonates; generic by default.
func (t *Tenant) LegacyProvider() LegacyProvider {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.legacyProvider == "" {
		return LegacyProviderGeneric
	}
	return t.legacyProvider
}

// SetLegacyProvider switches the tenant's legacy provider provider.
func (t *Tenant) SetLegacyProvider(f LegacyProvider) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.legacyProvider = f
}

// ArmTamper breaks the next minted ID token in the given way.
func (t *Tenant) ArmTamper(m TamperMode) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.tamper = m
}

// takeTamper disarms and returns the armed mode, with the nonce of the token
// minted before this one, and remembers this token's nonce for the next.
func (t *Tenant) takeTamper(nonce string) (TamperMode, string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	mode, previous := t.tamper, t.lastNonce
	t.tamper = TamperNone
	if nonce != "" {
		t.lastNonce = nonce
	}
	return mode, previous
}

// root is the simulator's external base, without the tenant path.
func (t *Tenant) root() string {
	return strings.TrimSuffix(t.BaseURL, fmt.Sprintf("/t/%d", t.ID))
}

// Issuer is the tenant's OIDC issuer in its provider's shape. Auth0 is served
// from the host root because the product keeps only the issuer's host.
func (t *Tenant) Issuer() string {
	switch t.LegacyProvider() {
	case LegacyProviderAuth0:
		return t.root() + "/"
	case LegacyProviderOkta:
		return t.BaseURL + "/oauth2/default"
	case LegacyProviderCognito:
		return fmt.Sprintf("%s/eu-west-1_idpsimT%d", t.BaseURL, t.ID)
	case LegacyProviderOneLogin:
		return t.BaseURL + "/oidc/2"
	case LegacyProviderGeneric:
	}
	return t.BaseURL
}

// DiscoveryURL is where the product reads the tenant's discovery document.
func (t *Tenant) DiscoveryURL() string {
	return strings.TrimSuffix(t.Issuer(), "/") + "/.well-known/openid-configuration"
}

// OIDCSubject is the user's sub in the provider's id format, stable per tenant.
// Auth0-broker samlp| subjects win whatever the provider.
func (t *Tenant) OIDCSubject(u *User) string {
	if t.SamlpSubjects() {
		return t.Subject(u)
	}
	h := sha256.Sum256(fmt.Appendf(nil, "t%d/%s", t.ID, u.ID))
	switch t.LegacyProvider() {
	case LegacyProviderAuth0:
		return "auth0|" + hex.EncodeToString(h[:12])
	case LegacyProviderOkta:
		const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
		id := make([]byte, 17)
		for i := range id {
			id[i] = alphabet[int(h[i])%len(alphabet)]
		}
		return "00u" + string(id)
	case LegacyProviderCognito:
		b := h[:16]
		b[6] = b[6]&0x0f | 0x40
		b[8] = b[8]&0x3f | 0x80
		return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
	case LegacyProviderOneLogin:
		return strconv.FormatUint(uint64(binary.BigEndian.Uint32(h[:4])%900000000+100000000), 10)
	case LegacyProviderGeneric:
	}
	return t.Subject(u)
}

// profileClaims are the user claims an ID token and userinfo share, shaped
// the way the provider's provider sends them.
func (t *Tenant) profileClaims(u *User, now time.Time) jwt.MapClaims {
	claims := jwt.MapClaims{
		"sub":                t.OIDCSubject(u),
		"email":              u.Email,
		"email_verified":     true,
		"name":               u.DisplayName(),
		"given_name":         u.GivenName,
		"family_name":        u.FamilyName,
		"nickname":           u.UserName,
		"preferred_username": u.UserName,
		"picture":            fmt.Sprintf("%s/avatar/%s.png", t.BaseURL, u.ID),
		"groups":             u.Groups,
	}
	switch t.LegacyProvider() {
	case LegacyProviderAuth0:
		claims["updated_at"] = now.UTC().Format(time.RFC3339)
	case LegacyProviderOkta:
		claims["ver"] = 1
		claims["auth_time"] = now.Unix()
		claims["amr"] = []string{"pwd"}
		claims["preferred_username"] = u.Email
	case LegacyProviderCognito:
		for _, k := range []string{"groups", "nickname", "preferred_username", "picture"} {
			delete(claims, k)
		}
		claims["cognito:username"] = u.UserName
		claims["cognito:groups"] = u.Groups
		claims["token_use"] = "id"
		claims["auth_time"] = now.Unix()
	case LegacyProviderOneLogin:
		claims["preferred_username"] = u.Email
	case LegacyProviderGeneric:
	}
	return claims
}

// tokenBreak is one armed tamper and what applying it needs.
type tokenBreak struct {
	Mode          TamperMode
	PreviousNonce string
	Now           time.Time
}

// breakClaims applies a claim-level tamper; bad-signature happens after signing.
func breakClaims(claims jwt.MapClaims, b tokenBreak) {
	switch b.Mode {
	case TamperWrongAudience:
		claims["aud"] = wrongAudience
	case TamperExpired:
		claims["iat"] = b.Now.Add(-2 * time.Hour).Unix()
		claims["exp"] = b.Now.Add(-time.Hour).Unix()
	case TamperReplayedNonce:
		nonce := b.PreviousNonce
		if nonce == "" || nonce == claims["nonce"] {
			nonce = "idpsim-replayed-nonce"
		}
		claims["nonce"] = nonce
	case TamperNone, TamperBadSignature:
	}
}

// corruptSignature flips the first signature byte: still a well-formed JWT,
// but it no longer verifies against the tenant's published key.
func corruptSignature(token string) string {
	dot := strings.LastIndexByte(token, '.')
	sig, err := base64.RawURLEncoding.DecodeString(token[dot+1:])
	if err != nil || len(sig) == 0 {
		return token[:dot+1] + "AAAA"
	}
	sig[0] ^= 0xff
	return token[:dot+1] + base64.RawURLEncoding.EncodeToString(sig)
}

// handleLegacyDiscovery serves a provider-shaped tenant's discovery under its issuer path.
func (s *Server) handleLegacyDiscovery(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok || discoveryPath(t) != r.URL.Path {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, discoveryDocument(t))
}

// handleAuth0RootDiscovery serves the lowest auth0-provider-shaped tenant at the host
// root, the only place the product's Auth0 provider looks.
func (s *Server) handleAuth0RootDiscovery(w http.ResponseWriter, r *http.Request) {
	for _, t := range s.tenants {
		if t.LegacyProvider() == LegacyProviderAuth0 {
			writeJSON(w, http.StatusOK, discoveryDocument(t))
			return
		}
	}
	http.NotFound(w, r)
}

func discoveryPath(t *Tenant) string {
	u, err := url.Parse(t.DiscoveryURL())
	if err != nil {
		return ""
	}
	return u.Path
}

// handleControlLegacyProvider sets (body {"provider": "okta"}) or reads (body {}) the provider.
func (s *Server) handleControlLegacyProvider(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var body struct {
		LegacyProvider *string `json:"provider"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "unparseable provider body", http.StatusBadRequest)
		return
	}
	if body.LegacyProvider != nil {
		f := LegacyProvider(*body.LegacyProvider)
		if _, known := providerEnvPrefix[f]; !known && f != LegacyProviderGeneric {
			http.Error(w, "provider must be one of generic, auth0, okta, cognito, onelogin", http.StatusBadRequest)
			return
		}
		t.SetLegacyProvider(f)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"provider": t.LegacyProvider(), "issuer": t.Issuer(), "discovery": t.DiscoveryURL(),
	})
}

// handleControlTamper arms a one-shot break of the next ID token (body {"mode": "expired"}).
func (s *Server) handleControlTamper(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "unparseable tamper body", http.StatusBadRequest)
		return
	}
	mode, known := parseTamper(body.Mode)
	if !known {
		http.Error(w, "mode must be one of none, bad-signature, wrong-audience, expired, replayed-nonce", http.StatusBadRequest)
		return
	}
	t.ArmTamper(mode)
	writeJSON(w, http.StatusOK, map[string]any{"armed": mode})
}

// handleControlLegacyEnv prints the env lines that point a stack's legacy
// provider at this tenant. The client is unregistered, so any secret passes.
func (s *Server) handleControlLegacyEnv(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	f := t.LegacyProvider()
	prefix, known := providerEnvPrefix[f]
	if !known {
		http.Error(w, "the tenant is generic: set a provider first (POST /control/t/{tenant}/legacy-provider)", http.StatusConflict)
		return
	}
	clientID := "langwatch-legacy-" + string(f)
	secret := "idpsim-accepts-any-secret-for-an-unregistered-client"
	if _, registered := t.ApplicationByClientID(clientID); registered {
		secret = "<the secret registered for " + clientID + " on the tenant page>"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "# idpsim tenant %d as a legacy %s provider; apply with haven down, then haven up\n", t.ID, f)
	if f == LegacyProviderAuth0 {
		b.WriteString("# auth0 keeps only the issuer host and forces https: serve idpsim over https at that host\n")
	}
	fmt.Fprintf(&b, "AUTH_PROVIDER=%s\n%s_CLIENT_ID=%s\n%s_CLIENT_SECRET=%s\n%s_ISSUER=%s\n",
		f, prefix, clientID, prefix, secret, prefix, t.Issuer())
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = w.Write([]byte(b.String()))
}
