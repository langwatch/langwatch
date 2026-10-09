package idpsim

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/beevik/etree"
	"github.com/crewjam/saml"
)

// The one-shot ways to break the next SAML response; the OIDC ones are in legacy.go.
const (
	TamperSAMLBadSignature      TamperMode = "saml-bad-signature"
	TamperSAMLUnsigned          TamperMode = "saml-unsigned"
	TamperSAMLWrongAudience     TamperMode = "saml-wrong-audience"
	TamperSAMLWrongRecipient    TamperMode = "saml-wrong-recipient"
	TamperSAMLExpired           TamperMode = "saml-expired"
	TamperSAMLNotYetValid       TamperMode = "saml-not-yet-valid"
	TamperSAMLReplayed          TamperMode = "saml-replayed-assertion"
	TamperSAMLWrongInResponseTo TamperMode = "saml-wrong-in-response-to"
)

// Values a tampered assertion carries in place of the real ones.
const (
	wrongRecipient    = "https://idpsim-wrong-recipient.invalid/saml/acs"
	wrongInResponseTo = "idpsim-wrong-in-response-to"
)

func isSAMLTamper(m TamperMode) bool { return strings.HasPrefix(string(m), "saml-") }

// tenantFaults is per-tenant fault state the Tenant struct does not carry.
// shortcut: kept beside tenants.go (another lane's file) and not persisted; move onto Tenant when free.
type tenantFaults struct {
	skew            time.Duration
	lastAssertionID string
}

var faultTable = struct {
	mu       sync.Mutex
	byTenant map[*Tenant]*tenantFaults
}{byTenant: map[*Tenant]*tenantFaults{}}

func (t *Tenant) withFaults(fn func(f *tenantFaults)) {
	faultTable.mu.Lock()
	defer faultTable.mu.Unlock()
	f, ok := faultTable.byTenant[t]
	if !ok {
		f = &tenantFaults{}
		faultTable.byTenant[t] = f
	}
	fn(f)
}

// Skew is how far the tenant's clock runs from the real one, applied to every token and assertion.
func (t *Tenant) Skew() time.Duration {
	var d time.Duration
	t.withFaults(func(f *tenantFaults) { d = f.skew })
	return d
}

// SetSkew sets the tenant's clock skew; negative runs the clock behind.
func (t *Tenant) SetSkew(d time.Duration) {
	t.withFaults(func(f *tenantFaults) { f.skew = d })
}

// takeSAMLTamper disarms and returns an armed SAML mode, leaving an OIDC one armed.
func (t *Tenant) takeSAMLTamper() TamperMode {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !isSAMLTamper(t.tamper) {
		return TamperNone
	}
	mode := t.tamper
	t.tamper = TamperNone
	return mode
}

// samlIssue is one assertion to sign for a user and post to a service provider.
type samlIssue struct {
	Tenant *Tenant
	Req    *saml.IdpAuthnRequest
	User   *User
}

// issueSAML signs the assertion with the tenant's skew and any armed fault applied,
// returning the fault it applied. The caller writes the response.
func issueSAML(in samlIssue) (TamperMode, error) {
	t, req := in.Tenant, in.Req
	if err := (saml.DefaultAssertionMaker{}).MakeAssertion(req, samlSession(in.User, req.Now)); err != nil {
		return TamperNone, err
	}
	skew, mode := t.Skew(), t.takeSAMLTamper()
	shiftAssertion(req.Assertion, skew)
	req.Now = req.Now.Add(skew)
	var previous string
	t.withFaults(func(f *tenantFaults) { previous = f.lastAssertionID })
	breakAssertion(req, assertionBreak{Mode: mode, PreviousID: previous})
	t.withFaults(func(f *tenantFaults) { f.lastAssertionID = req.Assertion.ID })
	return mode, signResponse(req, mode)
}

func samlSession(u *User, now time.Time) *saml.Session {
	return &saml.Session{
		ID: randomToken(), CreateTime: now.UTC(), ExpireTime: now.UTC().Add(time.Hour), Index: randomToken(),
		NameID: u.Email, UserName: u.UserName, UserEmail: u.Email,
		UserGivenName: u.GivenName, UserSurname: u.FamilyName, Groups: u.Groups,
	}
}

// assertionBreak is one armed SAML tamper and what applying it needs.
type assertionBreak struct {
	Mode       TamperMode
	PreviousID string
}

// breakAssertion applies a content-level tamper before signing; signature tampers happen in signResponse.
func breakAssertion(req *saml.IdpAuthnRequest, b assertionBreak) {
	a := req.Assertion
	switch b.Mode {
	case TamperSAMLWrongAudience:
		a.Conditions.AudienceRestrictions = []saml.AudienceRestriction{{Audience: saml.Audience{Value: wrongAudience}}}
	case TamperSAMLWrongRecipient:
		eachConfirmation(a, func(d *saml.SubjectConfirmationData) { d.Recipient = wrongRecipient })
	case TamperSAMLExpired:
		shiftAssertion(a, -2*time.Hour)
	case TamperSAMLNotYetValid:
		shiftAssertion(a, time.Hour)
	case TamperSAMLReplayed:
		if b.PreviousID != "" {
			a.ID = b.PreviousID
		}
	case TamperSAMLWrongInResponseTo:
		req.Request.ID = wrongInResponseTo
		eachConfirmation(a, func(d *saml.SubjectConfirmationData) { d.InResponseTo = wrongInResponseTo })
	case TamperNone, TamperBadSignature, TamperWrongAudience, TamperExpired, TamperReplayedNonce,
		TamperSAMLBadSignature, TamperSAMLUnsigned:
	}
}

// shiftAssertion moves every instant the assertion states by d, as a skewed IdP clock would.
func shiftAssertion(a *saml.Assertion, d time.Duration) {
	if d == 0 {
		return
	}
	a.IssueInstant = a.IssueInstant.Add(d)
	if c := a.Conditions; c != nil {
		c.NotBefore, c.NotOnOrAfter = c.NotBefore.Add(d), c.NotOnOrAfter.Add(d)
	}
	eachConfirmation(a, func(cd *saml.SubjectConfirmationData) { cd.NotOnOrAfter = cd.NotOnOrAfter.Add(d) })
	for i := range a.AuthnStatements {
		a.AuthnStatements[i].AuthnInstant = a.AuthnStatements[i].AuthnInstant.Add(d)
	}
}

func eachConfirmation(a *saml.Assertion, fn func(*saml.SubjectConfirmationData)) {
	if a.Subject == nil {
		return
	}
	for i := range a.Subject.SubjectConfirmations {
		if d := a.Subject.SubjectConfirmations[i].SubjectConfirmationData; d != nil {
			fn(d)
		}
	}
}

// signResponse builds the signed response, then strips or corrupts the signatures when asked.
func signResponse(req *saml.IdpAuthnRequest, mode TamperMode) error {
	if mode == TamperSAMLUnsigned {
		req.AssertionEl = req.Assertion.Element()
	}
	if err := req.MakeResponse(); err != nil {
		return err
	}
	if mode == TamperSAMLUnsigned {
		for _, el := range req.ResponseEl.ChildElements() {
			if el.Tag == "Signature" {
				req.ResponseEl.RemoveChild(el)
			}
		}
	}
	if mode == TamperSAMLBadSignature {
		corruptSignatureValues(req.ResponseEl)
	}
	return nil
}

// corruptSignatureValues changes one base64 character of every SignatureValue
// below el: still well-formed, no longer verifying.
func corruptSignatureValues(el *etree.Element) {
	for _, child := range el.ChildElements() {
		if child.Tag != "SignatureValue" {
			corruptSignatureValues(child)
			continue
		}
		v := strings.TrimSpace(child.Text())
		if v == "" {
			continue
		}
		swap := "A"
		if strings.HasPrefix(v, "A") {
			swap = "B"
		}
		child.SetText(swap + v[1:])
	}
}

// handleControlSAMLUnsolicited signs an IdP-initiated response (no
// InResponseTo) for a user and returns the POST form fields for the ACS.
func (s *Server) handleControlSAMLUnsolicited(w http.ResponseWriter, r *http.Request) {
	t, ok := s.tenantFor(r)
	if !ok {
		http.NotFound(w, r)
		return
	}
	var body struct {
		ACSURL     string `json:"acsUrl"`
		EntityID   string `json:"entityId"`
		Email      string `json:"email"`
		RelayState string `json:"relayState"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.ACSURL == "" || body.Email == "" {
		http.Error(w, "an unsolicited response needs an acsUrl and an email", http.StatusBadRequest)
		return
	}
	sp := permissiveSPProvider{entityID: body.EntityID, acsURL: body.ACSURL}
	if sp.entityID == "" {
		sp.entityID = body.ACSURL
	}
	user, found := t.FindUser(body.Email)
	if !found || !user.Active {
		s.record(t, Event{Kind: "saml.unsolicited", Outcome: OutcomeRefused, Client: sp.entityID, Subject: body.Email,
			Detail: "refused: " + body.Email + " is not an active user of this tenant"})
		http.Error(w, "no active user "+body.Email+" on this tenant", http.StatusForbidden)
		return
	}
	s.writeUnsolicited(w, unsolicited{HTTP: r, Tenant: t, SP: sp, User: user, RelayState: body.RelayState})
}

// unsolicited is one IdP-initiated response to build.
type unsolicited struct {
	HTTP       *http.Request
	Tenant     *Tenant
	SP         permissiveSPProvider
	User       *User
	RelayState string
}

func (s *Server) writeUnsolicited(w http.ResponseWriter, u unsolicited) {
	idp := s.samlIDP(u.Tenant)
	idp.ServiceProviderProvider = u.SP
	md, _ := u.SP.GetServiceProvider(nil, u.SP.entityID)
	spsso := &md.SPSSODescriptors[0]
	req := &saml.IdpAuthnRequest{
		IDP: &idp, HTTPRequest: u.HTTP, RelayState: u.RelayState, Now: saml.TimeNow(),
		ServiceProviderMetadata: md, SPSSODescriptor: spsso, ACSEndpoint: &spsso.AssertionConsumerServices[0],
	}
	mode, err := issueSAML(samlIssue{Tenant: u.Tenant, Req: req, User: u.User})
	if err != nil {
		http.Error(w, "building the response failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	form, err := req.PostBinding()
	if err != nil {
		http.Error(w, "encoding the response failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	s.record(u.Tenant, Event{Kind: "saml.unsolicited", Outcome: OutcomeOK, Client: u.SP.entityID, Subject: u.User.Email,
		Detail: faultDetail("signed an unsolicited assertion for "+u.User.Email+" with RelayState "+u.RelayState, mode, u.Tenant)})
	writeJSON(w, http.StatusOK, map[string]any{"url": form.URL, "samlResponse": form.SAMLResponse, "relayState": form.RelayState})
}

// faultDetail appends the faults a response carried to its activity line.
func faultDetail(detail string, mode TamperMode, t *Tenant) string {
	if mode != TamperNone {
		detail += "; deliberately broke it: " + string(mode)
	}
	if skew := t.Skew(); skew != 0 {
		detail += "; clock skewed by " + skew.String()
	}
	return detail
}
