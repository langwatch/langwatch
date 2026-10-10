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
	ssoDomain        = "acme" + ssoTenant + ".test"
	connectionTenant = "2"
	connectionDomain = "acme" + connectionTenant + ".test"
)

// IDPURL is the cell's idpsim, issuer base for every tenant.
func (stores Stores) IDPURL() string { return "http://127.0.0.1:" + itoa(stores.IDP) }

// ssoMember is one plain member the cell signs in through SSO, the door they use and, for a
// connection, its id.
type ssoMember struct {
	Email        string `json:"email"`
	InviteCode   string `json:"inviteCode"`
	Door         string `json:"door"`
	ConnectionID string `json:"connectionId,omitempty"`
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
	err          error // the deployment door (E6)
	connectionID string
	ceremony     error // the connection's activation (E7), naming the step that stopped it
}

// ssoDoors are the doors a cloud-sso cell judges: verdict id and the checks each must pass.
var ssoDoors = []struct{ door, id string }{{"deployment", "E6"}, {"connection", "E7"}}

// startIdentityProvider runs the cell's idpsim: two tenants, in memory, no DNS server.
func (cell *run) startIdentityProvider(ctx context.Context) error {
	binary, err := filepath.Abs(cell.options.ServiceBin)
	if err != nil {
		return err
	}
	if cell.stores.IDP, err = FreePort(); err != nil {
		return err
	}
	proc, err := Start(ProcSpec{Name: "idpsim", Dir: cell.options.RunDir, Log: cell.logPath("idpsim"), Args: []string{binary, "idpsim"},
		Env: Env(map[string]string{"PATH": os.Getenv("PATH"), "HOME": os.Getenv("HOME"), "SERVER_ADDR": "127.0.0.1:" + itoa(cell.stores.IDP),
			"IDPSIM_BASE_URL": cell.stores.IDPURL(), "IDPSIM_TENANTS": connectionTenant, "IDPSIM_DNS_ADDR": "off"})})
	if err != nil {
		return err
	}
	cell.addProc(proc)
	return waitFor(ctx, 30*time.Second, func() bool {
		status, _, err := get(ctx, httpClient, cell.stores.IDPURL()+"/t/"+connectionTenant+"/.well-known/openid-configuration")
		return err == nil && status == 200
	})
}

// seedSSO seeds both doors on main, then signs every seeded member in there.
func (cell *run) seedSSO(ctx context.Context) {
	member := "member@" + ssoDomain
	code, err := cell.seeder.Invite(ctx, member)
	if err == nil {
		_, err = cell.orgSQL(ctx, `UPDATE mydb."Organization" SET "ssoDomain" = '`+ssoDomain+`', "ssoProvider" = 'oidc' WHERE id = %s`)
	}
	if err != nil {
		cell.sso.err = err
	} else {
		cell.sso.members = append(cell.sso.members, ssoMember{Email: member, InviteCode: code, Door: "deployment"})
	}
	if cell.sso.ceremony = cell.activateConnection(ctx); cell.sso.ceremony == nil {
		member := "member@" + connectionDomain
		code, err := cell.seeder.Invite(ctx, member)
		if err != nil {
			cell.sso.ceremony = fmt.Errorf("invite %s: %w", member, err)
		} else {
			cell.sso.members = append(cell.sso.members, ssoMember{Email: member, InviteCode: code, Door: "connection", ConnectionID: cell.sso.connectionID})
		}
	}
	if len(cell.sso.members) > 0 {
		cell.sso.before = cell.ssoSignIn(ctx, "main", cell.sso.members)
	}
}

// orgSQL runs one statement against the seed organization; %s is its quoted id.
func (cell *run) orgSQL(ctx context.Context, statement string) (string, error) {
	return psql(ctx, cell.stores.psqlURL(), fmt.Sprintf(statement, "'"+strings.ReplaceAll(cell.seeder.Context.OrganizationID, "'", "''")+"'"))
}

// activateConnection walks main's go-live checklist for the seed organization as its admin would,
// returning the step that stopped it. Two steps have no door an admin could use in the lab: the
// subscription (Stripe) is SQL, and the domain is attested by the platform operator because main
// ignores SSO_DOMAIN_PROOF_DNS_SERVERS under NODE_ENV=production and its https-file fetch refuses loopback.
func (cell *run) activateConnection(ctx context.Context) error {
	org := cell.seeder.Context.OrganizationID
	if _, err := cell.orgSQL(ctx, `INSERT INTO mydb."Subscription" (id, "organizationId", plan, status, "startDate", "createdAt", "updatedAt") VALUES ('snap_sso_enterprise', %s, 'ENTERPRISE', 'ACTIVE', now(), now(), now())`); err != nil {
		return fmt.Errorf("enterprise subscription (SQL): %w", err)
	}
	var registered struct{ ConnectionID string }
	idp := map[string]any{"protocol": "oidc", "issuer": cell.stores.IDPURL() + "/t/" + connectionTenant, "clientId": "langwatch-upgradelab-connection",
		"clientSecret": "idpsim-accepts-any-secret-for-an-unregistered-client"}
	if err := cell.seeder.Call(ctx, true, "ssoSetup.register", map[string]any{"organizationId": org, "providerId": "idpsim", "idp": idp}, &registered); err != nil {
		return fmt.Errorf("ssoSetup.register: %w", err)
	}
	cell.sso.connectionID = registered.ConnectionID
	target := map[string]any{"organizationId": org, "connectionId": registered.ConnectionID}
	domain := map[string]any{"organizationId": org, "connectionId": registered.ConnectionID, "domain": connectionDomain}
	attest := map[string]any{"organizationId": org, "connectionId": registered.ConnectionID, "domain": connectionDomain,
		"evidenceRef": "upgradelab:idpsim-tenant-" + connectionTenant, "note": "upgradelab cell: the lab's domain cannot be proved by DNS under NODE_ENV=production"}
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
		cell.report.Notes = append(cell.report.Notes, "E7 ceremony: "+note)
	}
	tester := ssoMember{Email: "admin@" + connectionDomain, Door: "connection", ConnectionID: registered.ConnectionID}
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
func (cell *run) connectionOnHead(ctx context.Context) SSOResult {
	result := SSOResult{Phase: "head", Door: "connection", Check: "setup", URL: "ssoSetup.getSetup"}
	head := *cell.seeder
	head.PlainWire = true
	var setup struct {
		Connection *struct{ ConnectionID, State string } `json:"connection"`
	}
	if err := head.Call(ctx, false, "ssoSetup.getSetup", map[string]any{"organizationId": cell.seeder.Context.OrganizationID}, &setup); err != nil {
		result.Detail = err.Error()
		return result
	}
	if setup.Connection == nil {
		result.Detail = "head's setup read shows no connection"
		return result
	}
	result.OK = setup.Connection.ConnectionID == cell.sso.connectionID && setup.Connection.State == "ACTIVE"
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
		after = append(after, cell.connectionOnHead(ctx))
	}
	seeding := map[string]error{"deployment": cell.sso.err, "connection": cell.sso.ceremony}
	verdicts := make([]Verdict, 0, len(ssoDoors))
	for _, each := range ssoDoors {
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
	if door == "connection" {
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
