package idpsim

import (
	"maps"
	"net/http"
	"strconv"
)

// tenantSummary is one card on the landing page: enough to pick a tenant, and
// whether it is the one already set up and so the one being come back to.
type tenantSummary struct {
	ID           int    `json:"id"`
	Domain       string `json:"domain"`
	BaseURL      string `json:"baseUrl"`
	Users        int    `json:"users"`
	Applications int    `json:"applications"`
}

// indexView is the landing page: the machine's own addresses and its tenants.
type indexView struct {
	BaseURL string          `json:"baseUrl"`
	DNSAddr string          `json:"dnsAddr"`
	Tenants []tenantSummary `json:"tenants"`
}

func (s *Server) handleAPITenants(w http.ResponseWriter, _ *http.Request) {
	tenants := make([]tenantSummary, 0, len(s.tenants))
	for _, t := range s.tenants {
		tenants = append(tenants, tenantSummary{
			ID: t.ID, Domain: t.Domain, BaseURL: t.BaseURL,
			Users: len(t.Users()), Applications: len(t.Applications()),
		})
	}
	writeJSON(w, http.StatusOK, indexView{BaseURL: s.cfg.BaseURL, DNSAddr: s.DNSAddr(), Tenants: tenants})
}

// samlView is what LangWatch's wizard asks to have pasted in for SAML: a
// sign-in address plus either metadata or an entity id and a certificate.
// crewjam/saml publishes the metadata address as the entity id, so that is the
// value the metadata document carries too.
type samlView struct {
	SignInURL   string `json:"signInUrl"`
	EntityID    string `json:"entityId"`
	MetadataURL string `json:"metadataUrl"`
	Certificate string `json:"certificate"`
}

// provisioningView is the tenant's connection: the address in full, and only
// enough of the token to answer "is that the one I pasted?".
type provisioningView struct {
	Configured bool   `json:"configured"`
	BaseURL    string `json:"baseUrl"`
	Token      string `json:"token"`
}

// tenantView is one tenant's page: how to wire an application up, what is
// registered, who its users are, and what its directory last did.
type tenantView struct {
	ID               int                  `json:"id"`
	Domain           string               `json:"domain"`
	BaseURL          string               `json:"baseUrl"`
	RootURL          string               `json:"rootUrl"`
	DNSAddr          string               `json:"dnsAddr"`
	SCIMToken        string               `json:"scimToken"`
	SAML             samlView             `json:"saml"`
	Applications     []*Application       `json:"applications"`
	Users            []*User              `json:"users"`
	Records          []publishedRecord    `json:"records"`
	Provisioning     provisioningView     `json:"provisioning"`
	LastProvisioning *ProvisioningOutcome `json:"lastProvisioning"`
	Scale            scaleView            `json:"scale"`
}

func (s *Server) handleAPITenant(w http.ResponseWriter, r *http.Request) {
	t, ok := s.apiTenant(w, r)
	if !ok {
		return
	}
	target := t.Provisioning()
	writeJSON(w, http.StatusOK, tenantView{
		ID: t.ID, Domain: t.Domain, BaseURL: t.BaseURL,
		RootURL: s.cfg.BaseURL, DNSAddr: s.DNSAddr(), SCIMToken: t.SCIMToken,
		SAML: samlView{
			SignInURL: t.BaseURL + "/saml/sso", EntityID: t.BaseURL + "/saml/metadata",
			MetadataURL: t.BaseURL + "/saml/metadata", Certificate: t.CertificatePEM(),
		},
		Applications: nonNil(t.Applications()),
		Users:        nonNil(t.Users()),
		Records:      s.publishedRecords(t.Domain),
		Provisioning: provisioningView{
			Configured: target.Configured(), BaseURL: target.BaseURL, Token: maskedToken(target.Token),
		},
		LastProvisioning: t.LastProvisioning(),
		Scale:            scaleViewOf(t),
	})
}

// signInUser is one account on the picker. Href is the same authorize request
// with the login hint filled in, so choosing somebody is one navigation and
// the protocol endpoint, not the page, mints the code.
type signInUser struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	Href  string `json:"href"`
}

// signInView is the account picker, or the reason authorize refused to show it.
type signInView struct {
	TenantID int            `json:"tenantId"`
	Domain   string         `json:"domain"`
	Refusal  *refusalNotice `json:"refusal"`
	Users    []signInUser   `json:"users"`
}

// handleAPISignIn reads the authorize request the picker was served for (the
// page forwards its own query) and answers who can be chosen. It records
// nothing: authorize itself already did.
func (s *Server) handleAPISignIn(w http.ResponseWriter, r *http.Request) {
	t, ok := s.apiTenant(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	view := signInView{TenantID: t.ID, Domain: t.Domain, Users: []signInUser{}}
	if notice, _, refused := unregisteredRedirect(t, parseAuthorizeRequest(query)); refused {
		view.Refusal = &notice
		writeJSON(w, http.StatusOK, view)
		return
	}
	for _, u := range t.Users() {
		if !u.Active {
			continue
		}
		hinted := maps.Clone(query)
		hinted.Set("login_hint", u.ID)
		view.Users = append(view.Users, signInUser{
			Name: u.DisplayName(), Email: u.Email,
			Href: "/t/" + strconv.Itoa(t.ID) + "/oauth/authorize?" + hinted.Encode(),
		})
	}
	writeJSON(w, http.StatusOK, view)
}

// nonNil keeps an empty list a list on the wire rather than null.
func nonNil[T any](items []T) []T {
	if items == nil {
		return []T{}
	}
	return items
}
