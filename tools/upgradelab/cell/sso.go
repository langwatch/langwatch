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

// ssoTenant is the idpsim tenant the deployment signs in through; idpsim seeds member@acme<tenant>.test.
const (
	ssoTenant = "1"
	ssoDomain = "acme" + ssoTenant + ".test"
)

// IDPURL is the cell's idpsim, issuer base for every tenant.
func (stores Stores) IDPURL() string { return "http://127.0.0.1:" + itoa(stores.IDP) }

// ssoMember is one plain member the cell signs in through SSO, and the door they use.
type ssoMember struct {
	Email      string `json:"email"`
	InviteCode string `json:"inviteCode"`
	Door       string `json:"door"`
}

// SSOResult is one line of sso-signin.mjs: a member's sign-in, or main's cookie read on head.
type SSOResult struct {
	Phase  string `json:"phase"`
	Member string `json:"member"`
	Door   string `json:"door"`
	Check  string `json:"check"`
	OK     bool   `json:"ok"`
	URL    string `json:"url"`
	Detail string `json:"detail"`
}

// ssoSeed is what seeding the SSO members left: the members, main's results, or why seeding stopped.
type ssoSeed struct {
	members []ssoMember
	before  []SSOResult
	err     error
}

// startIdentityProvider runs the cell's idpsim: one tenant, in memory, no DNS server.
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
			"IDPSIM_BASE_URL": cell.stores.IDPURL(), "IDPSIM_TENANTS": "1", "IDPSIM_DNS_ADDR": "off"})})
	if err != nil {
		return err
	}
	cell.addProc(proc)
	return waitFor(ctx, 30*time.Second, func() bool {
		status, _, err := get(ctx, httpClient, cell.stores.IDPURL()+"/t/"+ssoTenant+"/.well-known/openid-configuration")
		return err == nil && status == 200
	})
}

// seedSSO invites idpsim's member into the seed team, pins the seed organization's domain to the
// deployment's provider (main's legacy columns) and signs the member in on main.
func (cell *run) seedSSO(ctx context.Context) {
	member := "member@" + ssoDomain
	code, err := cell.seeder.Invite(ctx, member)
	if err == nil {
		_, err = psql(ctx, cell.stores.psqlURL(), fmt.Sprintf(`UPDATE mydb."Organization" SET "ssoDomain" = '%s', "ssoProvider" = 'oidc' WHERE id = '%s'`,
			ssoDomain, strings.ReplaceAll(cell.seeder.Context.OrganizationID, "'", "''")))
	}
	if err != nil {
		cell.sso.err = err
		return
	}
	cell.sso.members = []ssoMember{{Email: member, InviteCode: code, Door: "deployment"}}
	cell.sso.before = cell.ssoSignIn(ctx, "main")
}

// ssoSignIn runs sso-signin.mjs for every member; a script that never answers is one failed result.
func (cell *run) ssoSignIn(ctx context.Context, phase string) []SSOResult {
	script := filepath.Join(cell.options.RunDir, "sso-signin.mjs")
	if err := os.WriteFile(script, ssoScript, 0o600); err != nil {
		return []SSOResult{{Phase: phase, Check: "script", Detail: err.Error()}}
	}
	args, _ := json.Marshal(map[string]any{"url": cell.url(), "phase": phase, "project": cell.seeder.Context.ProjectSlug,
		"stateDir": filepath.Join(cell.options.RunDir, "sso"), "shots": filepath.Join(cell.options.RunDir, "shots"), "members": cell.sso.members})
	runCtx, cancel := context.WithTimeout(ctx, 4*time.Minute)
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

// ssoVerdicts signs the members in again on head once the ledger is done (E6). E7 waits for a seedable connection.
func (cell *run) ssoVerdicts(ctx context.Context, final []LedgerRow) []Verdict {
	if !cell.profile.SSO {
		return nil
	}
	connection := Verdict{ID: "E7", Name: invariantNames["E7"], Result: "inconclusive",
		Detail: "no headless seed for an organization's own connection: activating one on main needs a domain proof, a recorded test login and a break-glass binding"}
	switch {
	case cell.sso.err != nil:
		return []Verdict{verdict("E6", false, "seeding the SSO member on main: "+cell.sso.err.Error()), connection}
	case len(cell.sso.members) == 0:
		return []Verdict{{ID: "E6", Name: invariantNames["E6"], Result: "inconclusive", Detail: "no SSO member seeded on main (a cell from a snapshot seeds none)"}, connection}
	}
	return []Verdict{judgeSSO(cell.sso.before, cell.ssoSignIn(ctx, "head"), len(Outstanding(final))), connection}
}

// judgeSSO passes when every member signed in on main and on head and main's cookie read cleanly on head.
func judgeSSO(before, after []SSOResult, outstanding int) Verdict {
	if outstanding > 0 {
		return Verdict{ID: "E6", Name: invariantNames["E6"], Result: "inconclusive", Detail: fmt.Sprintf("%d ledger rows outstanding: not yet after the migrations", outstanding)}
	}
	var failed []string
	seen := map[string]bool{}
	for _, result := range append(append([]SSOResult{}, before...), after...) {
		seen[result.Phase+"/"+result.Check] = seen[result.Phase+"/"+result.Check] || result.OK
		if !result.OK {
			failed = append(failed, fmt.Sprintf("%s %s %s: %s %s", result.Phase, result.Member, result.Check, result.URL, result.Detail))
		}
	}
	for _, want := range []string{"main/signin", "head/cookie", "head/signin"} {
		if _, ok := seen[want]; !ok {
			failed = append(failed, want+": never ran")
		}
	}
	if len(failed) > 0 {
		return verdict("E6", false, strings.Join(failed, "; "))
	}
	return verdict("E6", true, fmt.Sprintf("%d checks passed: signed in on main and on head, main's cookie read cleanly on head", len(before)+len(after)))
}
