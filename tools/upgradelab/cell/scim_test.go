package cell

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func scimDirectory(members ...string) SCIMDirectory {
	membership := make([]string, 0, len(members))
	for _, member := range members {
		membership = append(membership, member+":MEMBER")
	}
	return SCIMDirectory{Users: members, Members: members, Membership: membership}
}

func TestJudgeSCIM(t *testing.T) {
	kept := scimDirectory(scimUsers...)
	pushed := scimDirectory(append(append([]string{}, scimUsers...), scimLateUser)...)
	cases := []struct {
		name  string
		input SCIMInput
		want  string
	}{
		{"kept and pushed", SCIMInput{Before: kept, After: kept, Pushed: pushed}, "pass"},
		{"seeding stopped", SCIMInput{SeedErr: errors.New("scimToken.generate: 403")}, "fail"},
		{"ledger outstanding", SCIMInput{Before: kept, Outstanding: 2}, "inconclusive"},
		{"group lost a member", SCIMInput{Before: kept, After: scimDirectory(scimUsers[:2]...), Pushed: pushed}, "fail"},
		{"token refused on head", SCIMInput{Before: kept, AfterErr: errors.New("GET /Users answered 401"), PushErr: errors.New("401")}, "fail"},
		{"push not in the group", SCIMInput{Before: kept, After: kept, Pushed: kept}, "fail"},
		{"main held too few", SCIMInput{Before: scimDirectory(scimUsers[0]), After: scimDirectory(scimUsers[0]), Pushed: pushed}, "fail"},
	}
	for _, each := range cases {
		if got := JudgeSCIM(each.input); got.Result != each.want || got.ID != "E14" {
			t.Errorf("%s: %s %s (%s), want %s", each.name, got.ID, got.Result, got.Detail, each.want)
		}
	}
}

func TestJudgePasswordClosed(t *testing.T) {
	cases := []struct {
		name  string
		input PasswordInput
		want  string
	}{
		{"refused on head", PasswordInput{Head: PasswordAnswer{Status: 403, Body: `{"code":"EMAIL_PASSWORD_DISABLED"}`}, Main: PasswordAnswer{Status: 200, Session: true}}, "pass"},
		{"head opens a session", PasswordInput{Head: PasswordAnswer{Status: 200, Session: true}}, "fail"},
		{"head unreachable", PasswordInput{Head: PasswordAnswer{Status: 0}}, "fail"},
		{"head 500", PasswordInput{Head: PasswordAnswer{Status: 500}}, "fail"},
		{"seeding stopped", PasswordInput{SeedErr: errors.New("no connection")}, "fail"},
		{"outstanding", PasswordInput{Outstanding: 1}, "inconclusive"},
	}
	for _, each := range cases {
		if got := JudgePasswordClosed(each.input); got.Result != each.want {
			t.Errorf("%s: %s (%s), want %s", each.name, got.Result, got.Detail, each.want)
		}
	}
}

func TestJudgeCustomRole(t *testing.T) {
	before := []string{"permission:analytics:view", "permission:traces:view", "binding:u1:TEAM:t1"}
	cases := []struct {
		name  string
		input CustomRoleInput
		want  string
	}{
		{"kept", CustomRoleInput{Before: before, After: before}, "pass"},
		{"lost a permission", CustomRoleInput{Before: before, After: before[1:]}, "fail"},
		{"never bound on main", CustomRoleInput{Before: before[:2], After: before[:2]}, "fail"},
		{"unreadable on head", CustomRoleInput{Before: before, AfterErr: errors.New("no table")}, "fail"},
		{"outstanding", CustomRoleInput{Outstanding: 3}, "inconclusive"},
		{"holder lands on main only", CustomRoleInput{Before: before, After: before, HeadLanding: "landing: ended on /"}, "fail"},
		{"holder lands on neither", CustomRoleInput{Before: before, After: before, MainLanding: "x", HeadLanding: "x"}, "pass"},
	}
	for _, each := range cases {
		if got := JudgeCustomRole(each.input); got.Result != each.want {
			t.Errorf("%s: %s (%s), want %s", each.name, got.Result, got.Detail, each.want)
		}
	}
}

func TestParseTestLicense(t *testing.T) {
	keys := "export const TEST_PRIVATE_KEY = `x`;\nexport const TEST_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----`;\n"
	licenses := "export const VALID_LICENSE_KEY =\n  \"pro\";\nexport const ENTERPRISE_LICENSE_KEY =\n  \"ZW50ZXJwcmlzZQ==\";\n"
	got, err := ParseTestLicense(keys, licenses)
	if err != nil {
		t.Fatal(err)
	}
	if got.Key != "ZW50ZXJwcmlzZQ==" || got.PublicKey != "-----BEGIN PUBLIC KEY-----\nAAAA\n-----END PUBLIC KEY-----" {
		t.Errorf("parsed %+v", got)
	}
	if _, err := ParseTestLicense("", licenses); err == nil {
		t.Error("a missing public key parsed")
	}
}

func TestLicensedShapeCarriesThePublicKey(t *testing.T) {
	for deployment, want := range map[string]bool{"self-hosted-legacy-sso": true, "cloud-legacy-sso": false} {
		env, err := BuildEnv(EnvInput{Profile: Profiles[deployment], Stores: Stores{}, APIPort: 1, Admin: "a@b.test", LicensePublicKey: "PEM"})
		if err != nil {
			t.Fatal(err)
		}
		if got := env["LANGWATCH_LICENSE_PUBLIC_KEY"] == "PEM"; got != want {
			t.Errorf("%s: public key set %t, want %t", deployment, got, want)
		}
	}
	if !Profiles["self-hosted-legacy-sso"].SCIM {
		t.Error("self-hosted-legacy-sso does not provision SCIM")
	}
}

func TestReadTestLicenseFromMainCheckout(t *testing.T) {
	checkout := "../../../.worktrees/upgradelab-main"
	if _, err := os.Stat(checkout + "/" + licenseFixtures); err != nil {
		t.Skip("no upgradelab-main checkout")
	}
	got, err := ReadTestLicense(checkout)
	if err != nil || len(got.Key) < 100 || !strings.HasPrefix(got.PublicKey, "-----BEGIN PUBLIC KEY-----") {
		t.Errorf("read %d-byte key, public key %.30q: %v", len(got.Key), got.PublicKey, err)
	}
}
