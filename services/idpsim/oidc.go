package idpsim

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html/template"
	"math/big"
	"net/http"
	"net/url"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// discoveryDocument is the OpenID Provider Metadata each tenant publishes.
// The app's generic OIDC provider reads exactly this shape from
// <issuer>/.well-known/openid-configuration.
func (s *Server) handleDiscovery(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"issuer":                                t.BaseURL,
		"authorization_endpoint":                t.BaseURL + "/oauth/authorize",
		"token_endpoint":                        t.BaseURL + "/oauth/token",
		"userinfo_endpoint":                     t.BaseURL + "/oauth/userinfo",
		"jwks_uri":                              t.BaseURL + "/oauth/jwks",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": []string{"RS256"},
		"scopes_supported":                      []string{"openid", "email", "profile"},
		"token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post", "none"},
		"code_challenge_methods_supported":      []string{"S256", "plain"},
		"claims_supported": []string{
			"sub", "email", "email_verified", "name", "given_name", "family_name",
			"nickname", "preferred_username", "picture", "groups",
		},
	})
}

// handleJWKS publishes the tenant's signing key.
func (s *Server) handleJWKS(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"keys": []map[string]any{{
			"kty": "RSA",
			"use": "sig",
			"alg": "RS256",
			"kid": t.KeyID(),
			"n":   base64.RawURLEncoding.EncodeToString(t.Key.N.Bytes()),
			"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(t.Key.E)).Bytes()),
		}},
	})
}

// pickerTemplate is the account picker served when authorize gets no login
// hint: each user links back into the same authorize request with the hint
// filled in, so a browser test is two clicks and an automated test is one
// query parameter.
var pickerTemplate = template.Must(template.New("picker").Parse(`<!doctype html>
<title>idpsim tenant {{.TenantID}} — choose an account</title>
<style>body{font-family:system-ui;margin:3rem auto;max-width:28rem}a{display:block;padding:.75rem 1rem;border:1px solid #ccc;border-radius:.5rem;margin:.5rem 0;text-decoration:none;color:inherit}</style>
<h1>Choose an account</h1>
<p>Simulated identity provider — tenant {{.TenantID}}</p>
{{range .Users}}<a href="{{.URL}}"><strong>{{.Name}}</strong><br>{{.Email}}</a>{{end}}
`))

// handleAuthorize implements the authorization endpoint. With a login hint
// (login_hint or user) it redirects back immediately with a code — no browser
// needed; without one it serves the account picker.
func (s *Server) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	q := r.URL.Query()
	redirectURI := q.Get("redirect_uri")
	if redirectURI == "" {
		http.Error(w, "redirect_uri is required", http.StatusBadRequest)
		return
	}
	if rt := q.Get("response_type"); rt != "code" {
		oauthRedirectError(w, r, redirectURI, q.Get("state"), "unsupported_response_type")
		return
	}
	hint := q.Get("login_hint")
	if hint == "" {
		hint = q.Get("user")
	}
	if hint == "" {
		s.serveAccountPicker(w, t, r.URL)
		return
	}
	user, ok := t.FindUser(hint)
	if !ok || !user.Active {
		oauthRedirectError(w, r, redirectURI, q.Get("state"), "access_denied")
		return
	}
	code := t.MintCode(&authCode{
		UserID:        user.ID,
		ClientID:      q.Get("client_id"),
		RedirectURI:   redirectURI,
		Nonce:         q.Get("nonce"),
		Scope:         q.Get("scope"),
		CodeChallenge: q.Get("code_challenge"),
		ChallengeMeth: q.Get("code_challenge_method"),
	}, s.now())
	dest, err := url.Parse(redirectURI)
	if err != nil {
		http.Error(w, "redirect_uri is not a valid URL", http.StatusBadRequest)
		return
	}
	dq := dest.Query()
	dq.Set("code", code)
	if state := q.Get("state"); state != "" {
		dq.Set("state", state)
	}
	dest.RawQuery = dq.Encode()
	http.Redirect(w, r, dest.String(), http.StatusFound)
}

func (s *Server) serveAccountPicker(w http.ResponseWriter, t *Tenant, authorizeURL *url.URL) {
	type row struct{ Name, Email, URL string }
	var rows []row
	for _, u := range t.Users() {
		if !u.Active {
			continue
		}
		link := *authorizeURL
		lq := link.Query()
		lq.Set("login_hint", u.ID)
		link.RawQuery = lq.Encode()
		rows = append(rows, row{Name: u.DisplayName(), Email: u.Email, URL: link.String()})
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = pickerTemplate.Execute(w, map[string]any{"TenantID": t.ID, "Users": rows})
}

// oauthRedirectError sends the OAuth error back to the client's redirect URI
// when it is parseable, per RFC 6749; otherwise it degrades to a plain 400.
func oauthRedirectError(w http.ResponseWriter, r *http.Request, redirectURI, state, code string) {
	dest, err := url.Parse(redirectURI)
	if err != nil {
		http.Error(w, code, http.StatusBadRequest)
		return
	}
	q := dest.Query()
	q.Set("error", code)
	if state != "" {
		q.Set("state", state)
	}
	dest.RawQuery = q.Encode()
	http.Redirect(w, r, dest.String(), http.StatusFound)
}

// handleToken implements the token endpoint: authorization_code exchange with
// single-use codes and PKCE enforcement. Client authentication is deliberately
// lax — any client_id/secret pair is accepted, because the simulator's job is
// to hand out predictable identities, not to defend them — but the client_id
// must match the one the code was minted for, so a mis-wired configuration
// still fails visibly.
func (s *Server) handleToken(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := r.ParseForm(); err != nil {
		oauthError(w, "invalid_request", "unparseable form body")
		return
	}
	if grant := r.PostForm.Get("grant_type"); grant != "authorization_code" {
		oauthError(w, "unsupported_grant_type", "only authorization_code is supported")
		return
	}
	code, ok := t.RedeemCode(r.PostForm.Get("code"), s.now())
	if !ok {
		oauthError(w, "invalid_grant", "unknown, expired or already-used code")
		return
	}
	clientID := r.PostForm.Get("client_id")
	if basicID, _, ok := r.BasicAuth(); ok && clientID == "" {
		clientID = basicID
	}
	if code.ClientID != "" && clientID != code.ClientID {
		oauthError(w, "invalid_grant", "code was issued to a different client")
		return
	}
	if uri := r.PostForm.Get("redirect_uri"); uri != "" && uri != code.RedirectURI {
		oauthError(w, "invalid_grant", "redirect_uri does not match the authorization request")
		return
	}
	if !pkceSatisfied(code, r.PostForm.Get("code_verifier")) {
		oauthError(w, "invalid_grant", "PKCE verification failed")
		return
	}
	user, ok := t.UserByID(code.UserID)
	if !ok {
		oauthError(w, "invalid_grant", "the code's user no longer exists")
		return
	}
	idToken, err := s.mintIDToken(t, user, clientID, code.Nonce)
	if err != nil {
		http.Error(w, "signing the ID token failed", http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": t.MintAccessToken(user.ID, code.Scope, s.now()),
		"token_type":   "Bearer",
		"expires_in":   3600,
		"scope":        code.Scope,
		"id_token":     idToken,
	})
}

// pkceSatisfied enforces RFC 7636: a code minted with a challenge is only
// redeemable with the matching verifier.
func pkceSatisfied(code *authCode, verifier string) bool {
	if code.CodeChallenge == "" {
		return true
	}
	if verifier == "" {
		return false
	}
	switch code.ChallengeMeth {
	case "S256":
		sum := sha256.Sum256([]byte(verifier))
		derived := base64.RawURLEncoding.EncodeToString(sum[:])
		return subtle.ConstantTimeCompare([]byte(derived), []byte(code.CodeChallenge)) == 1
	default: // "plain" or unspecified
		return subtle.ConstantTimeCompare([]byte(verifier), []byte(code.CodeChallenge)) == 1
	}
}

// mintIDToken signs the tenant's ID token with the standard claims the app's
// profile mapping reads (email, picture, and the name-fallback family).
func (s *Server) mintIDToken(t *Tenant, user *User, clientID, nonce string) (string, error) {
	now := s.now()
	claims := jwt.MapClaims{
		"iss":                t.BaseURL,
		"sub":                t.Subject(user),
		"aud":                clientID,
		"iat":                now.Unix(),
		"exp":                now.Add(time.Hour).Unix(),
		"email":              user.Email,
		"email_verified":     true,
		"name":               user.DisplayName(),
		"given_name":         user.GivenName,
		"family_name":        user.FamilyName,
		"nickname":           user.UserName,
		"preferred_username": user.UserName,
		"picture":            fmt.Sprintf("%s/avatar/%s.png", t.BaseURL, user.ID),
		"groups":             user.Groups,
	}
	if nonce != "" {
		claims["nonce"] = nonce
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	token.Header["kid"] = t.KeyID()
	return token.SignedString(t.Key)
}

// handleUserinfo returns the claims for a bearer access token.
func (s *Server) handleUserinfo(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	token, ok := bearerToken(r)
	if !ok {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "a bearer access token is required", http.StatusUnauthorized)
		return
	}
	grant, ok := t.GrantForToken(token, s.now())
	if !ok {
		http.Error(w, "unknown or expired access token", http.StatusUnauthorized)
		return
	}
	user, ok := t.UserByID(grant.UserID)
	if !ok {
		http.Error(w, "the token's user no longer exists", http.StatusUnauthorized)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"sub":                t.Subject(user),
		"email":              user.Email,
		"email_verified":     true,
		"name":               user.DisplayName(),
		"given_name":         user.GivenName,
		"family_name":        user.FamilyName,
		"nickname":           user.UserName,
		"preferred_username": user.UserName,
		"picture":            fmt.Sprintf("%s/avatar/%s.png", t.BaseURL, user.ID),
		"groups":             user.Groups,
	})
}

// oauthError is the RFC 6749 token-endpoint error shape.
func oauthError(w http.ResponseWriter, code, description string) {
	writeJSON(w, http.StatusBadRequest, map[string]string{
		"error":             code,
		"error_description": description,
	})
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	h := r.Header.Get("Authorization")
	if len(h) <= len(prefix) || h[:len(prefix)] != prefix {
		return "", false
	}
	return h[len(prefix):], true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
