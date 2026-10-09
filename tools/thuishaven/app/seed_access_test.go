package app

import (
	"testing"

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
