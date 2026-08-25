package idpsim

import (
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"time"

	"github.com/crewjam/saml"
)

// samlIDP builds the crewjam identity provider for a tenant. The value is
// rebuilt per request: it is cheap, and the SSO handler customizes the
// service-provider registry per request.
func (s *Server) samlIDP(t *Tenant) saml.IdentityProvider {
	return saml.IdentityProvider{
		Key:         t.Key,
		Certificate: t.Cert,
		MetadataURL: mustParseURL(t.BaseURL + "/saml/metadata"),
		SSOURL:      mustParseURL(t.BaseURL + "/saml/sso"),
	}
}

// handleSAMLMetadata publishes the tenant's IdP metadata: entity id, SSO
// endpoint and the signing certificate service providers pin.
func (s *Server) handleSAMLMetadata(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	idp := s.samlIDP(t)
	buf, err := xml.MarshalIndent(idp.Metadata(), "", "  ")
	if err != nil {
		http.Error(w, "rendering metadata failed", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/samlmetadata+xml")
	_, _ = w.Write(buf)
}

// permissiveSPProvider fabricates service-provider metadata from the incoming
// authentication request instead of requiring pre-registration: whatever ACS
// URL the request names is where the response goes. That is exactly wrong for
// a real IdP and exactly right for a simulator — the test drives both sides.
type permissiveSPProvider struct {
	entityID string
	acsURL   string
}

func (p permissiveSPProvider) GetServiceProvider(_ *http.Request, serviceProviderID string) (*saml.EntityDescriptor, error) {
	entityID := p.entityID
	if entityID == "" {
		entityID = serviceProviderID
	}
	isDefault := true
	return &saml.EntityDescriptor{
		EntityID: entityID,
		SPSSODescriptors: []saml.SPSSODescriptor{{
			SSODescriptor: saml.SSODescriptor{
				RoleDescriptor: saml.RoleDescriptor{
					ProtocolSupportEnumeration: "urn:oasis:names:tc:SAML:2.0:protocol",
				},
			},
			AssertionConsumerServices: []saml.IndexedEndpoint{{
				Binding:   saml.HTTPPostBinding,
				Location:  p.acsURL,
				Index:     1,
				IsDefault: &isDefault,
			}},
		}},
	}, nil
}

// handleSAMLSSO accepts an AuthnRequest (redirect or POST binding), signs an
// assertion for the requested (or first) seeded user, and returns crewjam's
// auto-submitting POST form aimed at the request's ACS URL.
func (s *Server) handleSAMLSSO(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	idp := s.samlIDP(t)
	req, err := saml.NewIdpAuthnRequest(&idp, r)
	if err != nil {
		http.Error(w, fmt.Sprintf("unreadable SAML request: %v", err), http.StatusBadRequest)
		return
	}
	// Pre-read the request's issuer and ACS URL so the permissive registry can
	// echo them back through Validate's metadata lookup.
	var pre saml.AuthnRequest
	if err := xml.Unmarshal(req.RequestBuffer, &pre); err != nil {
		http.Error(w, fmt.Sprintf("unparseable SAML request: %v", err), http.StatusBadRequest)
		return
	}
	sp := permissiveSPProvider{acsURL: pre.AssertionConsumerServiceURL}
	if pre.Issuer != nil {
		sp.entityID = pre.Issuer.Value
	}
	idp.ServiceProviderProvider = sp
	if err := req.Validate(); err != nil {
		http.Error(w, fmt.Sprintf("invalid SAML request: %v", err), http.StatusBadRequest)
		return
	}
	user, ok := s.samlUser(t, r)
	if !ok {
		http.Error(w, "the tenant has no active user to assert", http.StatusBadRequest)
		return
	}
	session := &saml.Session{
		ID:            randomToken(),
		CreateTime:    s.now().UTC(),
		ExpireTime:    s.now().UTC().Add(time.Hour),
		Index:         randomToken(),
		NameID:        user.Email,
		UserName:      user.UserName,
		UserEmail:     user.Email,
		UserGivenName: user.GivenName,
		UserSurname:   user.FamilyName,
		Groups:        user.Groups,
	}
	if err := (saml.DefaultAssertionMaker{}).MakeAssertion(req, session); err != nil {
		http.Error(w, fmt.Sprintf("building the assertion failed: %v", err), http.StatusInternalServerError)
		return
	}
	if err := req.WriteResponse(w); err != nil {
		http.Error(w, fmt.Sprintf("writing the response failed: %v", err), http.StatusInternalServerError)
		return
	}
}

// samlUser picks who the assertion names: an explicit login_hint, or the
// tenant's first active user.
func (s *Server) samlUser(t *Tenant, r *http.Request) (*User, bool) {
	if hint := r.URL.Query().Get("login_hint"); hint != "" {
		u, ok := t.FindUser(hint)
		return u, ok
	}
	for _, u := range t.Users() {
		if u.Active {
			return u, true
		}
	}
	return nil, false
}

func mustParseURL(raw string) url.URL {
	u, err := url.Parse(raw)
	if err != nil {
		panic(err) // only called on URLs the simulator itself assembled
	}
	return *u
}
