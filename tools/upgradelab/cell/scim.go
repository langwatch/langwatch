package cell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
)

// E14: idpsim (the connection's tenant) provisions three users and one group into the seed organization through
// main's SCIM endpoint with a token minted on main; head must hold the same users and membership, read through the
// same token, and accept one more push. The token lives in memory and idpsim only: never logged or written.
const scimGroup = "upgradelab-scim"

var scimUsers = []string{"scim-1@" + connectionDomain, "scim-2@" + connectionDomain, "scim-3@" + connectionDomain}

const scimLateUser = "scim-4@" + connectionDomain

// scimSeed is what main's provisioning left: the directory as main reads it, and where seeding stopped.
type scimSeed struct {
	token  string
	before SCIMDirectory
	err    error
}

// SCIMDirectory is one release's account of the provisioned people: SCIM's own view plus organization standing.
type SCIMDirectory struct {
	Users      []string `json:"users"`      // userNames the SCIM endpoint finds, sorted
	Members    []string `json:"members"`    // the group's members as userNames, sorted
	Membership []string `json:"membership"` // email:role in the seed organization, sorted
}

func (cell *run) scimBase() string { return cell.url() + "/api/scim/v2" }

// seedSCIM mints the token, points idpsim at main and provisions the users and the group one SCIM event at a time.
func (cell *run) seedSCIM(ctx context.Context) {
	cell.scim.err = func() error {
		if cell.sso.ceremony != nil || cell.sso.connectionID == "" {
			return errors.New("no ACTIVE connection on the seed organization to provision through")
		}
		var minted struct {
			Token string `json:"token"`
		}
		input := map[string]any{"organizationId": cell.seeder.Context.OrganizationID, "connectionId": cell.sso.connectionID, "description": "upgradelab T5"}
		if err := cell.seeder.Call(ctx, true, "scimToken.generate", input, &minted); err != nil {
			return fmt.Errorf("scimToken.generate: %w", err)
		}
		if minted.Token == "" {
			return errors.New("scimToken.generate answered no token")
		}
		cell.scim.token = minted.Token
		target, _ := json.Marshal(map[string]string{"baseUrl": cell.scimBase(), "token": minted.Token})
		if _, err := idpCall(ctx, http.MethodPut, cell.idpTenant()+"/scim-target", string(target)); err != nil {
			return fmt.Errorf("idpsim scim-target: %w", err)
		}
		for _, email := range scimUsers {
			if err := cell.scimProvision(ctx, email); err != nil {
				return err
			}
		}
		var err error
		cell.scim.before, err = cell.readSCIM(ctx)
		return err
	}()
	if cell.scim.err == nil {
		cell.report.Notes = append(cell.report.Notes, fmt.Sprintf("E14 SCIM on main: %d users, group %s members %v", len(cell.scim.before.Users), scimGroup, cell.scim.before.Members))
	}
}

func (cell *run) idpTenant() string { return cell.stores.IDPURL() + "/control/t/" + connectionTenant }

// scimProvision adds the user to idpsim's directory, pushes a SCIM create, makes the group on the first call and adds the member.
func (cell *run) scimProvision(ctx context.Context, email string) error {
	name, _, _ := strings.Cut(email, "@")
	user, _ := json.Marshal(map[string]string{"id": name, "email": email, "name": "SCIM " + name})
	if _, err := idpCall(ctx, http.MethodPost, cell.idpTenant()+"/users", string(user)); err != nil {
		return fmt.Errorf("idpsim user %s: %w", email, err)
	}
	if err := cell.scimEvent(ctx, map[string]any{"kind": "user.create", "user": email}); err != nil {
		return err
	}
	if email == scimUsers[0] {
		if err := cell.scimEvent(ctx, map[string]any{"kind": "group.create", "group": scimGroup}); err != nil {
			return err
		}
	}
	return cell.scimEvent(ctx, map[string]any{"kind": "group.add-member", "group": scimGroup, "user": email})
}

// scimEvent sends one event through idpsim and fails on any answer outside 2xx (the body names the refusal).
func (cell *run) scimEvent(ctx context.Context, event map[string]any) error {
	body, _ := json.Marshal(event)
	answer, err := idpCall(ctx, http.MethodPost, cell.idpTenant()+"/scim-event", string(body))
	if err != nil {
		return fmt.Errorf("scim %v: %w", event["kind"], err)
	}
	var result struct {
		Event struct {
			Response struct {
				Status int `json:"status"`
				Body   any `json:"body"`
			} `json:"response"`
		} `json:"event"`
	}
	if err := json.Unmarshal(answer, &result); err != nil {
		return fmt.Errorf("scim %v: unreadable idpsim answer: %w", event["kind"], err)
	}
	if status := result.Event.Response.Status; status/100 != 2 {
		detail, _ := json.Marshal(result.Event.Response.Body)
		return fmt.Errorf("scim %v %v answered %d: %.300s", event["kind"], cmpOr(event["user"], event["group"]), status, detail)
	}
	return nil
}

func cmpOr(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

// readSCIM reads the provisioned people through the SCIM endpoint (users by userName, the group's members) and
// their standing in the seed organization.
func (cell *run) readSCIM(ctx context.Context) (SCIMDirectory, error) {
	var directory SCIMDirectory
	names := map[string]string{} // SCIM id -> userName
	for _, email := range append(append([]string{}, scimUsers...), scimLateUser) {
		var found struct {
			Resources []struct{ ID, UserName string } `json:"Resources"`
		}
		if err := cell.scimGet(ctx, "/Users?filter="+url.QueryEscape(fmt.Sprintf("userName eq %q", email)), &found); err != nil {
			return directory, err
		}
		for _, user := range found.Resources {
			names[user.ID] = user.UserName
			directory.Users = append(directory.Users, user.UserName)
		}
	}
	var groups struct {
		Resources []struct {
			ID      string `json:"id"`
			Members []struct {
				Value   string `json:"value"`
				Display string `json:"display"`
			} `json:"members"`
		} `json:"Resources"`
	}
	if err := cell.scimGet(ctx, "/Groups?filter="+url.QueryEscape(fmt.Sprintf("displayName eq %q", scimGroup)), &groups); err != nil {
		return directory, err
	}
	for _, group := range groups.Resources {
		for _, member := range group.Members {
			directory.Members = append(directory.Members, cmpOrString(names[member.Value], member.Display, member.Value))
		}
	}
	membership, err := cell.legacyOrgStanding(ctx, `SELECT u.email || ':' || ou.role FROM mydb."OrganizationUser" ou JOIN mydb."User" u ON u.id = ou."userId" WHERE ou."organizationId" = `+
		sqlQuote(cell.seeder.Context.OrganizationID)+` AND u.email LIKE 'scim-%@`+connectionDomain+`' ORDER BY 1`)
	if err != nil {
		return directory, fmt.Errorf("organization standing: %w", err)
	}
	directory.Membership = membership
	slices.Sort(directory.Users)
	slices.Sort(directory.Members)
	return directory, nil
}

func cmpOrString(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func (cell *run) scimGet(ctx context.Context, path string, out any) error {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cell.scimBase()+path, http.NoBody)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+cell.scim.token)
	request.Header.Set("Accept", "application/scim+json")
	response, err := httpClient.Do(request)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	body, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s answered %d: %.300s", path, response.StatusCode, body)
	}
	return json.Unmarshal(body, out)
}

// idpCall sends one control call to idpsim and returns its body.
func idpCall(ctx context.Context, method, address, body string) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, method, address, strings.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	answer, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if response.StatusCode/100 != 2 {
		return nil, fmt.Errorf("idpsim %s answered %d: %.300s", address, response.StatusCode, answer)
	}
	return answer, nil
}

// scimVerdict (E14) reads the directory on head through main's token, then pushes one more user into the group.
func (cell *run) scimVerdict(ctx context.Context, final []LedgerRow) []Verdict {
	if !cell.profile.SCIM {
		return nil
	}
	input := SCIMInput{Before: cell.scim.before, SeedErr: cell.scim.err, Outstanding: len(Outstanding(final))}
	if input.SeedErr == nil && input.Outstanding == 0 {
		input.After, input.AfterErr = cell.readSCIM(ctx)
		input.PushErr = cell.scimProvision(ctx, scimLateUser)
		if input.PushErr == nil {
			input.Pushed, input.PushedErr = cell.readSCIM(ctx)
		}
	}
	return []Verdict{JudgeSCIM(input)}
}

// SCIMInput is everything E14 judges.
type SCIMInput struct {
	Before, After, Pushed      SCIMDirectory
	SeedErr, AfterErr, PushErr error
	PushedErr                  error
	Outstanding                int
}

// JudgeSCIM passes when main held the three users in the group, head reads the same users, members and standing,
// and a push on head lands the fourth user in the group.
func JudgeSCIM(input SCIMInput) Verdict {
	switch {
	case input.SeedErr != nil:
		return verdict("E14", false, "provisioning on main stopped at "+input.SeedErr.Error())
	case input.Outstanding > 0:
		return Verdict{ID: "E14", Name: invariantNames["E14"], Result: "inconclusive", Detail: fmt.Sprintf("%d ledger rows outstanding", input.Outstanding)}
	}
	var failed []string
	want := slices.Clone(scimUsers)
	if !slices.Equal(input.Before.Users, want) || !slices.Equal(input.Before.Members, want) || len(input.Before.Membership) != len(want) {
		failed = append(failed, fmt.Sprintf("main held users %v, members %v, standing %v", input.Before.Users, input.Before.Members, input.Before.Membership))
	}
	switch {
	case input.AfterErr != nil:
		failed = append(failed, "read on head: "+input.AfterErr.Error())
	case !slices.Equal(input.After.Users, input.Before.Users) || !slices.Equal(input.After.Members, input.Before.Members) || !slices.Equal(input.After.Membership, input.Before.Membership):
		failed = append(failed, fmt.Sprintf("head reads users %v, members %v, standing %v; main had %v, %v, %v",
			input.After.Users, input.After.Members, input.After.Membership, input.Before.Users, input.Before.Members, input.Before.Membership))
	}
	switch {
	case input.PushErr != nil:
		failed = append(failed, "push on head: "+input.PushErr.Error())
	case input.PushedErr != nil:
		failed = append(failed, "read after the push: "+input.PushedErr.Error())
	case input.AfterErr == nil && !slices.Contains(input.Pushed.Members, scimLateUser):
		failed = append(failed, fmt.Sprintf("pushed %s, group members now %v", scimLateUser, input.Pushed.Members))
	}
	if len(failed) > 0 {
		return verdict("E14", false, strings.Join(failed, "; "))
	}
	return verdict("E14", true, fmt.Sprintf("users %v and group %s kept members and standing %v through main's token; %s pushed on head joined the group",
		input.After.Users, scimGroup, input.After.Membership, scimLateUser))
}
