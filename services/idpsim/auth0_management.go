package idpsim

import (
	"encoding/json"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// The Auth0 calls a deployment makes to change somebody's password (the
// product's http.auth0-password.channel.ts), served at the host root beside the
// root discovery document: a resource-owner password grant to check the
// current password, a client_credentials grant for a Management API token, and
// PATCH /api/v2/users/{id}. Every user's password starts as
// Auth0DefaultPassword; a PATCH changes it until the tenant is reset.

// Auth0DefaultPassword is every simulated Auth0 user's password until changed.
const Auth0DefaultPassword = "idpsim-password"

// auth0UpdateUsersScope is the Management API scope a password change needs.
const auth0UpdateUsersScope = "update:users"

// auth0MinPasswordLength stands in for the tenant's password policy.
const auth0MinPasswordLength = 8

// auth0ManagementGrant marks an access token the client_credentials grant minted.
const auth0ManagementGrant = "auth0-management"

// Auth0Password is the user's current simulated Auth0 password.
func (t *Tenant) Auth0Password(userID string) string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if pw, ok := t.auth0Passwords[userID]; ok {
		return pw
	}
	return Auth0DefaultPassword
}

func (t *Tenant) setAuth0Password(userID, password string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.auth0Passwords == nil {
		t.auth0Passwords = map[string]string{}
	}
	t.auth0Passwords[userID] = password
}

// Auth0ManagementScopes is what a Management API token is granted; unset is update:users.
func (t *Tenant) Auth0ManagementScopes() []string {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.auth0Scopes == nil {
		return []string{auth0UpdateUsersScope}
	}
	return append([]string{}, t.auth0Scopes...)
}

// SetAuth0ManagementScopes narrows or restores the Management API token's scopes.
func (t *Tenant) SetAuth0ManagementScopes(scopes []string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.auth0Scopes = append([]string{}, scopes...)
}

// auth0Tenant is the lowest tenant playing Auth0, as the root discovery picks it.
func (s *Server) auth0Tenant() (*Tenant, bool) {
	for _, t := range s.tenants {
		if t.LegacyProvider() == LegacyProviderAuth0 {
			return t, true
		}
	}
	return nil, false
}

// auth0TokenRequest reads a token request as Auth0 accepts it: JSON or a form.
func auth0TokenRequest(r *http.Request) (map[string]string, error) {
	fields := map[string]string{}
	if strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			return nil, err
		}
		for k, v := range body {
			if s, ok := v.(string); ok {
				fields[k] = s
			}
		}
		return fields, nil
	}
	if err := r.ParseForm(); err != nil {
		return nil, err
	}
	for k := range r.PostForm {
		fields[k] = r.PostForm.Get(k)
	}
	return fields, nil
}

// handleAuth0RootToken answers the password and client_credentials grants.
func (s *Server) handleAuth0RootToken(w http.ResponseWriter, r *http.Request) {
	t, ok := s.auth0Tenant()
	if !ok {
		http.NotFound(w, r)
		return
	}
	req, err := auth0TokenRequest(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_request", "error_description": "unparseable body"})
		return
	}
	now := s.now()
	switch req["grant_type"] {
	case "client_credentials":
		scope := auth0ManagementGrant + " " + strings.Join(t.Auth0ManagementScopes(), " ")
		token := t.MintAccessToken("", scope, now)
		s.record(t, Event{Kind: "auth0.token", Outcome: OutcomeOK, Client: req["client_id"], Detail: "issued a Management API token"})
		writeJSON(w, http.StatusOK, map[string]any{
			"access_token": token, "token_type": "Bearer", "expires_in": 86400,
			"scope": strings.Join(t.Auth0ManagementScopes(), " "),
		})
	case "password":
		user, found := t.FindUser(req["username"])
		if !found || !user.Active || t.Auth0Password(user.ID) != req["password"] {
			s.record(t, Event{Kind: "auth0.token", Outcome: OutcomeRefused, Client: req["client_id"], Subject: req["username"], Detail: "wrong email or password"})
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid_grant", "error_description": "Wrong email or password."})
			return
		}
		s.record(t, Event{Kind: "auth0.token", Outcome: OutcomeOK, Client: req["client_id"], Subject: user.Email, Detail: "password grant accepted"})
		writeJSON(w, http.StatusOK, map[string]any{
			"access_token": t.MintAccessToken(user.ID, "openid", now), "token_type": "Bearer", "expires_in": 86400,
		})
	default:
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported_grant_type", "error_description": "Unsupported grant type: " + req["grant_type"]})
	}
}

// handleAuth0UpdateUser is PATCH /api/v2/users/{id}: a password change under a Management token.
func (s *Server) handleAuth0UpdateUser(w http.ResponseWriter, r *http.Request) {
	t, ok := s.auth0Tenant()
	if !ok {
		http.NotFound(w, r)
		return
	}
	grant, live := t.GrantForToken(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "), s.now())
	if !live || !strings.HasPrefix(grant.Scope, auth0ManagementGrant) {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"statusCode": 401, "error": "Unauthorized", "message": "Invalid token"})
		return
	}
	if !slices.Contains(strings.Fields(grant.Scope), auth0UpdateUsersScope) {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"statusCode": 403, "error": "Forbidden", "errorCode": "insufficient_scope",
			"message": "Insufficient scope, expected any of: " + auth0UpdateUsersScope,
		})
		return
	}
	id, _ := url.PathUnescape(r.PathValue("id"))
	user, found := t.userByAuth0ID(id)
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]any{"statusCode": 404, "error": "Not Found", "message": "The user does not exist.", "errorCode": "inexistent_user"})
		return
	}
	var body struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"statusCode": 400, "error": "Bad Request", "message": "Payload validation error: password is required"})
		return
	}
	if len(body.Password) < auth0MinPasswordLength {
		writeJSON(w, http.StatusBadRequest, map[string]any{"statusCode": 400, "error": "Bad Request", "message": "PasswordStrengthError: Password is too weak"})
		return
	}
	t.setAuth0Password(user.ID, body.Password)
	s.record(t, Event{Kind: "auth0.users", Outcome: OutcomeOK, Subject: user.Email, Detail: "password changed through the Management API"})
	writeJSON(w, http.StatusOK, map[string]any{"user_id": id, "email": user.Email})
}

// userByAuth0ID finds the user whose Auth0-shaped subject is id.
func (t *Tenant) userByAuth0ID(id string) (*User, bool) {
	for _, u := range t.Users() {
		if t.OIDCSubject(u) == id {
			return u, true
		}
	}
	return nil, false
}
