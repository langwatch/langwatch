package idpsim

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Social sign-in: each tenant also plays Google, GitHub, GitLab and Microsoft
// under /t/<n>/social/<provider>, in each provider's own path layout and
// response shapes, signing in as the tenant's users. GitLab and Microsoft
// paths are what Better Auth builds from its `issuer` and `authority` options.

// socialProviderNames are the providers a tenant plays, in the order the
// console lists them.
var socialProviderNames = []string{"google", "github", "gitlab", "microsoft"}

// socialBase is where a provider's endpoints live for this tenant.
func (t *Tenant) socialBase(provider string) string {
	return t.BaseURL + "/social/" + provider
}

// socialAuthorizePath is the provider's authorization endpoint, as a path.
func (t *Tenant) socialAuthorizePath(provider string) (string, bool) {
	base := "/t/" + strconv.Itoa(t.ID) + "/social/" + provider
	switch provider {
	case "google":
		return base + "/o/oauth2/v2/auth", true
	case "github":
		return base + "/login/oauth/authorize", true
	case "gitlab":
		return base + "/oauth/authorize", true
	case "microsoft":
		return base + "/" + t.AzureTenantID() + "/oauth2/v2.0/authorize", true
	}
	return "", false
}

func (s *Server) routeSocial(mux *http.ServeMux) {
	const google = "/t/{tenant}/social/google"
	mux.HandleFunc("GET "+google+"/.well-known/openid-configuration", s.handleGoogleDiscovery)
	mux.HandleFunc("GET "+google+"/o/oauth2/v2/auth", s.socialAuthorize("google"))
	mux.HandleFunc("POST "+google+"/token", s.socialToken("google"))
	mux.HandleFunc("GET "+google+"/oauth2/v3/userinfo", s.socialProfile("google"))
	mux.HandleFunc("GET "+google+"/oauth2/v3/certs", s.handleJWKS)

	const github = "/t/{tenant}/social/github"
	mux.HandleFunc("GET "+github+"/login/oauth/authorize", s.socialAuthorize("github"))
	mux.HandleFunc("POST "+github+"/login/oauth/access_token", s.socialToken("github"))
	mux.HandleFunc("GET "+github+"/user", s.socialProfile("github"))
	mux.HandleFunc("GET "+github+"/user/emails", s.socialProfile("github.emails"))

	const gitlab = "/t/{tenant}/social/gitlab"
	mux.HandleFunc("GET "+gitlab+"/oauth/authorize", s.socialAuthorize("gitlab"))
	mux.HandleFunc("POST "+gitlab+"/oauth/token", s.socialToken("gitlab"))
	mux.HandleFunc("GET "+gitlab+"/api/v4/user", s.socialProfile("gitlab"))

	// {directory} is the Entra tenant segment: the tenant's GUID, or common.
	const microsoft = "/t/{tenant}/social/microsoft/{directory}"
	mux.HandleFunc("GET "+microsoft+"/oauth2/v2.0/authorize", s.socialAuthorize("microsoft"))
	mux.HandleFunc("POST "+microsoft+"/oauth2/v2.0/token", s.socialToken("microsoft"))
	mux.HandleFunc("GET "+microsoft+"/discovery/v2.0/keys", s.handleJWKS)
}

func (s *Server) socialAuthorize(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t, ok := s.tenantFor(r)
		if !ok {
			http.NotFound(w, r)
			return
		}
		s.authorize(w, r, t, "social."+provider+".authorize")
	}
}

func (s *Server) socialToken(provider string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t, ok := s.tenantFor(r)
		if !ok {
			http.NotFound(w, r)
			return
		}
		user, code, req, ok := s.exchange(w, r, t, "social."+provider+".token")
		if !ok {
			return
		}
		body := map[string]any{
			"access_token": t.MintAccessToken(user.ID, code.Scope, s.now()),
			"token_type":   "Bearer",
			"expires_in":   3600,
			"scope":        code.Scope,
		}
		if provider == "google" || provider == "microsoft" {
			idToken, err := t.sign(t.socialIDClaims(provider, user, audience{ClientID: req.ClientID, Nonce: code.Nonce}, s.now()))
			if err != nil {
				http.Error(w, "signing the ID token failed", http.StatusInternalServerError)
				return
			}
			body["id_token"] = idToken
		}
		s.record(t, Event{
			Kind: "social." + provider + ".token", Outcome: OutcomeOK, Client: req.ClientID, Subject: user.Email,
			Detail: "exchanged the code for a " + provider + " access token",
		})
		if provider == "github" {
			// GitHub answers a form unless the client asks for JSON.
			body["token_type"] = "bearer"
			delete(body, "expires_in")
			if !strings.Contains(r.Header.Get("Accept"), "json") {
				form := url.Values{}
				for k, v := range body {
					form.Set(k, fmt.Sprint(v))
				}
				w.Header().Set("Content-Type", "application/x-www-form-urlencoded")
				_, _ = w.Write([]byte(form.Encode()))
				return
			}
		}
		writeJSON(w, http.StatusOK, body)
	}
}

// socialProfile serves a provider's profile read: "github.emails" is GitHub's
// separate addresses call.
func (s *Server) socialProfile(read string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		t, ok := s.tenantFor(r)
		if !ok {
			http.NotFound(w, r)
			return
		}
		user, ok := bearerUser(w, r, t, s.now())
		if !ok {
			return
		}
		kind := "social." + read
		if !strings.Contains(read, ".") {
			kind += ".userinfo"
		}
		s.record(t, Event{
			Kind: kind, Outcome: OutcomeOK, Subject: user.Email,
			Detail: "returned the " + read + " profile for " + user.Email,
		})
		writeJSON(w, http.StatusOK, t.socialProfileOf(read, user))
	}
}

// socialProfileOf is the body a provider's profile endpoint answers with.
func (t *Tenant) socialProfileOf(read string, u *User) any {
	avatar := fmt.Sprintf("%s/avatar/%s.png", t.BaseURL, u.ID)
	switch read {
	case "github":
		return map[string]any{
			"id": t.socialNumber("github", u), "login": u.UserName, "name": u.DisplayName(),
			"email": u.Email, "avatar_url": avatar, "type": "User",
			"html_url": t.socialBase("github") + "/" + u.UserName,
		}
	case "github.emails":
		return []map[string]any{{"email": u.Email, "primary": true, "verified": true, "visibility": "public"}}
	case "gitlab":
		return map[string]any{
			"id": t.socialNumber("gitlab", u), "username": u.UserName, "name": u.DisplayName(),
			"email": u.Email, "avatar_url": avatar, "state": "active",
			"web_url": t.socialBase("gitlab") + "/" + u.UserName,
		}
	}
	return map[string]any{
		"sub": t.googleSubject(u), "email": u.Email, "email_verified": true, "name": u.DisplayName(),
		"given_name": u.GivenName, "family_name": u.FamilyName, "picture": avatar,
	}
}

// socialIDClaims are the ID token claims Google or Microsoft (Entra v2.0) issue.
func (t *Tenant) socialIDClaims(provider string, u *User, aud audience, now time.Time) jwt.MapClaims {
	claims := jwt.MapClaims{
		"aud": aud.ClientID, "iat": now.Unix(), "exp": now.Add(time.Hour).Unix(),
		"email": u.Email, "name": u.DisplayName(),
	}
	if aud.Nonce != "" {
		claims["nonce"] = aud.Nonce
	}
	if provider == "microsoft" {
		claims["iss"] = t.socialBase("microsoft") + "/" + t.AzureTenantID() + "/v2.0"
		claims["sub"] = azureSubject(sha256.Sum256(fmt.Appendf(nil, "idpsim-social-microsoft/t%d/%s", t.ID, u.ID)))
		claims["oid"] = t.azureObjectID(u)
		claims["tid"] = t.AzureTenantID()
		claims["ver"] = "2.0"
		claims["preferred_username"] = u.Email
		claims["nbf"] = now.Unix()
		return claims
	}
	claims["iss"] = t.socialBase("google")
	claims["sub"] = t.googleSubject(u)
	claims["email_verified"] = true
	claims["given_name"] = u.GivenName
	claims["family_name"] = u.FamilyName
	claims["picture"] = fmt.Sprintf("%s/avatar/%s.png", t.BaseURL, u.ID)
	return claims
}

// socialNumber is a stable numeric account id, below 2^53 so JavaScript keeps it exact.
func (t *Tenant) socialNumber(provider string, u *User) uint64 {
	h := sha256.Sum256(fmt.Appendf(nil, "idpsim-social-%s/t%d/%s", provider, t.ID, u.ID))
	return binary.BigEndian.Uint64(h[:8])%9_000_000_000_000 + 1
}

// googleSubject is the 21-digit sub a Google account carries.
func (t *Tenant) googleSubject(u *User) string {
	return fmt.Sprintf("10%019d", t.socialNumber("google", u))
}

// handleGoogleDiscovery is the Google-shaped discovery document, for a client
// configured from discovery rather than Google's hard-wired addresses.
func (s *Server) handleGoogleDiscovery(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	base := t.socialBase("google")
	doc := discoveryDocument(t)
	doc["issuer"] = base
	doc["authorization_endpoint"] = base + "/o/oauth2/v2/auth"
	doc["token_endpoint"] = base + "/token"
	doc["userinfo_endpoint"] = base + "/oauth2/v3/userinfo"
	doc["jwks_uri"] = base + "/oauth2/v3/certs"
	doc["claims_supported"] = []string{"sub", "email", "email_verified", "name", "given_name", "family_name", "picture"}
	writeJSON(w, http.StatusOK, doc)
}
