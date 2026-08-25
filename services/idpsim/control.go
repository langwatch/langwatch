package idpsim

import (
	"encoding/json"
	"fmt"
	"html/template"
	"net/http"
)

// handleIndex is the human surface: every tenant with its endpoints, users and
// tokens, so pointing the app (or a curl) at a tenant is copy-paste.
var indexTemplate = template.Must(template.New("index").Parse(`<!doctype html>
<title>idpsim — simulated identity providers</title>
<style>
body{font-family:system-ui;margin:2rem auto;max-width:64rem;line-height:1.5}
section{border:1px solid #ccc;border-radius:.5rem;padding:1rem 1.5rem;margin:1rem 0}
code{background:#eee;padding:.1rem .3rem;border-radius:.25rem}
table{border-collapse:collapse}td,th{text-align:left;padding:.15rem .75rem .15rem 0}
</style>
<h1>idpsim</h1>
<p>{{.TenantCount}} simulated identity provider tenants. Each tenant is an OIDC provider,
a SAML identity provider and a SCIM 2.0 directory, and owns a fake domain with DNS and
HTTP verification pre-configured.{{if .DNSAddr}} Verification DNS answers on <code>{{.DNSAddr}}</code> (UDP).{{end}}</p>
{{range .Tenants}}
<section>
<h2>Tenant {{.ID}} — {{.Domain}}</h2>
<table>
<tr><th>OIDC issuer</th><td><a href="{{.BaseURL}}/.well-known/openid-configuration"><code>{{.BaseURL}}</code></a></td></tr>
<tr><th>SAML metadata</th><td><a href="{{.BaseURL}}/saml/metadata"><code>{{.BaseURL}}/saml/metadata</code></a></td></tr>
<tr><th>SCIM base</th><td><code>{{.BaseURL}}/scim/v2</code> · bearer <code>{{.SCIMToken}}</code></td></tr>
<tr><th>Users</th><td>{{range .Users}}<code>{{.Email}}</code> {{end}}</td></tr>
</table>
</section>
{{end}}
<p>Control API: <code>GET /control/state</code> ·
<code>POST /control/t/{n}/reset</code> ·
<code>POST /control/t/{n}/users</code> ·
<code>POST /control/t/{n}/config</code> ·
<code>POST /control/t/{n}/scim-push</code> ·
<code>PUT /control/dns/txt</code> ·
<code>PUT /control/verification</code></p>
`))

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	type tenantRow struct {
		ID        int
		Domain    string
		BaseURL   string
		SCIMToken string
		Users     []*User
	}
	rows := make([]tenantRow, 0, len(s.tenants))
	for _, t := range s.tenants {
		rows = append(rows, tenantRow{
			ID: t.ID, Domain: t.Domain, BaseURL: t.BaseURL,
			SCIMToken: t.SCIMToken, Users: t.Users(),
		})
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = indexTemplate.Execute(w, map[string]any{
		"TenantCount": len(rows), "Tenants": rows, "DNSAddr": s.dnsAddr,
	})
}

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
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"tenants":            tenants,
		"dnsAddr":            s.dnsAddr,
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
	var req scimPushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Target == "" {
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
