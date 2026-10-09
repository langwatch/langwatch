package app

import (
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/seedgen"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// @scenario "haven seed returns the logins and the credentials haven made up"
func TestSeedAccessMasksUnlessRevealed(t *testing.T) {
	o := seedOrchestrator(t, &fakeSupervisor{}, seedStack())
	p := UpParams{ExplicitSlug: "feat-x"}

	revealed, err := o.seedAccess(p, true)
	if err != nil {
		t.Fatalf("seedAccess: %v", err)
	}
	if revealed.Logins[0].Email != domain.DefaultAdminEmail || revealed.Logins[0].Password != domain.DefaultAdminPassword {
		t.Errorf("login = %+v", revealed.Logins[0])
	}
	if revealed.Organization != domain.DefaultOrganizationSlug || revealed.Project != domain.DefaultProjectSlug {
		t.Errorf("slugs = %s/%s", revealed.Organization, revealed.Project)
	}
	if revealed.SCIMToken == "" || revealed.InstanceAdminKey == "" || revealed.SCIMToken == domain.MaskedSecret {
		t.Errorf("generated credentials missing: scim %q, admin %q", revealed.SCIMToken, revealed.InstanceAdminKey)
	}

	masked, err := o.seedAccess(p, false)
	if err != nil {
		t.Fatalf("seedAccess: %v", err)
	}
	for name, value := range map[string]string{"password": masked.Logins[0].Password, "scim": masked.SCIMToken, "admin key": masked.InstanceAdminKey} {
		if value != domain.MaskedSecret {
			t.Errorf("%s printed unmasked: %q", name, value)
		}
	}
}

// @scenario "The access block lists every seeded org and its logins"
func TestSeedAccessListsOnlyTheOrgsTheSeedCreated(t *testing.T) {
	o := seedOrchestrator(t, &fakeSupervisor{}, seedStack())
	flags, err := seedgen.ParseFlags([]string{"--size", "tiny", "--private", "0", "--org", "name=acme,users=3",
		"--org", "name=globex,users=2"}, seedNow)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := seedgen.NewPlan(flags)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(o.seedRunsDir("feat-x"), plan.Run)
	if err := seedgen.NewManifest(plan).Write(dir); err != nil {
		t.Fatal(err)
	}
	acme := plan.Orgs[0]
	refs := seedgen.Refs{acme.Ref: "org_acme", acme.Users[0].Ref: "user_owner", acme.Users[1].Ref: "user_member"}
	if err := seedgen.NewCheckpoint(plan.Run, refs).Save(filepath.Join(dir, "run.json")); err != nil {
		t.Fatal(err)
	}

	access, err := o.seedAccess(UpParams{ExplicitSlug: "feat-x"}, false)
	if err != nil {
		t.Fatalf("seedAccess: %v", err)
	}
	if len(access.Orgs) != 1 || access.Orgs[0].ID != "org_acme" || access.Orgs[0].Name != "acme" {
		t.Fatalf("orgs = %+v: want only acme, the one the product minted", access.Orgs)
	}
	logins := access.Orgs[0].Logins
	if len(logins) != 2 || logins[0].Email != acme.Users[0].Email || logins[1].Password != domain.MaskedSecret {
		t.Fatalf("logins = %+v: want the owner and the one minted member, masked", logins)
	}
}
