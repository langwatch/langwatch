package cell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/generate"
)

// E11: an organization on main's OLD per-organization SSO, the legacy columns only (ssoDomain + ssoProvider) and
// no connection. Its people sign in through the deployment's Auth0 under an Auth0 enterprise connection the org
// pins by prefix (main's isSsoProviderMatch), the shape `identity-d04-connection-grandfather` carries over.
const (
	legacyOrgDomain    = "acme4.test"
	legacyOrgProvider  = "samlp|idpsim-t" + ssoTenant // idpsim tenant 1 mints samlp|idpsim-t1|<user id> while switched
	legacyOrgUserID    = "legacy-org-member"
	legacyOrgMember    = "member@" + legacyOrgDomain
	legacyOrgDoor      = "legacy-org"
	grandfatherStep    = "identity-d04-connection-grandfather"
	migrationInventory = "Migration inventory"
	ssoSettingsPath    = "/settings/authentication/provider"
	legacyHint         = "onto your connection"
)

// legacyOrgSeed is the legacy organization as main left it: who it is, its member's standing and main's sign-in.
type legacyOrgSeed struct {
	org, team, slug, name string
	member                ssoMember
	accounts, membership  []string // main: provider:accountId, organization:role
	before                []SSOResult
	err                   error // seeding stopped
}

// seedLegacyOrganization makes the organization through main's door, pins acme4.test to the Auth0 enterprise
// connection through the legacy columns (main had no door for them but staff SQL), and signs its member in on main.
func (cell *run) seedLegacyOrganization(ctx context.Context) {
	seed := &cell.legacyOrg
	seed.err = func() error {
		seed.name = "Legacy SSO " + cell.options.Name()
		made, err := cell.newOrganization(ctx, seed.name)
		if err != nil {
			return fmt.Errorf("organization: %w", err)
		}
		seed.org, seed.team, seed.slug = made.org, made.team, made.slug
		if err := cell.grantEnterprise(ctx, seed.org, "snap_sso_legacy_enterprise"); err != nil {
			return err
		}
		if _, err := cell.orgSQLFor(ctx, seed.org, `UPDATE mydb."Organization" SET "ssoDomain" = '`+legacyOrgDomain+`', "ssoProvider" = '`+legacyOrgProvider+`' WHERE id = %s`); err != nil {
			return fmt.Errorf("legacy columns (SQL): %w", err)
		}
		user, _ := json.Marshal(map[string]string{"id": legacyOrgUserID, "email": legacyOrgMember, "name": "Legacy Member"})
		if err := idpControl(ctx, cell.stores.IDPURL()+"/control/t/"+ssoTenant+"/users", string(user)); err != nil {
			return fmt.Errorf("idpsim user: %w", err)
		}
		code, err := cell.seeder.InviteTo(ctx, legacyOrgMember, seed.org, seed.team)
		if err != nil {
			return fmt.Errorf("invite %s: %w", legacyOrgMember, err)
		}
		seed.member = ssoMember{Email: legacyOrgMember, InviteCode: code, Door: legacyOrgDoor, Project: seed.slug}
		if seed.before, err = cell.legacyOrgSignIn(ctx, "main"); err != nil {
			return err
		}
		if seed.accounts, err = cell.legacyOrgStanding(ctx, `SELECT a.provider || ':' || a."providerAccountId" FROM mydb."Account" a JOIN mydb."User" u ON u.id = a."userId" WHERE u.email = '`+legacyOrgMember+`' ORDER BY 1`); err != nil {
			return fmt.Errorf("accounts on main: %w", err)
		}
		seed.membership, err = cell.legacyOrgStanding(ctx, `SELECT ou."organizationId" || ':' || ou.role FROM mydb."OrganizationUser" ou JOIN mydb."User" u ON u.id = ou."userId" WHERE u.email = '`+legacyOrgMember+`' ORDER BY 1`)
		return err
	}()
	if seed.err == nil {
		cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("E11 legacy organization %s (%q, project %s): ssoDomain %s, ssoProvider %s", seed.org, seed.name, seed.slug, legacyOrgDomain, legacyOrgProvider))
	}
}

// legacyOrgSignIn signs the member in with idpsim's tenant minting the enterprise-connection subject, then switches it back
// so the deployment's own Auth0 member (E8) keeps their auth0| subject.
func (cell *run) legacyOrgSignIn(ctx context.Context, phase string) ([]SSOResult, error) {
	config := cell.stores.IDPURL() + "/control/t/" + ssoTenant + "/config"
	if err := idpControl(ctx, config, `{"samlpSubjects":true}`); err != nil {
		return nil, fmt.Errorf("idpsim samlp subjects on: %w", err)
	}
	results := cell.ssoSignIn(ctx, phase, []ssoMember{cell.legacyOrg.member})
	return results, idpControl(ctx, config, `{"samlpSubjects":false}`)
}

func (cell *run) legacyOrgStanding(ctx context.Context, statement string) ([]string, error) {
	out, err := psql(ctx, cell.stores.psqlURL(), statement)
	if err != nil {
		return nil, err
	}
	return strings.Fields(strings.TrimSpace(out)), nil
}

// legacyOrgVerdict (E11) runs once the ledger is done: the grandfather's tenant row, the connection it made, the member's
// sign-in on head and Ops > SSO connections showing the connection's migration inventory.
func (cell *run) legacyOrgVerdict(ctx context.Context, final []LedgerRow) []Verdict {
	if !cell.profile.LegacySSO {
		return nil
	}
	seed := cell.legacyOrg
	switch {
	case seed.err != nil:
		return []Verdict{verdict("E11", false, "seeding on main stopped at "+seed.err.Error())}
	case seed.org == "":
		return []Verdict{{ID: "E11", Name: invariantNames["E11"], Result: "inconclusive", Detail: "no legacy organization seeded on main (a cell from a snapshot seeds none)"}}
	case len(Outstanding(final)) > 0:
		return []Verdict{{ID: "E11", Name: invariantNames["E11"], Result: "inconclusive", Detail: fmt.Sprintf("%d ledger rows outstanding: not yet after the migrations", len(Outstanding(final)))}}
	}
	input := legacyOrgInput{Org: seed.org, Domain: legacyOrgDomain, AccountsBefore: seed.accounts, Before: seed.membership}
	input.Tenant, input.TenantErr = cell.legacyOrgStanding(ctx, `SELECT status || ':' || coalesce(report->>'kind', '') FROM mydb."SystemMigrationTenantState" WHERE "migrationName" = '`+grandfatherStep+`' AND "tenantId" = `+sqlQuote(seed.org))
	input.Connections, input.ConnectionsErr = cell.legacyOrgStanding(ctx, `SELECT id || ':' || state || ':' || array_to_string("claimedDomains" || "verifiedDomains", ',') FROM mydb."SsoConnection" WHERE "organizationId" = `+sqlQuote(seed.org)+` ORDER BY 1`)
	after, err := cell.legacyOrgSignIn(ctx, "head")
	if err != nil {
		after = append(after, SSOResult{Phase: "head", Member: legacyOrgMember, Door: legacyOrgDoor, Check: "script", Detail: err.Error()})
	}
	input.Results = append(append([]SSOResult{}, seed.before...), after...)
	input.After, input.AfterErr = cell.legacyOrgStanding(ctx, `SELECT ou."organizationId" || ':' || ou.role FROM mydb."OrganizationUser" ou JOIN mydb."User" u ON u.id = ou."userId" WHERE u.email = '`+legacyOrgMember+`' ORDER BY 1`)
	input.AccountsAfter, _ = cell.legacyOrgStanding(ctx, `SELECT a.provider || ':' || a."providerAccountId" FROM mydb."Account" a JOIN mydb."User" u ON u.id = a."userId" WHERE u.email = '`+legacyOrgMember+`' ORDER BY 1`)
	input.Ops, input.OpsErr = cell.opsPage(ctx, "ops-sso-connections-legacy", "/ops/sso-connections", seed.name, migrationInventory)
	hint, hintErr := cell.opsPage(ctx, "sso-settings-legacy-hint", ssoSettingsPath, "", "")
	return []Verdict{judgeLegacyOrg(input), judgeLegacyHint(hint, hintErr)}
}

// judgeLegacyHint (E15): the seed organization is the mixed shape (main's deployment-wide pin beside its own
// connection); its administrator sees, in SSO settings, the hint to move the legacy domain onto the connection.
func judgeLegacyHint(text string, err error) Verdict {
	switch {
	case err != nil:
		return verdict("E15", false, ssoSettingsPath+": "+err.Error())
	case !strings.Contains(text, legacyHint):
		return verdict("E15", false, fmt.Sprintf("%s shows no %q (shots/sso-settings-legacy-hint.png)", ssoSettingsPath, legacyHint))
	}
	return verdict("E15", true, fmt.Sprintf("the seed account sees %q on %s", legacyHint, ssoSettingsPath))
}

// opsPage screenshots one Ops page as the seed account (an operator on head), opening the row showing open; it
// returns the page's text.
func (cell *run) opsPage(ctx context.Context, name, path, open, expect string) (string, error) {
	email, password := generate.SeedAccount(cell.options.Seed)
	return cell.opsPageAs(ctx, opsPageInput{name: name, email: email, password: password, path: path, open: open, expect: expect})
}

type opsPageInput struct{ name, email, password, path, open, expect string }

// opsPageAs screenshots one page signed in as any account and returns the page's text.
func (cell *run) opsPageAs(ctx context.Context, input opsPageInput) (string, error) {
	name, email, password, path, open, expect := input.name, input.email, input.password, input.path, input.open, input.expect
	out := filepath.Join(cell.options.RunDir, "shots", name+".png")
	args, _ := json.Marshal(map[string]any{"url": cell.url(), "email": email, "password": password, "out": out, "signIn": true,
		"path": path, "open": open, "expect": expect})
	script := filepath.Join(cell.options.RunDir, "ops-upgrades.mjs")
	if err := os.WriteFile(script, opsScript, 0o600); err != nil {
		return "", err
	}
	shotCtx, cancel := context.WithTimeout(ctx, 4*time.Minute)
	defer cancel()
	command := exec.CommandContext(shotCtx, "node", script, string(args)) // #nosec G204 -- harness-written script.
	command.Dir = filepath.Join(cell.options.HeadDir, "apps", "ui")
	output, err := command.Output()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		err = fmt.Errorf("%w: %s", err, tail(exit.Stderr))
	}
	var page struct{ URL, Text string }
	if err == nil {
		err = json.Unmarshal(output, &page)
	}
	cell.addShot(Shot{Phase: name, AtMs: time.Since(cell.origin).Milliseconds(), File: filepath.Join("shots", name+".png"), URL: page.URL})
	return page.Text, err
}

type legacyOrgInput struct {
	Org, Domain                   string
	Tenant, Connections           []string // status:kind; id:state:domains
	TenantErr, ConnectionsErr     error
	Results                       []SSOResult
	Before, After                 []string // organization:role
	AfterErr                      error
	AccountsBefore, AccountsAfter []string
	Ops                           string
	OpsErr                        error
}

// judgeLegacyOrg (E11): (a) the grandfather finalized the organization, (b) it holds a connection for its domain,
// (c) its member signed in on main and on head with the same organization, role and account, (d) Ops shows the inventory.
func judgeLegacyOrg(input legacyOrgInput) Verdict {
	var failed, passed []string
	switch {
	case input.TenantErr != nil:
		failed = append(failed, "(a) tenant state: "+input.TenantErr.Error())
	case len(input.Tenant) != 1 || !strings.HasPrefix(input.Tenant[0], "finalized:"):
		failed = append(failed, fmt.Sprintf("(a) %s for %s is %v, want finalized", grandfatherStep, input.Org, input.Tenant))
	default:
		passed = append(passed, "(a) "+grandfatherStep+" "+input.Tenant[0])
	}
	connection := slices.IndexFunc(input.Connections, func(row string) bool { return strings.Contains(row, input.Domain) })
	switch {
	case input.ConnectionsErr != nil:
		failed = append(failed, "(b) connections: "+input.ConnectionsErr.Error())
	case connection < 0:
		failed = append(failed, fmt.Sprintf("(b) no connection of %s names %s: %v", input.Org, input.Domain, input.Connections))
	default:
		passed = append(passed, "(b) connection "+input.Connections[connection])
	}
	seen := map[string]bool{}
	for _, result := range input.Results {
		seen[result.Phase+"/"+result.Check] = seen[result.Phase+"/"+result.Check] || result.OK
		if !result.OK {
			failed = append(failed, fmt.Sprintf("(c) %s %s: %s %s", result.Phase, result.Check, result.URL, result.Detail))
		}
	}
	for _, want := range []string{"main/signin", "head/cookie", "head/signin"} {
		if !seen[want] {
			failed = append(failed, "(c) "+want+": never passed")
		}
	}
	if input.AfterErr != nil {
		failed = append(failed, "(c) memberships on head: "+input.AfterErr.Error())
	} else {
		failed = append(failed, membershipChange(legacyOrgMember, input.Before, input.After)...)
	}
	if !slices.ContainsFunc(input.AccountsBefore, func(account string) bool { return strings.HasPrefix(account, "auth0:"+legacyOrgProvider+"|") }) {
		failed = append(failed, fmt.Sprintf("(c) main holds no Auth0 account under %s: %v", legacyOrgProvider, input.AccountsBefore))
	}
	if !slices.Equal(input.AccountsBefore, input.AccountsAfter) {
		failed = append(failed, fmt.Sprintf("(c) accounts %v on main, %v on head", input.AccountsBefore, input.AccountsAfter))
	}
	switch {
	case input.OpsErr != nil:
		failed = append(failed, "(d) Ops > SSO connections: "+input.OpsErr.Error())
	case !strings.Contains(input.Ops, migrationInventory):
		failed = append(failed, "(d) Ops > SSO connections shows no "+migrationInventory)
	default:
		passed = append(passed, "(d) Ops shows "+migrationInventory)
	}
	if len(failed) > 0 {
		return verdict("E11", false, strings.Join(failed, "; "))
	}
	return verdict("E11", true, strings.Join(append(passed, fmt.Sprintf("(c) %s signed in on main and head, %v unchanged, account %v", legacyOrgMember, input.After, input.AccountsAfter)), "; "))
}
