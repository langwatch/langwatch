package cell

import (
	"errors"
	"strings"
	"testing"
)

func passingLegacyOrg() legacyOrgInput {
	account := "auth0:" + legacyOrgProvider + "|" + legacyOrgUserID
	return legacyOrgInput{
		Org: "org_legacy", Domain: legacyOrgDomain,
		Tenant:      []string{"finalized:grandfathered"},
		Connections: []string{"ssoconn_1:ACTIVE:" + legacyOrgDomain + "," + legacyOrgDomain},
		Results: []SSOResult{
			{Phase: "main", Check: "signin", OK: true},
			{Phase: "head", Check: "cookie", OK: true},
			{Phase: "head", Check: "signin", OK: true},
		},
		Before: []string{"org_legacy:MEMBER"}, After: []string{"org_legacy:MEMBER"},
		AccountsBefore: []string{account}, AccountsAfter: []string{account},
		Ops: "SSO connections ... Migration inventory Replacement is in ...",
	}
}

func TestJudgeLegacyOrg(t *testing.T) {
	cases := []struct {
		name   string
		change func(*legacyOrgInput)
		want   string // "" passes; otherwise a fragment of the failure
	}{
		{"every part holds", func(*legacyOrgInput) {}, ""},
		{"(a) grandfather held on a routing disagreement", func(in *legacyOrgInput) { in.Tenant = []string{"migrated:routing_disagreement"} }, "(a)"},
		{"(a) grandfather never ran", func(in *legacyOrgInput) { in.Tenant = nil }, "want finalized"},
		{"(b) no connection for the domain", func(in *legacyOrgInput) { in.Connections = []string{"ssoconn_1:ACTIVE:acme2.test"} }, "(b) no connection"},
		{"(c) head sign-in refused", func(in *legacyOrgInput) {
			in.Results[2] = SSOResult{Phase: "head", Check: "signin", Detail: "SSO_PROVIDER_NOT_ALLOWED"}
		}, "SSO_PROVIDER_NOT_ALLOWED"},
		{"(c) head sign-in never ran", func(in *legacyOrgInput) { in.Results = in.Results[:1] }, "head/signin: never passed"},
		{"(c) role changed", func(in *legacyOrgInput) { in.After = []string{"org_legacy:ADMIN"} }, "memberships"},
		{"(c) membership lost", func(in *legacyOrgInput) { in.After = nil }, "memberships"},
		{"(c) re-linked under a new account", func(in *legacyOrgInput) {
			in.AccountsAfter = append(in.AccountsAfter, "oidc:other")
		}, "accounts"},
		{"(c) main never held the enterprise-connection account", func(in *legacyOrgInput) {
			in.AccountsBefore, in.AccountsAfter = []string{"auth0:auth0|abc"}, []string{"auth0:auth0|abc"}
		}, "no Auth0 account"},
		{"(d) Ops page failed", func(in *legacyOrgInput) { in.OpsErr = errors.New("exit 1") }, "(d)"},
		{"(d) no inventory shown", func(in *legacyOrgInput) { in.Ops = "SSO connections" }, "(d)"},
	}
	for _, each := range cases {
		t.Run(each.name, func(t *testing.T) {
			input := passingLegacyOrg()
			each.change(&input)
			got := judgeLegacyOrg(input)
			if each.want == "" {
				if got.Result != "pass" {
					t.Fatalf("want pass, got %s: %s", got.Result, got.Detail)
				}
				return
			}
			if got.Result != "fail" || !strings.Contains(got.Detail, each.want) {
				t.Fatalf("want a failure naming %q, got %s: %s", each.want, got.Result, got.Detail)
			}
		})
	}
}
