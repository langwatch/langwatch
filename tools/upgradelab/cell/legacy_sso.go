package cell

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
)

// legacySeed is what a legacy-sso cell recorded on main: the proxy it runs and each member's standing there.
type legacySeed struct {
	proxy      *http.Server
	providers  map[string][]string // email -> Account providers on main
	membership map[string][]string // email -> "organization:role" on main
	err        error               // reading main's standing failed
}

// startIdentityProxy puts idpsim behind TLS: main's Auth0 provider keeps only the issuer's host and forces
// https. The proxy serves a leaf signed by the cell's own CA; both releases trust the CA through NODE_EXTRA_CA_CERTS.
func (cell *run) startIdentityProxy() error {
	certificate, pemBytes, err := proxyCertificates()
	if err != nil {
		return err
	}
	cell.stores.IDPCA = filepath.Join(cell.options.RunDir, "idp-ca.pem")
	if err := os.WriteFile(cell.stores.IDPCA, pemBytes, 0o600); err != nil {
		return err
	}
	listener, err := tls.Listen("tcp", "127.0.0.1:0", &tls.Config{Certificates: []tls.Certificate{certificate}, MinVersion: tls.VersionTLS12})
	if err != nil {
		return err
	}
	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		return errors.New("TLS listener has no TCP address")
	}
	cell.stores.IDPPublic = "https://127.0.0.1:" + itoa(address.Port)
	target, err := url.Parse(cell.stores.IDPURL())
	if err != nil {
		return err
	}
	cell.legacy.proxy = &http.Server{Handler: httputil.NewSingleHostReverseProxy(target), ReadHeaderTimeout: 10 * time.Second}
	go func() { _ = cell.legacy.proxy.Serve(listener) }()
	return nil
}

// proxyCertificates is a CA for the cell and a leaf it signed for 127.0.0.1 and localhost, valid for a week: the
// leaf to serve and the CA's PEM to trust. Node refuses a self-signed CA served as its own leaf.
func proxyCertificates() (tls.Certificate, []byte, error) {
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	caTemplate := certificateTemplate("upgradelab cell CA")
	caTemplate.IsCA, caTemplate.KeyUsage = true, x509.KeyUsageCertSign|x509.KeyUsageCRLSign
	caDER, err := x509.CreateCertificate(rand.Reader, caTemplate, caTemplate, &caKey.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	ca, err := x509.ParseCertificate(caDER)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	leafTemplate := certificateTemplate("upgradelab idpsim")
	leafTemplate.KeyUsage, leafTemplate.ExtKeyUsage = x509.KeyUsageDigitalSignature, []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}
	leafTemplate.IPAddresses, leafTemplate.DNSNames = []net.IP{net.ParseIP("127.0.0.1")}, []string{"localhost"}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTemplate, ca, &leafKey.PublicKey, caKey)
	if err != nil {
		return tls.Certificate{}, nil, err
	}
	return tls.Certificate{Certificate: [][]byte{leafDER, caDER}, PrivateKey: leafKey}, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), nil
}

func certificateTemplate(name string) *x509.Certificate {
	serial, _ := rand.Int(rand.Reader, big.NewInt(1<<62))
	return &x509.Certificate{SerialNumber: serial, Subject: pkix.Name{CommonName: name}, BasicConstraintsValid: true,
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(7 * 24 * time.Hour)}
}

// legacyAuth0Env is idpsim's own `legacy env` for tenant 1 as Auth0, under main's variable names: what an
// operator's .env held for main, kept unchanged across the upgrade.
func legacyAuth0Env(stores Stores) map[string]string {
	return map[string]string{"NEXTAUTH_PROVIDER": "auth0", "AUTH0_CLIENT_ID": "langwatch-legacy-auth0",
		"AUTH0_CLIENT_SECRET": "idpsim-accepts-any-secret-for-an-unregistered-client", "AUTH0_ISSUER": stores.IDPPublic + "/",
		"NODE_EXTRA_CA_CERTS": stores.IDPCA}
}

// deploymentProvider is the legacy provider name main's organizations record for the deployment door.
func (cell *run) deploymentProvider() string {
	if cell.profile.LegacySSO {
		return "auth0"
	}
	return "oidc"
}

// idpControl posts one control call to the cell's idpsim.
func idpControl(ctx context.Context, address, body string) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, address, strings.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode/100 != 2 {
		answer, _ := io.ReadAll(io.LimitReader(response.Body, 300))
		return fmt.Errorf("idpsim %s answered %d: %s", address, response.StatusCode, answer)
	}
	return nil
}

// seedSAMLOrganization makes a second organization through main's door, walks the go-live checklist for a SAML
// connection to idpsim tenant 3 and invites a plain member of that tenant's domain.
func (cell *run) seedSAMLOrganization(ctx context.Context) {
	cell.sso.samlErr = func() error {
		made, err := cell.newOrganization(ctx, "SAML "+cell.options.Name())
		if err != nil {
			return fmt.Errorf("organization: %w", err)
		}
		status, metadata, err := get(ctx, httpClient, cell.stores.IDPURL()+"/t/"+samlTenant+"/saml/metadata")
		if err != nil || status != http.StatusOK {
			return fmt.Errorf("idpsim SAML metadata: %d %w", status, err)
		}
		cell.sso.saml = connectionSpec{org: made.org, team: made.team, project: made.slug, tenant: samlTenant, domain: samlDomain,
			subscription: "snap_sso_saml_enterprise", idp: map[string]any{"protocol": "saml", "entryPoint": cell.stores.IDPIssuer() + "/t/" + samlTenant + "/saml/sso",
				"entityId": nil, "metadataXml": metadata, "certificate": nil}}
		if err := cell.activateConnection(ctx, &cell.sso.saml); err != nil {
			return err
		}
		member := "member@" + samlDomain
		code, err := cell.seeder.InviteTo(ctx, member, made.org, made.team)
		if err != nil {
			return fmt.Errorf("invite %s: %w", member, err)
		}
		cell.sso.members = append(cell.sso.members, ssoMember{Email: member, InviteCode: code, Door: "saml", ConnectionID: cell.sso.saml.connectionID, Project: made.slug})
		return nil
	}()
}

// legacyEmails are the members a legacy-sso cell follows: every SSO member and the seed account (password).
func (cell *run) legacyEmails() []string {
	email, _ := generate.SeedAccount(cell.options.Seed)
	emails := []string{email}
	for _, member := range cell.sso.members {
		emails = append(emails, member.Email)
	}
	return emails
}

// legacyAtMain records, once every member signed in on main, their Account providers and memberships there.
func (cell *run) legacyAtMain(ctx context.Context) {
	cell.legacy.providers, cell.legacy.err = cell.standing(ctx, `SELECT u.email, a.provider FROM mydb."Account" a JOIN mydb."User" u ON u.id = a."userId" WHERE u.email IN (%s) ORDER BY 1, 2`)
	if cell.legacy.err == nil {
		cell.legacy.membership, cell.legacy.err = cell.memberships(ctx)
	}
}

func (cell *run) memberships(ctx context.Context) (map[string][]string, error) {
	return cell.standing(ctx, `SELECT u.email, ou."organizationId" || ':' || ou.role FROM mydb."OrganizationUser" ou JOIN mydb."User" u ON u.id = ou."userId" WHERE u.email IN (%s) ORDER BY 1, 2`)
}

// standing runs a two-column query over the followed members (%s is their quoted emails): email -> values.
func (cell *run) standing(ctx context.Context, statement string) (map[string][]string, error) {
	quoted := make([]string, 0, len(cell.legacyEmails()))
	for _, email := range cell.legacyEmails() {
		quoted = append(quoted, sqlQuote(email))
	}
	out, err := psql(ctx, cell.stores.psqlURL(), fmt.Sprintf(statement, strings.Join(quoted, ", ")))
	if err != nil {
		return nil, err
	}
	return parseStanding(out), nil
}

// parseStanding reads psql's unaligned rows (email|value) into email -> values.
func parseStanding(out string) map[string][]string {
	values := map[string][]string{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if email, value, found := strings.Cut(line, "|"); found {
			values[email] = append(values[email], value)
		}
	}
	return values
}

// legacyVerdicts (E8, E10) judge the legacy Auth0 member and everyone else after head's migrations.
func (cell *run) legacyVerdicts(ctx context.Context, final []LedgerRow) []Verdict {
	if !cell.profile.LegacySSO {
		return nil
	}
	if outstanding := len(Outstanding(final)); outstanding > 0 {
		detail := fmt.Sprintf("%d ledger rows outstanding: not yet after the migrations", outstanding)
		return []Verdict{{ID: "E8", Name: invariantNames["E8"], Result: "inconclusive", Detail: detail}, {ID: "E10", Name: invariantNames["E10"], Result: "inconclusive", Detail: detail}}
	}
	if cell.legacy.err != nil || cell.legacy.membership == nil {
		detail := "main's standing was never recorded: " + errText(cell.legacy.err) + "; " + errText(cell.sso.err)
		return []Verdict{verdict("E8", false, detail), verdict("E10", false, detail)}
	}
	after, err := cell.memberships(ctx)
	if err != nil {
		return []Verdict{{ID: "E8", Name: invariantNames["E8"], Result: "inconclusive", Detail: "memberships on head: " + err.Error()},
			{ID: "E10", Name: invariantNames["E10"], Result: "inconclusive", Detail: "memberships on head: " + err.Error()}}
	}
	after = withoutOrganizations(after, cell.odd.organizations()) // made by the overlay after main's standing was read
	email, password := generate.SeedAccount(cell.options.Seed)
	_, passwordErr := signIn(ctx, cell.url(), email, password)
	legacyMember := "member@" + ssoDomain
	results := append(append([]SSOResult{}, cell.sso.before...), cell.sso.after...)
	return []Verdict{
		judgeLegacy(legacyInput{Member: legacyMember, Results: results, Providers: cell.legacy.providers[legacyMember],
			Before: cell.legacy.membership[legacyMember], After: after[legacyMember], APIKey: cell.apiKeyAnswers(ctx)}),
		judgeOthers(othersInput{Emails: slices.DeleteFunc(cell.legacyEmails(), func(each string) bool { return each == legacyMember }),
			Before: cell.legacy.membership, After: after, Password: email, PasswordErr: passwordErr}),
	}
}

// apiKeyAnswers reads the seed project's prompts on head with its API key: nil when it answers 2xx.
func (cell *run) apiKeyAnswers(ctx context.Context) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cell.url()+"/api/prompts", nil)
	if err != nil {
		return err
	}
	request.Header.Set("X-Auth-Token", cell.client.APIKey)
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode/100 != 2 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 200))
		return fmt.Errorf("GET /api/prompts with the project key answered %d: %s", response.StatusCode, body)
	}
	return nil
}

type legacyInput struct {
	Member                   string
	Results                  []SSOResult
	Providers, Before, After []string
	APIKey                   error
}

// judgeLegacy (E8): the Auth0 member signed in on main and head, main holds their auth0 account, their
// organizations and roles are unchanged, and the project's API key answers.
func judgeLegacy(input legacyInput) Verdict {
	var failed []string
	seen := map[string]bool{}
	for _, result := range input.Results {
		if result.Member != input.Member {
			continue
		}
		seen[result.Phase+"/"+result.Check] = true
		if !result.OK {
			failed = append(failed, fmt.Sprintf("%s %s: %s", result.Phase, result.Check, result.Detail))
		}
	}
	for _, want := range []string{"main/signin", "head/signin"} {
		if !seen[want] {
			failed = append(failed, want+": never ran")
		}
	}
	if !slices.Contains(input.Providers, "auth0") {
		failed = append(failed, fmt.Sprintf("main holds no auth0 account for %s (providers %v)", input.Member, input.Providers))
	}
	failed = append(failed, membershipChange(input.Member, input.Before, input.After)...)
	if input.APIKey != nil {
		failed = append(failed, input.APIKey.Error())
	}
	if len(failed) > 0 {
		return verdict("E8", false, strings.Join(failed, "; "))
	}
	return verdict("E8", true, fmt.Sprintf("%s: auth0 account on main, signed in on main and head, memberships %v unchanged, API key answers", input.Member, input.After))
}

type othersInput struct {
	Emails        []string
	Before, After map[string][]string
	Password      string
	PasswordErr   error
}

// judgeOthers (E10): the password account signs in on head, and every other member keeps organizations and roles.
func judgeOthers(input othersInput) Verdict {
	var failed []string
	if input.PasswordErr != nil {
		failed = append(failed, "password sign-in on head as "+input.Password+": "+input.PasswordErr.Error())
	}
	for _, email := range input.Emails {
		failed = append(failed, membershipChange(email, input.Before[email], input.After[email])...)
	}
	if len(failed) > 0 {
		return verdict("E10", false, strings.Join(failed, "; "))
	}
	return verdict("E10", true, fmt.Sprintf("password sign-in on head; %d members keep their organizations and roles", len(input.Emails)))
}

// membershipChange names a member who held nothing on main, or whose organization:role set differs on head.
func membershipChange(email string, before, after []string) []string {
	switch {
	case len(before) == 0:
		return []string{email + " held no membership on main"}
	case !slices.Equal(before, after):
		return []string{fmt.Sprintf("%s memberships %v on main, %v on head", email, before, after)}
	}
	return nil
}
