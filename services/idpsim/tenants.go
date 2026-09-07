// Package idpsim is a local identity-provider simulator for development and
// testing: one process serves a range of independent tenants, each acting as a
// full customer IdP — an OIDC provider, a SAML identity provider, a SCIM 2.0
// user store — plus DNS and HTTP endpoints for exercising domain verification.
// Nothing here is production code: every tenant's users, secrets and keys are
// synthetic, held in memory, and reset at boot.
package idpsim

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
)

// User is one identity a tenant can log in and provision. The same record
// backs all three protocols: OIDC claims, the SAML assertion, and the SCIM
// resource.
type User struct {
	ID         string   `json:"id"`
	UserName   string   `json:"userName"`
	Email      string   `json:"email"`
	GivenName  string   `json:"givenName"`
	FamilyName string   `json:"familyName"`
	Active     bool     `json:"active"`
	Groups     []string `json:"groups,omitempty"`
	ExternalID string   `json:"externalId,omitempty"`
}

// DisplayName is the human label the picker and claims use.
func (u *User) DisplayName() string {
	name := strings.TrimSpace(u.GivenName + " " + u.FamilyName)
	if name == "" {
		return u.UserName
	}
	return name
}

// Group is one SCIM group.
type Group struct {
	ID        string   `json:"id"`
	Name      string   `json:"displayName"`
	MemberIDs []string `json:"memberIds,omitempty"`
}

// Tenant is one simulated identity provider: its own issuer, signing key,
// certificate, user store and SCIM credential. Tenants never share state, so a
// range of them behaves like a range of unrelated customers.
type Tenant struct {
	ID int
	// BaseURL is the tenant's external base (…/t/<id>) — also its OIDC issuer
	// and SAML entity ID.
	BaseURL string
	// Domain is the fake domain this tenant "owns", pre-seeded for domain
	// verification (acme<id>.test by default).
	Domain string
	// Key signs the tenant's ID tokens and SAML assertions; Cert is the
	// self-signed certificate SAML metadata publishes for it.
	Key  *rsa.PrivateKey
	Cert *x509.Certificate
	// SCIMToken is the deterministic bearer token the tenant's SCIM endpoints
	// require, printed on the index page so a provisioning client can be
	// pointed at the tenant with no discovery step.
	SCIMToken string

	mu     sync.Mutex
	users  []*User
	groups []*Group
	codes  map[string]*authCode
	grants map[string]*accessGrant
	// apps are the relying parties registered with this tenant (apps.go), and
	// events its recent request history (activity.go). Neither is directory
	// state, so Reset — which restores the seeded users — leaves both alone: a
	// developer resetting users has not un-registered their application, and
	// the log of what just happened is the reason they are looking.
	apps   []*Application
	events []Event
	// provisioning is where this tenant sends its directory — a real service
	// provider's SCIM address and the token that provider issued (see
	// provisioning.go) — and lastProvisioning is what the last push or
	// read-back made of it. Like apps and events, neither is directory state,
	// so Reset leaves them alone: putting the seeded users back is not a
	// reason to forget where they were going.
	provisioning     ProvisioningTarget
	lastProvisioning *ProvisioningOutcome
	// samlpSubjects makes the tenant mint Auth0-broker-style subjects
	// (samlp|idpsim-t<n>|<user id>) so the app's SAML-brokered-login handling
	// can be exercised over plain OIDC, the way Auth0 delivers it.
	samlpSubjects bool
}

// SetSamlpSubjects toggles Auth0-style SAML-brokered subject minting.
func (t *Tenant) SetSamlpSubjects(on bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.samlpSubjects = on
}

// SamlpSubjects reports whether the tenant mints samlp|-prefixed subjects.
func (t *Tenant) SamlpSubjects() bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.samlpSubjects
}

// Subject is the OIDC subject for a user under the tenant's current style.
func (t *Tenant) Subject(u *User) string {
	if t.SamlpSubjects() {
		return fmt.Sprintf("samlp|idpsim-t%d|%s", t.ID, u.ID)
	}
	return u.ID
}

// authCode is one outstanding authorization code.
type authCode struct {
	UserID        string
	ClientID      string
	RedirectURI   string
	Nonce         string
	Scope         string
	CodeChallenge string
	ChallengeMeth string
	ExpiresAt     time.Time
}

// accessGrant is one issued access token.
type accessGrant struct {
	UserID    string
	Scope     string
	ExpiresAt time.Time
}

// KeyID is the identifier the tenant's JWKS and JWT headers share.
func (t *Tenant) KeyID() string { return fmt.Sprintf("t%d-k1", t.ID) }

// CertificatePEM is the tenant's SAML signing certificate, PEM-armored —
// the shape a "signing certificate" field expects to be pasted into.
func (t *Tenant) CertificatePEM() string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: t.Cert.Raw}))
}

// seedUsers resets the tenant to its two deterministic users: an admin and a
// member on the tenant's own domain.
func (t *Tenant) seedUsers() {
	t.users = []*User{
		{
			ID: fmt.Sprintf("t%d-user-admin", t.ID), UserName: "admin@" + t.Domain,
			Email: "admin@" + t.Domain, GivenName: "Ada", FamilyName: "Admin",
			Active: true, Groups: []string{"admins", "everyone"},
		},
		{
			ID: fmt.Sprintf("t%d-user-member", t.ID), UserName: "member@" + t.Domain,
			Email: "member@" + t.Domain, GivenName: "Mel", FamilyName: "Member",
			Active: true, Groups: []string{"everyone"},
		},
	}
	t.groups = nil
	t.codes = map[string]*authCode{}
	t.grants = map[string]*accessGrant{}
}

// Reset restores the seeded state, dropping every SCIM change, code and token.
func (t *Tenant) Reset() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.seedUsers()
}

// Users returns a snapshot of the tenant's users.
func (t *Tenant) Users() []*User {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]*User, len(t.users))
	copy(out, t.users)
	return out
}

// UserByID finds a user by SCIM/OIDC subject id.
func (t *Tenant) UserByID(id string) (*User, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, u := range t.users {
		if u.ID == id {
			return u, true
		}
	}
	return nil, false
}

// FindUser resolves a login hint — subject id, user name or email — to a user.
func (t *Tenant) FindUser(hint string) (*User, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, u := range t.users {
		if u.ID == hint || strings.EqualFold(u.UserName, hint) || strings.EqualFold(u.Email, hint) {
			return u, true
		}
	}
	return nil, false
}

// AddUser appends a user (SCIM create / control API).
func (t *Tenant) AddUser(u *User) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.users = append(t.users, u)
}

// RemoveUser deletes a user by id, reporting whether it existed.
func (t *Tenant) RemoveUser(id string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i, u := range t.users {
		if u.ID == id {
			t.users = append(t.users[:i], t.users[i+1:]...)
			return true
		}
	}
	return false
}

// Groups returns a snapshot of the tenant's groups.
func (t *Tenant) Groups() []*Group {
	t.mu.Lock()
	defer t.mu.Unlock()
	out := make([]*Group, len(t.groups))
	copy(out, t.groups)
	return out
}

// GroupByID finds a group by id.
func (t *Tenant) GroupByID(id string) (*Group, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	for _, g := range t.groups {
		if g.ID == id {
			return g, true
		}
	}
	return nil, false
}

// AddGroup appends a group.
func (t *Tenant) AddGroup(g *Group) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.groups = append(t.groups, g)
}

// RemoveGroup deletes a group by id, reporting whether it existed.
func (t *Tenant) RemoveGroup(id string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	for i, g := range t.groups {
		if g.ID == id {
			t.groups = append(t.groups[:i], t.groups[i+1:]...)
			return true
		}
	}
	return false
}

// MintCode stores a fresh authorization code and returns it.
func (t *Tenant) MintCode(c *authCode, now time.Time) string {
	code := randomToken()
	c.ExpiresAt = now.Add(10 * time.Minute)
	t.mu.Lock()
	defer t.mu.Unlock()
	t.codes[code] = c
	return code
}

// RedeemCode consumes a code exactly once; a second redemption misses.
func (t *Tenant) RedeemCode(code string, now time.Time) (*authCode, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	c, ok := t.codes[code]
	if !ok || now.After(c.ExpiresAt) {
		return nil, false
	}
	delete(t.codes, code)
	return c, true
}

// MintAccessToken stores a fresh access token for the user and returns it.
func (t *Tenant) MintAccessToken(userID, scope string, now time.Time) string {
	token := randomToken()
	t.mu.Lock()
	defer t.mu.Unlock()
	t.grants[token] = &accessGrant{UserID: userID, Scope: scope, ExpiresAt: now.Add(time.Hour)}
	return token
}

// GrantForToken resolves a live access token to its grant.
func (t *Tenant) GrantForToken(token string, now time.Time) (*accessGrant, bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	g, ok := t.grants[token]
	if !ok || now.After(g.ExpiresAt) {
		return nil, false
	}
	return g, true
}

// newTenants provisions the whole range concurrently — each tenant's RSA key
// and self-signed certificate take real CPU, and a 20-tenant range should not
// pay for them serially at boot.
func newTenants(count int, externalBase string) ([]*Tenant, error) {
	tenants := make([]*Tenant, count)
	var g errgroup.Group
	for i := range count {
		g.Go(func() error {
			t, err := newTenant(i+1, externalBase)
			if err != nil {
				return err
			}
			tenants[i] = t
			return nil
		})
	}
	if err := g.Wait(); err != nil {
		return nil, err
	}
	return tenants, nil
}

func newTenant(id int, externalBase string) (*Tenant, error) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return nil, fmt.Errorf("tenant %d: generating key: %w", id, err)
	}
	t := &Tenant{
		ID:        id,
		BaseURL:   fmt.Sprintf("%s/t/%d", strings.TrimSuffix(externalBase, "/"), id),
		Domain:    fmt.Sprintf("acme%d.test", id),
		Key:       key,
		SCIMToken: fmt.Sprintf("idpsim-scim-token-%d", id),
	}
	t.Cert, err = selfSignedCert(t)
	if err != nil {
		return nil, fmt.Errorf("tenant %d: self-signing certificate: %w", id, err)
	}
	t.seedUsers()
	return t, nil
}

// selfSignedCert issues the tenant's SAML signing certificate: self-signed,
// long-lived, and never trusted by anything but the metadata that publishes it.
func selfSignedCert(t *Tenant) (*x509.Certificate, error) {
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(int64(t.ID)),
		Subject:      pkix.Name{CommonName: fmt.Sprintf("idpsim tenant %d", t.ID)},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(10 * 365 * 24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &t.Key.PublicKey, t.Key)
	if err != nil {
		return nil, err
	}
	return x509.ParseCertificate(der)
}

// randomToken is a 128-bit hex string — codes, access tokens.
func randomToken() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand failing means the process has no business running
	}
	return hex.EncodeToString(b)
}
