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
	req := parseAuthorizeRequest(r.URL.Query())
	if req.RedirectURI == "" {
		http.Error(w, "redirect_uri is required", http.StatusBadRequest)
		return
	}
	if s.refuseUnregisteredRedirect(w, t, req) {
		return
	}
	if req.ResponseType != "code" {
		s.record(t, Event{
			Kind: "oidc.authorize", Outcome: OutcomeRefused, Client: req.ClientID,
			Detail: "unsupported response_type " + req.ResponseType + " — this provider issues authorization codes",
		})
		oauthRedirectError(w, r, req.errorOf("unsupported_response_type"))
		return
	}
	if req.Hint == "" {
		s.serveAccountPicker(w, t, r.URL)
		return
	}
	user, ok := t.FindUser(req.Hint)
	if !ok || !user.Active {
		s.record(t, Event{
			Kind: "oidc.authorize", Outcome: OutcomeRefused, Client: req.ClientID,
			Subject: req.Hint, Detail: "no active user matches the login hint " + req.Hint,
		})
		oauthRedirectError(w, r, req.errorOf("access_denied"))
		return
	}
	code := t.MintCode(req.codeFor(user), s.now())
	s.record(t, Event{
		Kind: "oidc.authorize", Outcome: OutcomeOK, Client: req.ClientID, Subject: user.Email,
		Detail: "signed in as " + user.Email + ", sending an authorization code back to " + req.RedirectURI,
	})
	req.redirectWithCode(w, r, code)
}

// authorizeRequest is one parsed authorization request. Reading the query once
// into a value keeps the handler about the decisions rather than about
// url.Values lookups.
type authorizeRequest struct {
	ClientID     string
	RedirectURI  string
	ResponseType string
	State        string
	Nonce        string
	Scope        string
	// Hint is the login_hint (or its `user` alias): who to sign in as without
	// showing the picker.
	Hint            string
	Challenge       string
	ChallengeMethod string
}

func parseAuthorizeRequest(q url.Values) authorizeRequest {
	hint := q.Get("login_hint")
	if hint == "" {
		hint = q.Get("user")
	}
	return authorizeRequest{
		ClientID: q.Get("client_id"), RedirectURI: q.Get("redirect_uri"),
		ResponseType: q.Get("response_type"), State: q.Get("state"),
		Nonce: q.Get("nonce"), Scope: q.Get("scope"), Hint: hint,
		Challenge: q.Get("code_challenge"), ChallengeMethod: q.Get("code_challenge_method"),
	}
}

func (req authorizeRequest) errorOf(code string) authError {
	return authError{RedirectURI: req.RedirectURI, State: req.State, Code: code}
}

func (req authorizeRequest) codeFor(user *User) *authCode {
	return &authCode{
		UserID: user.ID, ClientID: req.ClientID, RedirectURI: req.RedirectURI,
		Nonce: req.Nonce, Scope: req.Scope,
		CodeChallenge: req.Challenge, ChallengeMeth: req.ChallengeMethod,
	}
}

// redirectWithCode sends the browser back to the client with the code.
func (req authorizeRequest) redirectWithCode(w http.ResponseWriter, r *http.Request, code string) {
	dest, err := url.Parse(req.RedirectURI)
	if err != nil {
		http.Error(w, "redirect_uri is not a valid URL", http.StatusBadRequest)
		return
	}
	q := dest.Query()
	q.Set("code", code)
	if req.State != "" {
		q.Set("state", req.State)
	}
	dest.RawQuery = q.Encode()
	http.Redirect(w, r, dest.String(), http.StatusFound)
}

// refuseUnregisteredRedirect stops a registered client being sent to an
// address it did not register, reporting whether it refused.
//
// The refusal is a page rather than a redirect on purpose: bouncing an error
// to an address the client never registered is the exact move a real identity
// provider must refuse, and someone who has just mistyped a redirect address
// learns far more from a page naming both than from a silent bounce.
func (s *Server) refuseUnregisteredRedirect(w http.ResponseWriter, t *Tenant, req authorizeRequest) bool {
	app, registered := t.ApplicationByClientID(req.ClientID)
	if !registered || app.redirectAllowed(req.RedirectURI) {
		return false
	}
	s.record(t, Event{
		Kind: "oidc.authorize", Outcome: OutcomeRefused, Client: req.ClientID,
		Detail: "redirect address " + req.RedirectURI + " is not registered for " + app.Name,
	})
	s.refusalPage(w, t, refusalNotice{
		Status: http.StatusBadRequest,
		Title:  "That redirect address is not registered",
		Detail: "The application " + app.Name + " asked to be sent back to " + req.RedirectURI +
			", which is not one of the addresses it registered.",
		Hint: "Register that address on the tenant page, or fix the redirect address in the " +
			"application's own configuration. A {placeholder} segment matches any single segment, " +
			"so the address LangWatch shows before a connection exists can be registered exactly as written.",
	})
	return true
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

// authError is one OAuth authorization-endpoint refusal, on its way back to
// the client's redirect address.
type authError struct{ RedirectURI, State, Code string }

// oauthRedirectError sends the OAuth error back to the client's redirect URI
// when it is parseable, per RFC 6749; otherwise it degrades to a plain 400.
func oauthRedirectError(w http.ResponseWriter, r *http.Request, e authError) {
	dest, err := url.Parse(e.RedirectURI)
	if err != nil {
		http.Error(w, e.Code, http.StatusBadRequest)
		return
	}
	q := dest.Query()
	q.Set("error", e.Code)
	if e.State != "" {
		q.Set("state", e.State)
	}
	dest.RawQuery = q.Encode()
	http.Redirect(w, r, dest.String(), http.StatusFound)
}

// handleToken implements the token endpoint: authorization_code exchange with
// single-use codes and PKCE enforcement.
//
// Client authentication depends on whether the client is registered. A
// registered application must present its secret — that is the whole point of
// registering, and a wrong secret is one of the two or three things that
// actually go wrong when wiring an IdP up, so it has to fail loudly. An
// unregistered client id is accepted with any secret, which keeps the
// zero-configuration path (point the app at a tenant, log in) working; the
// activity feed says which of the two happened, so it is never a mystery.
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
	req := parseTokenRequest(r)
	// Authenticate the client BEFORE redeeming: a code is single-use, so
	// burning one on a request that fails client authentication would turn a
	// wrong secret into a second, confusing "already used" failure on retry.
	if !s.clientAuthenticated(w, t, req) {
		return
	}
	code, ok := s.redeemForExchange(w, t, req)
	if !ok {
		return
	}
	user, ok := t.UserByID(code.UserID)
	if !ok {
		s.refuseToken(w, t, tokenRefusal{
			ClientID: req.ClientID, Code: "invalid_grant",
			Description: "the code's user no longer exists",
			Detail:      "the user the code was issued for no longer exists",
		})
		return
	}
	idToken, err := s.mintIDToken(t, user, audience{ClientID: req.ClientID, Nonce: code.Nonce})
	if err != nil {
		http.Error(w, "signing the ID token failed", http.StatusInternalServerError)
		return
	}
	s.record(t, Event{
		Kind:    "oidc.token",
		Outcome: OutcomeOK,
		Client:  req.ClientID,
		Subject: user.Email,
		Detail:  "exchanged the code for an ID token and an access token",
	})
	writeJSON(w, http.StatusOK, map[string]any{
		"access_token": t.MintAccessToken(user.ID, code.Scope, s.now()),
		"token_type":   "Bearer",
		"expires_in":   3600,
		"scope":        code.Scope,
		"id_token":     idToken,
	})
}

// tokenRequest is one parsed token-endpoint exchange.
type tokenRequest struct {
	ClientID     string
	ClientSecret string
	Code         string
	RedirectURI  string
	Verifier     string
}

func parseTokenRequest(r *http.Request) tokenRequest {
	id, secret := clientCredentials(r)
	return tokenRequest{
		ClientID: id, ClientSecret: secret,
		Code:        r.PostForm.Get("code"),
		RedirectURI: r.PostForm.Get("redirect_uri"),
		Verifier:    r.PostForm.Get("code_verifier"),
	}
}

// tokenRefusal is one refused exchange: what the client is told, and what the
// tenant's activity feed records about it.
type tokenRefusal struct {
	ClientID    string
	Code        string
	Description string
	Detail      string
}

// refuseToken answers the client and files the refusal in one step, so each
// check in the exchange stays about the thing it checks.
func (s *Server) refuseToken(w http.ResponseWriter, t *Tenant, ref tokenRefusal) {
	s.record(t, Event{
		Kind: "oidc.token", Outcome: OutcomeRefused,
		Client: ref.ClientID, Detail: ref.Detail,
	})
	oauthError(w, ref.Code, ref.Description)
}

// clientAuthenticated checks a registered client's secret, reporting whether
// the exchange may continue. An unregistered client id is accepted with any
// secret — the zero-setup path — and the feed says so either way.
func (s *Server) clientAuthenticated(w http.ResponseWriter, t *Tenant, req tokenRequest) bool {
	app, registered := t.ApplicationByClientID(req.ClientID)
	if !registered {
		return true
	}
	if subtle.ConstantTimeCompare([]byte(req.ClientSecret), []byte(app.Secret)) == 1 {
		return true
	}
	s.refuseToken(w, t, tokenRefusal{
		ClientID: req.ClientID, Code: "invalid_client",
		Description: "the client secret does not match the one registered for " + app.Name,
		Detail:      "wrong client secret for " + app.Name,
	})
	return false
}

// redeemForExchange consumes the authorization code and checks it belongs to
// this exchange: same client, same redirect address, matching PKCE verifier.
func (s *Server) redeemForExchange(w http.ResponseWriter, t *Tenant, req tokenRequest) (*authCode, bool) {
	code, ok := t.RedeemCode(req.Code, s.now())
	if !ok {
		s.refuseToken(w, t, tokenRefusal{
			ClientID: req.ClientID, Code: "invalid_grant",
			Description: "unknown, expired or already-used code",
			Detail:      "the authorization code was unknown, expired, or already exchanged",
		})
		return nil, false
	}
	if code.ClientID != "" && req.ClientID != code.ClientID {
		s.refuseToken(w, t, tokenRefusal{
			ClientID: req.ClientID, Code: "invalid_grant",
			Description: "code was issued to a different client",
			Detail:      "the code was issued to " + code.ClientID + ", not " + req.ClientID,
		})
		return nil, false
	}
	if req.RedirectURI != "" && req.RedirectURI != code.RedirectURI {
		s.refuseToken(w, t, tokenRefusal{
			ClientID: req.ClientID, Code: "invalid_grant",
			Description: "redirect_uri does not match the authorization request",
			Detail:      "redirect address " + req.RedirectURI + " does not match the one the code was issued for",
		})
		return nil, false
	}
	if !pkceSatisfied(code, req.Verifier) {
		s.refuseToken(w, t, tokenRefusal{
			ClientID: req.ClientID, Code: "invalid_grant",
			Description: "PKCE verification failed",
			Detail:      "PKCE verification failed — the code verifier does not match the challenge",
		})
		return nil, false
	}
	return code, true
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

// audience is who an ID token is being minted for.
type audience struct{ ClientID, Nonce string }

// mintIDToken signs the tenant's ID token with the standard claims the app's
// profile mapping reads (email, picture, and the name-fallback family).
func (s *Server) mintIDToken(t *Tenant, user *User, aud audience) (string, error) {
	clientID, nonce := aud.ClientID, aud.Nonce
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
	s.record(t, Event{
		Kind:    "oidc.userinfo",
		Outcome: OutcomeOK,
		Subject: user.Email,
		Detail:  "returned the profile claims for " + user.Email,
	})
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

// clientCredentials reads the client id and secret from wherever the client
// put them: HTTP basic (client_secret_basic) or the form body
// (client_secret_post). Both are advertised in discovery, and different
// libraries pick different ones.
func clientCredentials(r *http.Request) (id, secret string) {
	id, secret = r.PostForm.Get("client_id"), r.PostForm.Get("client_secret")
	basicID, basicSecret, ok := r.BasicAuth()
	if !ok {
		return id, secret
	}
	if id == "" {
		id = basicID
	}
	if secret == "" {
		secret = basicSecret
	}
	return id, secret
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
