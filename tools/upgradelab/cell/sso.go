package cell

import (
	"bufio"
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

//go:embed sso-signin.mjs
var ssoScript []byte

// The deployment's own sign-in (E6) dials idpsim tenant 1; the organization's connection (E7) tenant 2.
// idpsim seeds admin@ and member@acme<tenant>.test in each.
const (
	ssoTenant        = "1"
	samlTenant       = "3" // legacy-sso profiles: a second organization's SAML connection
	samlDomain       = "acme" + samlTenant + ".test"
	ssoDomain        = "acme" + ssoTenant + ".test"
	connectionTenant = "2"
	connectionDomain = "acme" + connectionTenant + ".test"
)

// IDPURL is the cell's idpsim on its own port: the harness's control door.
func (stores Stores) IDPURL() string { return "http://127.0.0.1:" + itoa(stores.IDP) }

// IDPIssuer is the address the releases and the browser reach idpsim at: the TLS proxy when there is one.
func (stores Stores) IDPIssuer() string {
	if stores.IDPPublic != "" {
		return stores.IDPPublic
	}
	return stores.IDPURL()
}

// ssoMember is one plain member the cell signs in through SSO, the door they use and, for a
// connection, its id.
type ssoMember struct {
	Email        string `json:"email"`
	InviteCode   string `json:"inviteCode"`
	Door         string `json:"door"`
	ConnectionID string `json:"connectionId,omitempty"`
	Project      string `json:"project,omitempty"` // the project they land on, when not the seed project
}

// SSOResult is one line of sso-signin.mjs (or the cell's own setup read): one check of one member.
type SSOResult struct {
	Phase  string `json:"phase"`
	Member string `json:"member"`
	Door   string `json:"door"`
	Check  string `json:"check"`
	OK     bool   `json:"ok"`
	URL    string `json:"url"`
	Detail string `json:"detail"`
}

// ssoSeed is what seeding left: the members, main's results, and per door why seeding stopped.
type ssoSeed struct {
	members      []ssoMember
	before       []SSOResult
	after        []SSOResult // head's results, kept for the legacy verdicts
	err          error       // the deployment door (E6)
	connectionID string
	ceremony     error // the connection's activation (E7), naming the step that stopped it
	saml         connectionSpec
	samlErr      error // the SAML organization's ceremony (E9, legacy-sso profiles)
}

// connectionSpec is one organization's own SSO connection: where it lives, and the identity provider it trusts.
type connectionSpec struct {
	org, team, project, tenant, domain, subscription string
	idp                                              map[string]any
	connectionID                                     string
}

// ssoDoor is one door a cell with SSO judges and its verdict id.
type ssoDoor struct{ door, id string }

// ssoDoors are the doors a cell judges: legacy-sso profiles add the SAML organization (E9).
func (cell *run) ssoDoors() []ssoDoor {
	doors := []ssoDoor{{"deployment", "E6"}, {"connection", "E7"}}
	if cell.profile.LegacySSO {
		doors = append(doors, ssoDoor{"saml", "E9"})
	}
	return doors
}

// startIdentityProvider runs the cell's idpsim: two tenants, in memory, no DNS server.
func (cell *run) startIdentityProvider(ctx context.Context) error {
	binary, err := filepath.Abs(cell.options.ServiceBin)
	if err != nil {
		return err
	}
	if err := cell.ensureServiceBinary(ctx, binary); err != nil {
		return err
	}
	if cell.stores.IDP, err = FreePort(); err != nil {
		return err
	}
	tenants := connectionTenant
	if cell.profile.LegacySSO {
		tenants = samlTenant
	}
	// Every SSO profile, not only legacy: main's issuer discovery refuses a non-https issuer,
	// so an organization connection registered on main needs idpsim behind TLS (E7).
	if err := cell.startIdentityProxy(); err != nil {
		return fmt.Errorf("TLS proxy: %w", err)
	}
	proc, err := Start(ProcSpec{Name: "idpsim", Dir: cell.options.RunDir, Log: cell.logPath("idpsim"), Args: []string{binary, "idpsim"},
		Env: Env(map[string]string{"PATH": os.Getenv("PATH"), "HOME": os.Getenv("HOME"), "SERVER_ADDR": "127.0.0.1:" + itoa(cell.stores.IDP),
			"IDPSIM_BASE_URL": cell.stores.IDPIssuer(), "IDPSIM_TENANTS": tenants, "IDPSIM_DNS_ADDR": "off"})})
	if err != nil {
		return err
	}
	cell.addProc(proc)
	err = waitFor(ctx, 30*time.Second, func() bool {
		status, _, err := get(ctx, httpClient, cell.stores.IDPURL()+"/t/"+connectionTenant+"/.well-known/openid-configuration")
		return err == nil && status == 200
	})
	if err != nil || !cell.profile.LegacySSO {
		return err
	}
	return idpControl(ctx, cell.stores.IDPURL()+"/control/t/"+ssoTenant+"/legacy-provider", `{"provider":"auth0"}`)
}

// seedSSO seeds both doors on main, then signs every seeded member in there.
func (cell *run) seedSSO(ctx context.Context) {
	member := "member@" + ssoDomain
	code, err := cell.seeder.Invite(ctx, member)
	if err == nil {
		_, err = cell.orgSQL(ctx, `UPDATE mydb."Organization" SET "ssoDomain" = '`+ssoDomain+`', "ssoProvider" = '`+cell.deploymentProvider()+`' WHERE id = %s`)
	}
	if err != nil {
		cell.sso.err = err
	} else {
		cell.sso.members = append(cell.sso.members, ssoMember{Email: member, InviteCode: code, Door: "deployment"})
	}
	seedOrg := connectionSpec{org: cell.seeder.Context.OrganizationID, tenant: connectionTenant, domain: connectionDomain, subscription: "snap_sso_enterprise",
		idp: map[string]any{"protocol": "oidc", "issuer": cell.stores.IDPIssuer() + "/t/" + connectionTenant, "clientId": "langwatch-upgradelab-connection",
			"clientSecret": "idpsim-accepts-any-secret-for-an-unregistered-client"}}
	if cell.sso.ceremony = cell.activateConnection(ctx, &seedOrg); cell.sso.ceremony == nil {
		cell.sso.connectionID = seedOrg.connectionID
		member := "member@" + connectionDomain
		code, err := cell.seeder.Invite(ctx, member)
		if err != nil {
			cell.sso.ceremony = fmt.Errorf("invite %s: %w", member, err)
		} else {
			cell.sso.members = append(cell.sso.members, ssoMember{Email: member, InviteCode: code, Door: "connection", ConnectionID: cell.sso.connectionID})
		}
	}
	if cell.profile.LegacySSO {
		cell.seedSAMLOrganization(ctx)
	}
	if len(cell.sso.members) > 0 {
		cell.sso.before = cell.ssoSignIn(ctx, "main", cell.sso.members)
	}
	if cell.profile.SCIM {
		cell.seedLicensedSSO(ctx)
		cell.seedSCIM(ctx)
	}
	if cell.profile.LegacySSO {
		cell.seedLegacyOrganization(ctx) // before main's standing is read, so E10 counts the seed account's membership of it
		cell.legacyAtMain(ctx)
	}
}

// orgSQL runs one statement against the seed organization; %s is its quoted id.
func (cell *run) orgSQL(ctx context.Context, statement string) (string, error) {
	return cell.orgSQLFor(ctx, cell.seeder.Context.OrganizationID, statement)
}

func (cell *run) orgSQLFor(ctx context.Context, org, statement string) (string, error) {
	return psql(ctx, cell.stores.psqlURL(), fmt.Sprintf(statement, sqlQuote(org)))
}

// activateConnection walks main's go-live checklist for the seed organization as its admin would,
// returning the step that stopped it. Two steps have no door an admin could use in the lab: the
// subscription (Stripe) is SQL, and the domain is attested by the platform operator because main
// ignores SSO_DOMAIN_PROOF_DNS_SERVERS under NODE_ENV=production and its https-file fetch refuses loopback.
func (cell *run) activateConnection(ctx context.Context, spec *connectionSpec) error {
	org := spec.org
	if err := cell.grantEnterprise(ctx, org, spec.subscription); err != nil {
		return err
	}
	var registered struct{ ConnectionID string }
	if err := cell.seeder.Call(ctx, true, "ssoSetup.register", map[string]any{"organizationId": org, "providerId": "idpsim-" + spec.tenant, "idp": spec.idp}, &registered); err != nil {
		return fmt.Errorf("ssoSetup.register: %w", err)
	}
	spec.connectionID = registered.ConnectionID
	target := map[string]any{"organizationId": org, "connectionId": registered.ConnectionID}
	domain := map[string]any{"organizationId": org, "connectionId": registered.ConnectionID, "domain": spec.domain}
	attest := map[string]any{"organizationId": org, "connectionId": registered.ConnectionID, "domain": spec.domain,
		"evidenceRef": "upgradelab:idpsim-tenant-" + spec.tenant, "note": "upgradelab cell: the lab's domain cannot be proved by DNS under NODE_ENV=production"}
	steps := []struct {
		path  string
		input any
		soft  bool // already decided by the step before is fine
	}{
		{"ssoSetup.claimDomain", domain, false},
		{"ssoConnections.approveDomainClaim", domain, true},
		{"ssoConnections.attestDomain", attest, false},
		{"ssoSetup.setArrivals", map[string]any{"organizationId": org, "connectionId": registered.ConnectionID, "policy": "admit"}, false},
		{"ssoSetup.grantBreakGlass", map[string]any{"organizationId": org, "userId": fmt.Sprintf("snap_seed_user_%d", cell.options.Seed),
			"expiresAtMs": time.Now().Add(30 * 24 * time.Hour).UnixMilli()}, false},
	}
	var notes []string
	for _, step := range steps {
		if err := cell.seeder.Call(ctx, true, step.path, step.input, nil); err != nil {
			if !step.soft {
				return fmt.Errorf("%s: %w (after %v)", step.path, err, notes)
			}
			notes = append(notes, step.path+" refused: "+err.Error())
		}
	}
	for _, note := range notes {
		cell.report.Notes = append(cell.report.Notes, "connection ceremony on tenant "+spec.tenant+": "+note)
	}
	tester := ssoMember{Email: "admin@" + spec.domain, Door: "connection", ConnectionID: registered.ConnectionID}
	for _, result := range cell.ssoSignIn(ctx, "test-login", []ssoMember{tester}) {
		if !result.OK {
			return fmt.Errorf("test sign-in through the connection: %s %s", result.URL, result.Detail)
		}
	}
	if err := cell.seeder.Call(ctx, true, "ssoSetup.activate", target, nil); err != nil {
		return fmt.Errorf("ssoSetup.activate: %w", err)
	}
	return nil
}

// ssoSignIn runs sso-signin.mjs for members; a script that never answers is one failed result.
func (cell *run) ssoSignIn(ctx context.Context, phase string, members []ssoMember) []SSOResult {
	script := filepath.Join(cell.options.RunDir, "sso-signin.mjs")
	if err := os.WriteFile(script, ssoScript, 0o600); err != nil {
		return []SSOResult{{Phase: phase, Check: "script", Detail: err.Error()}}
	}
	args, _ := json.Marshal(map[string]any{"url": cell.url(), "phase": phase, "project": cell.seeder.Context.ProjectSlug,
		"stateDir": filepath.Join(cell.options.RunDir, "sso"), "shots": filepath.Join(cell.options.RunDir, "shots"), "members": members})
	runCtx, cancel := context.WithTimeout(ctx, 6*time.Minute)
	defer cancel()
	command := exec.CommandContext(runCtx, "node", script, string(args)) // #nosec G204 -- harness-written script.
	command.Dir = filepath.Join(cell.options.HeadDir, "apps", "ui")
	if cell.stores.IDPCA != "" {
		command.Env = append(os.Environ(), "NODE_EXTRA_CA_CERTS="+cell.stores.IDPCA)
	}
	output, err := command.Output()
	var results []SSOResult
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		var result SSOResult
		if json.Unmarshal(scanner.Bytes(), &result) == nil {
			results = append(results, result)
		}
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		err = fmt.Errorf("%w: %s", err, tail(exit.Stderr))
	}
	if err != nil || len(results) == 0 {
		results = append(results, SSOResult{Phase: phase, Check: "script", Detail: fmt.Sprintf("sso-signin.mjs: %v", err)})
	}
	return results
}

// connectionOnHead asks head's setup read, as the seed admin with main's session, whether the connection is still ACTIVE.
func (cell *run) connectionOnHead(ctx context.Context, door, org, connectionID string) SSOResult {
	result := SSOResult{Phase: "head", Door: door, Check: "setup", URL: "ssoSetup.getSetup"}
	head := *cell.seeder
	head.PlainWire = true
	var setup struct {
		Connection *struct{ ConnectionID, State string } `json:"connection"`
	}
	if err := head.Call(ctx, false, "ssoSetup.getSetup", map[string]any{"organizationId": org}, &setup); err != nil {
		result.Detail = err.Error()
		return result
	}
	if setup.Connection == nil {
		result.Detail = "head's setup read shows no connection"
		return result
	}
	result.OK = setup.Connection.ConnectionID == connectionID && setup.Connection.State == "ACTIVE"
	result.Detail = fmt.Sprintf("connection %s is %s", setup.Connection.ConnectionID, setup.Connection.State)
	return result
}

// ssoVerdicts signs every member in again on head once the ledger is done: E6 the deployment's door, E7 the connection's.
func (cell *run) ssoVerdicts(ctx context.Context, final []LedgerRow) []Verdict {
	if !cell.profile.SSO {
		return nil
	}
	var after []SSOResult
	if len(cell.sso.members) > 0 {
		after = cell.ssoSignIn(ctx, "head", cell.sso.members)
	}
	if cell.sso.connectionID != "" && cell.sso.ceremony == nil {
		after = append(after, cell.connectionOnHead(ctx, "connection", cell.seeder.Context.OrganizationID, cell.sso.connectionID))
	}
	if cell.sso.saml.connectionID != "" && cell.sso.samlErr == nil {
		after = append(after, cell.connectionOnHead(ctx, "saml", cell.sso.saml.org, cell.sso.saml.connectionID))
	}
	cell.sso.after = after
	seeding := map[string]error{"deployment": cell.sso.err, "connection": cell.sso.ceremony, "saml": cell.sso.samlErr}
	doors := cell.ssoDoors()
	verdicts := make([]Verdict, 0, len(doors))
	for _, each := range doors {
		switch {
		case seeding[each.door] != nil:
			verdicts = append(verdicts, verdict(each.id, false, "seeding on main stopped at "+seeding[each.door].Error()))
		case cell.sso.before == nil:
			verdicts = append(verdicts, Verdict{ID: each.id, Name: invariantNames[each.id], Result: "inconclusive", Detail: "no SSO member seeded on main (a cell from a snapshot seeds none)"})
		default:
			verdicts = append(verdicts, judgeSSO(each.id, each.door, append(append([]SSOResult{}, cell.sso.before...), after...), len(Outstanding(final))))
		}
	}
	return verdicts
}

// judgeSSO passes a door when its member signed in on main and on head and main's cookie read
// cleanly on head; the connection's door also needs head's setup read to show it ACTIVE.
func judgeSSO(id, door string, results []SSOResult, outstanding int) Verdict {
	if outstanding > 0 {
		return Verdict{ID: id, Name: invariantNames[id], Result: "inconclusive", Detail: fmt.Sprintf("%d ledger rows outstanding: not yet after the migrations", outstanding)}
	}
	wants := []string{"main/signin", "head/cookie", "head/signin"}
	if door == "connection" || door == "saml" {
		wants = append(wants, "head/setup")
	}
	var failed []string
	seen, checks := map[string]bool{}, 0
	for _, result := range results {
		if result.Door != door && result.Check != "script" {
			continue
		}
		checks++
		seen[result.Phase+"/"+result.Check] = true
		if !result.OK {
			failed = append(failed, fmt.Sprintf("%s %s %s: %s %s", result.Phase, result.Member, result.Check, result.URL, result.Detail))
		}
	}
	for _, want := range wants {
		if !seen[want] {
			failed = append(failed, want+": never ran")
		}
	}
	if len(failed) > 0 {
		return verdict(id, false, strings.Join(failed, "; "))
	}
	return verdict(id, true, fmt.Sprintf("%d checks passed: signed in on main and on head, main's cookie read cleanly on head", checks))
}
