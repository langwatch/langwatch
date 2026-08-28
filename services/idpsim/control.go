package idpsim

import (
	"encoding/json"
	"fmt"
	"net/http"
)

// handleControlState dumps the whole simulator as JSON — what an automated
// test reads instead of the index page.
func (s *Server) handleControlState(w http.ResponseWriter, _ *http.Request) {
	txt, tokens := s.verification.Snapshot()
	tenants := make([]map[string]any, 0, len(s.tenants))
	for _, t := range s.tenants {
		tenants = append(tenants, map[string]any{
			"id":            t.ID,
			"baseUrl":       t.BaseURL,
			"domain":        t.Domain,
			"scimToken":     t.SCIMToken,
			"samlpSubjects": t.SamlpSubjects(),
			"users":         t.Users(),
			"groups":        t.Groups(),
			"applications":  t.Applications(),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tenants":            tenants,
		"dnsAddr":            s.DNSAddr(),
		"txtRecords":         txt,
		"verificationTokens": tokens,
	})
}

// handleControlReset restores a tenant's seeded state.
func (s *Server) handleControlReset(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	t.Reset()
	writeJSON(w, http.StatusOK, map[string]any{"users": t.Users()})
}

// handleControlAddUser appends a user to a tenant.
func (s *Server) handleControlAddUser(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var u User
	if err := json.NewDecoder(r.Body).Decode(&u); err != nil || u.Email == "" {
		http.Error(w, "a user needs at least an email", http.StatusBadRequest)
		return
	}
	if u.ID == "" {
		u.ID = fmt.Sprintf("t%d-user-%s", t.ID, randomToken()[:8])
	}
	if u.UserName == "" {
		u.UserName = u.Email
	}
	u.Active = true
	t.AddUser(&u)
	writeJSON(w, http.StatusCreated, &u)
}

// handleControlActivity is the tenant's recent history as JSON — what the
// live feed on the tenant page polls, and what a test asserts against when it
// wants to know that a login really did reach the identity provider.
func (s *Server) handleControlActivity(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"events": t.Activity()})
}

// handleControlRegisterApp registers a relying party from JSON — the
// scriptable twin of the registration form, for tests and setup scripts.
func (s *Server) handleControlRegisterApp(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var body struct {
		Name         string   `json:"name"`
		RedirectURIs []string `json:"redirectUris"`
		EntityID     string   `json:"entityId"`
		ACSURL       string   `json:"acsUrl"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		http.Error(w, "an application needs a name", http.StatusBadRequest)
		return
	}
	app := t.RegisterApplication(Registration{
		Name: body.Name, RedirectURIs: body.RedirectURIs,
		EntityID: body.EntityID, ACSURL: body.ACSURL,
	}, s.now())
	s.record(t, Event{
		Kind:    "app.register",
		Outcome: OutcomeOK,
		Client:  app.ClientID,
		Detail:  "registered the application " + app.Name,
	})
	writeJSON(w, http.StatusCreated, map[string]any{
		"name": app.Name, "issuer": t.BaseURL,
		"clientId": app.ClientID, "clientSecret": app.Secret,
		"redirectUris": app.RedirectURIs,
	})
}

// handleControlConfig flips tenant behavior switches.
func (s *Server) handleControlConfig(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var body struct {
		SamlpSubjects *bool `json:"samlpSubjects"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "unparseable config body", http.StatusBadRequest)
		return
	}
	if body.SamlpSubjects != nil {
		t.SetSamlpSubjects(*body.SamlpSubjects)
	}
	writeJSON(w, http.StatusOK, map[string]any{"samlpSubjects": t.SamlpSubjects()})
}

// handleControlSCIMPush drives the tenant's directory at an external SCIM
// service provider.
func (s *Server) handleControlSCIMPush(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var req ProvisioningTarget
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.BaseURL == "" {
		http.Error(w, "a push needs a target SCIM base URL", http.StatusBadRequest)
		return
	}
	writeJSON(w, http.StatusOK, pushDirectory(r.Context(), t, req))
}

// handleControlDNS sets or clears a TXT record.
func (s *Server) handleControlDNS(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Domain string   `json:"domain"`
		Values []string `json:"values"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" {
		http.Error(w, "a TXT record needs a domain", http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodDelete || len(body.Values) == 0 {
		s.verification.RemoveTXT(body.Domain)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.verification.SetTXT(body.Domain, body.Values)
	writeJSON(w, http.StatusOK, map[string]any{"domain": normalizeDomain(body.Domain), "values": body.Values})
}

// handleControlVerification sets or clears a well-known HTTP token.
func (s *Server) handleControlVerification(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Domain string `json:"domain"`
		Token  string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Domain == "" {
		http.Error(w, "a verification token needs a domain", http.StatusBadRequest)
		return
	}
	if r.Method == http.MethodDelete || body.Token == "" {
		s.verification.RemoveToken(body.Domain)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	s.verification.SetToken(body.Domain, body.Token)
	writeJSON(w, http.StatusOK, map[string]any{"domain": normalizeDomain(body.Domain), "token": body.Token})
}
