package cell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
)

// E12: a password on an address an ACTIVE connection governs (no recovery grant) opens no session on head
// (specs/identity/sso-credential-enforcement.feature). E13: a custom role main made keeps its permissions and bindings.
const (
	governedMember = "member@" + connectionDomain
	customRoleName = "Upgradelab analyst"
	roleMember     = "analyst@" + connectionDomain
)

var customRolePermissions = []string{"analytics:view", "datasets:view", "traces:view"}

// licensedSSOSeed is what main left for E12 and E13.
type licensedSSOSeed struct {
	passwordErr     error          // seeding the governed password stopped
	mainProbe       PasswordAnswer // main's answer to that password, for the record
	roleID          string
	roleBefore      []string // permissions, then principal:scope bindings
	roleErr         error
	roleMember      ssoMember
	roleMainLanding string // failed main sign-in details after the role was assigned, empty when it landed
}

// PasswordAnswer is one email/password sign-in attempt: the status, whether a session cookie came back, the body's head.
type PasswordAnswer struct {
	Status  int
	Session bool
	Body    string
}

func governedPassword(seed int64) string { return fmt.Sprintf("upgradelab-governed-password-%d", seed) }

// seedLicensedSSO runs after the members signed in on main: the governed password, then the custom role.
func (cell *run) seedLicensedSSO(ctx context.Context) {
	extras := &cell.extras
	extras.passwordErr = func() error {
		if cell.sso.ceremony != nil {
			return fmt.Errorf("no ACTIVE connection: %w", cell.sso.ceremony)
		}
		statement := "SET search_path TO mydb;\nBEGIN;\nCREATE SCHEMA upgradelab_crypto;\nCREATE EXTENSION pgcrypto SCHEMA upgradelab_crypto;\n" +
			`INSERT INTO "Account" (id, "userId", type, provider, issuer, "providerAccountId", password) SELECT 'upgradelab_governed_password', u.id, 'credentials', 'credential', 'local:credential', u.id, ` +
			"'$2b$' || substr(upgradelab_crypto.crypt(" + sqlQuote(governedPassword(cell.options.Seed)) + ", upgradelab_crypto.gen_salt('bf', 10)), 5) FROM \"User\" u WHERE u.email = " + sqlQuote(governedMember) + ";\n" +
			"DROP SCHEMA upgradelab_crypto CASCADE;\nCOMMIT;\n"
		if err := psqlFile(ctx, cell.stores.psqlURL(), statement); err != nil {
			return fmt.Errorf("credential account (SQL): %w", err)
		}
		extras.mainProbe = passwordProbe(ctx, cell.url(), governedMember, governedPassword(cell.options.Seed))
		return nil
	}()
	extras.roleErr = cell.seedCustomRole(ctx)
}

// seedCustomRole makes the role through main's door and assigns it on the seed team to its own member (an SSO
// invitee of the connection), so E7's member keeps a built-in role. The member signs in on main again after.
func (cell *run) seedCustomRole(ctx context.Context) error {
	org := cell.seeder.Context.OrganizationID
	analyst := ssoMember{Email: roleMember, Door: "role", ConnectionID: cell.sso.connectionID}
	code, err := cell.seeder.Invite(ctx, roleMember)
	if err != nil {
		return fmt.Errorf("invite %s: %w", roleMember, err)
	}
	analyst.InviteCode = code
	user, _ := json.Marshal(map[string]string{"id": "role-member", "email": roleMember, "name": "Role Member"})
	if _, err := idpCall(ctx, http.MethodPost, cell.idpTenant()+"/users", string(user)); err != nil {
		return fmt.Errorf("idpsim user %s: %w", roleMember, err)
	}
	cell.extras.roleMember = analyst
	failed := failedSignIns(cell.ssoSignIn(ctx, "main", []ssoMember{analyst}))
	if failed != "" { // once more: under load the redirect to idpsim can outlast the script's waits
		cell.report.Notes = append(cell.report.Notes, "E13 "+roleMember+" first join on main failed, retried: "+failed)
		failed = failedSignIns(cell.ssoSignIn(ctx, "main", []ssoMember{analyst}))
	}
	if failed != "" {
		return fmt.Errorf("%s joins on main: %s", roleMember, failed)
	}
	var role struct {
		ID string `json:"id"`
	}
	input := map[string]any{"organizationId": org, "name": customRoleName, "description": "upgradelab T5", "permissions": customRolePermissions}
	if err := cell.seeder.Call(ctx, true, "role.create", input, &role); err != nil {
		return fmt.Errorf("role.create: %w", err)
	}
	if role.ID == "" {
		return errors.New("role.create answered no id")
	}
	cell.extras.roleID = role.ID
	users, err := cell.legacyOrgStanding(ctx, `SELECT id FROM mydb."User" WHERE email = `+sqlQuote(roleMember))
	if err != nil || len(users) != 1 {
		return fmt.Errorf("user %s: %v %w", roleMember, users, err)
	}
	assign := map[string]any{"userId": users[0], "teamId": cell.seeder.Context.TeamID, "customRoleId": role.ID}
	if err := cell.seeder.Call(ctx, true, "role.assignToUser", assign, nil); err != nil {
		return fmt.Errorf("role.assignToUser: %w", err)
	}
	analyst.InviteCode = ""
	cell.extras.roleMainLanding = failedSignIns(cell.ssoSignIn(ctx, "main-role", []ssoMember{analyst}))
	cell.extras.roleBefore, err = cell.customRoleStanding(ctx)
	return err
}

// failedSignIns is the details of every failed result, empty when all signed in.
func failedSignIns(results []SSOResult) string {
	var failed []string
	for _, result := range results {
		if !result.OK {
			failed = append(failed, result.Check+": "+result.Detail)
		}
	}
	if len(results) == 0 {
		return "no result"
	}
	return strings.Join(failed, "; ")
}

// customRoleStanding is the role's sorted permissions, then its bindings as principal:scopeType:scopeId.
func (cell *run) customRoleStanding(ctx context.Context) ([]string, error) {
	id := sqlQuote(cell.extras.roleID)
	permissions, err := cell.legacyOrgStanding(ctx, `SELECT 'permission:' || p FROM mydb."CustomRole" r, jsonb_array_elements_text(r.permissions::jsonb) p WHERE r.id = `+id+` ORDER BY 1`)
	if err != nil {
		return nil, err
	}
	bindings, err := cell.legacyOrgStanding(ctx, `SELECT 'binding:' || coalesce(b."userId", b."groupId", b."apiKeyId", '') || ':' || b."scopeType" || ':' || b."scopeId" FROM mydb."RoleBinding" b WHERE b."customRoleId" = `+id+` ORDER BY 1`)
	return append(permissions, bindings...), err
}

// passwordProbe posts one email/password sign-in and reports what came back; a transport error is status 0.
func passwordProbe(ctx context.Context, origin, email, password string) PasswordAnswer {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/api/auth/sign-in/email",
		strings.NewReader(fmt.Sprintf(`{"email":%q,"password":%q}`, email, password)))
	if err != nil {
		return PasswordAnswer{Body: err.Error()}
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Origin", origin)
	response, err := httpClient.Do(request)
	if err != nil {
		return PasswordAnswer{Body: err.Error()}
	}
	defer func() { _ = response.Body.Close() }()
	answer := PasswordAnswer{Status: response.StatusCode}
	for _, value := range response.Header.Values("Set-Cookie") {
		answer.Session = answer.Session || sessionCookie.MatchString(value)
	}
	body := make([]byte, 300)
	n, _ := response.Body.Read(body)
	answer.Body = string(body[:n])
	return answer
}

// licensedSSOVerdicts judges E12 and E13 once the ledger is done.
func (cell *run) licensedSSOVerdicts(ctx context.Context, final []LedgerRow) []Verdict {
	if !cell.profile.SCIM {
		return nil
	}
	outstanding := len(Outstanding(final))
	extras := cell.extras
	var head PasswordAnswer
	if extras.passwordErr == nil && outstanding == 0 {
		head = passwordProbe(ctx, cell.url(), governedMember, governedPassword(cell.options.Seed))
	}
	var after []string
	var afterErr error
	headLanding := ""
	if extras.roleErr == nil && outstanding == 0 {
		after, afterErr = cell.customRoleStanding(ctx)
		headLanding = failedSignIns(cell.ssoSignIn(ctx, "head", []ssoMember{extras.roleMember}))
	}
	return []Verdict{
		JudgePasswordClosed(PasswordInput{SeedErr: extras.passwordErr, Main: extras.mainProbe, Head: head, Outstanding: outstanding}),
		JudgeCustomRole(CustomRoleInput{SeedErr: extras.roleErr, Before: extras.roleBefore, After: after, AfterErr: afterErr, Outstanding: outstanding,
			MainLanding: extras.roleMainLanding, HeadLanding: headLanding}),
	}
}

// PasswordInput is everything E12 judges.
type PasswordInput struct {
	SeedErr     error
	Main, Head  PasswordAnswer
	Outstanding int
}

// JudgePasswordClosed passes when head refuses the governed password with no session; main's answer is recorded only.
func JudgePasswordClosed(input PasswordInput) Verdict {
	switch {
	case input.SeedErr != nil:
		return verdict("E12", false, "seeding on main stopped at "+input.SeedErr.Error())
	case input.Outstanding > 0:
		return Verdict{ID: "E12", Name: invariantNames["E12"], Result: "inconclusive", Detail: fmt.Sprintf("%d ledger rows outstanding", input.Outstanding)}
	}
	detail := fmt.Sprintf("%s on head: %d session %t %q; on main: %d session %t %q", governedMember,
		input.Head.Status, input.Head.Session, input.Head.Body, input.Main.Status, input.Main.Session, input.Main.Body)
	return verdict("E12", input.Head.Status/100 == 4 && !input.Head.Session, detail)
}

// CustomRoleInput is everything E13 judges.
type CustomRoleInput struct {
	SeedErr, AfterErr error
	Before, After     []string
	Outstanding       int
	// MainLanding and HeadLanding: the role holder's sign-in failures on each side, empty when they landed.
	MainLanding, HeadLanding string
}

// JudgeCustomRole passes when the role reads back with the same permissions and bindings it had on main.
func JudgeCustomRole(input CustomRoleInput) Verdict {
	switch {
	case input.SeedErr != nil:
		return verdict("E13", false, "seeding on main stopped at "+input.SeedErr.Error())
	case input.Outstanding > 0:
		return Verdict{ID: "E13", Name: invariantNames["E13"], Result: "inconclusive", Detail: fmt.Sprintf("%d ledger rows outstanding", input.Outstanding)}
	case input.AfterErr != nil:
		return verdict("E13", false, "read on head: "+input.AfterErr.Error())
	}
	hasBinding := slices.ContainsFunc(input.Before, func(entry string) bool { return strings.HasPrefix(entry, "binding:") })
	regressed := input.MainLanding == "" && input.HeadLanding != ""
	detail := fmt.Sprintf("main %v; head %v; holder lands on main: %s; on head: %s", input.Before, input.After, landing(input.MainLanding), landing(input.HeadLanding))
	return verdict("E13", hasBinding && slices.Equal(input.Before, input.After) && !regressed, detail)
}

func landing(failure string) string {
	if failure == "" {
		return "yes"
	}
	return "no (" + failure + ")"
}
