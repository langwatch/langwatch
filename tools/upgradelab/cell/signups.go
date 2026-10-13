package cell

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/upgradelab/seed"
)

// P1 (trial T4, UM-15): once head is ready, two people sign up through head's own door. Only the first
// sign-up of a self-hosted install with no user yet may operate; spec modules/ops/specs/platform-operator-bootstrap.feature.

const signupPassword = "Upgradelab-signup-1!"

// signupResult is one sign-up and whether head lets that account read Ops > Upgrades.
type signupResult struct {
	Email    string
	SignedUp bool
	Operator bool   // ops.upgrade.status answered as this account
	Detail   string // the sign-up's or the Ops read's refusal
	Page     string // what /ops/upgrades showed this account
}

func signupEmail(seedValue int64, n int) string {
	return fmt.Sprintf("signup%d+%d@snapshot.test", n, seedValue)
}

// signUpTwo signs the first person up, waits for head to decide about them, then signs the second up.
func (cell *run) signUpTwo(ctx context.Context) {
	cell.signupUsersBefore, cell.signupUsersErr = cell.userCount(ctx)
	cell.signupSessions = map[string]*seed.Seeder{}
	for n, wait := range []time.Duration{90 * time.Second, 30 * time.Second} {
		result := signupResult{Email: signupEmail(cell.options.Seed, n+1)}
		if err := cell.signUp(ctx, result.Email); err != nil {
			result.Detail = err.Error()
		} else {
			result.SignedUp = true
			_ = waitFor(ctx, wait, func() bool {
				result.Operator, result.Detail = cell.readsOps(ctx, result.Email)
				return result.Operator || strings.Contains(result.Detail, "sign in") // a refused sign-in never heals by asking again
			})
		}
		cell.signups = append(cell.signups, result)
	}
}

func (cell *run) userCount(ctx context.Context) (int, error) {
	out, err := psql(ctx, cell.stores.psqlURL(), `SELECT count(*) FROM mydb."User"`)
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(out))
}

// signUp is head's sign-up form with no email configured: the address proof comes back in the answer
// (auth.requestSignUpVerification, sent false) and auth.register spends it with the password.
func (cell *run) signUp(ctx context.Context, email string) error {
	seeder := seed.NewSeeder(seed.ProductInput{AppURL: cell.url(), Email: email, Password: signupPassword, Label: cell.options.Name()})
	seeder.PlainWire = true
	var request struct {
		Sent         bool   `json:"sent"`
		AddressProof string `json:"addressProof"`
	}
	if err := seeder.Call(ctx, true, "auth.requestSignUpVerification", map[string]string{"email": email}, &request); err != nil {
		return fmt.Errorf("sign up %s: %w", email, err)
	}
	if request.AddressProof == "" {
		return fmt.Errorf("sign up %s: no address proof (sent %v): the install mails a link instead", email, request.Sent)
	}
	input := map[string]string{"name": strings.Split(email, "@")[0], "email": email, "password": signupPassword, "addressProof": request.AddressProof}
	if err := seeder.Call(ctx, true, "auth.register", input, nil); err != nil {
		return fmt.Errorf("sign up %s: %w", email, err)
	}
	return nil
}

// readsOps asks Ops > Upgrades' status read, which only a platform operator may make, signing the account in
// once and reusing its session: a sign-in per poll trips head's sign-in rate limit (429) for every account.
func (cell *run) readsOps(ctx context.Context, email string) (bool, string) {
	seeder, ok := cell.signupSessions[email]
	if !ok {
		seeder = seed.NewSeeder(seed.ProductInput{AppURL: cell.url(), Email: email, Password: signupPassword, Label: cell.options.Name()})
		seeder.PlainWire = true
		if err := seeder.SignIn(ctx); err != nil {
			return false, err.Error()
		}
		cell.signupSessions[email] = seeder
	}
	if err := seeder.Call(ctx, false, "ops.upgrade.status", nil, nil); err != nil {
		return false, err.Error()
	}
	return true, ""
}

// signupVerdicts asks each account again after settle, screenshots /ops/upgrades as it, and judges P1.
func (cell *run) signupVerdicts(ctx context.Context) []Verdict {
	if !cell.options.Signups {
		return nil
	}
	for index := range cell.signups {
		result := &cell.signups[index]
		if !result.SignedUp {
			continue
		}
		result.Operator, result.Detail = cell.readsOps(ctx, result.Email)
		if cell.options.Shots {
			text, err := cell.opsPageAs(ctx, opsPageInput{name: fmt.Sprintf("signup-%d-ops", index+1), email: result.Email, password: signupPassword, path: "/ops/upgrades"})
			result.Page = strings.Join(strings.Fields(text), " ")
			if err != nil {
				result.Page += " (" + err.Error() + ")"
			}
		}
	}
	return []Verdict{judgeSignups(signupInput{
		SelfHosted: Profiles[cell.options.Deployment].StopStart, UsersBefore: cell.signupUsersBefore,
		UsersErr: cell.signupUsersErr, Results: cell.signups,
	})}
}

type signupInput struct {
	SelfHosted  bool
	UsersBefore int
	UsersErr    error
	Results     []signupResult
}

// judgeSignups: the first sign-up operates exactly when the install is self-hosted and had no user; the second never does.
func judgeSignups(input signupInput) Verdict {
	name := invariantNames["P1"]
	firstOperates := input.SelfHosted && input.UsersBefore == 0
	detail := fmt.Sprintf("self-hosted %v, users before %d, first sign-up should operate: %v; ", input.SelfHosted, input.UsersBefore, firstOperates)
	for _, each := range input.Results {
		detail += fmt.Sprintf("[%s signed up %v, reads Ops %v, %s; page: %.160s] ", each.Email, each.SignedUp, each.Operator, each.Detail, each.Page)
	}
	switch {
	case input.UsersErr != nil:
		return Verdict{ID: "P1", Name: name, Result: "inconclusive", Detail: "user count: " + input.UsersErr.Error()}
	case len(input.Results) != 2 || !input.Results[0].SignedUp || !input.Results[1].SignedUp:
		return Verdict{ID: "P1", Name: name, Result: "fail", Detail: "a sign-up did not land: " + detail}
	}
	return verdict("P1", input.Results[0].Operator == firstOperates && !input.Results[1].Operator, detail)
}

// memberNoticeShot: while the drill's step is failed, a member who is no operator (the second sign-up) opens
// the app; on self-hosted it should show "Contact your LangWatch operator" (c42995f6e5).
func (cell *run) memberNoticeShot(ctx context.Context) {
	if len(cell.signups) < 2 || !cell.signups[1].SignedUp {
		return
	}
	text, err := cell.opsPageAs(ctx, opsPageInput{name: "drill-failed-member", email: cell.signups[1].Email, password: signupPassword, path: "/"})
	cell.memberNotice = strings.Contains(text, "Contact your LangWatch operator")
	note := fmt.Sprintf("member notice while a step is failed (%s): shows %v", cell.signups[1].Email, cell.memberNotice)
	if err != nil {
		note += " (" + err.Error() + ")"
	}
	cell.report.Notes = append(cell.report.Notes, note)
}
