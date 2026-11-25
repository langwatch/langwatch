package seed

import (
	"strings"
	"testing"
	"time"
)

func TestLongTailTierGivesEveryOrganizationAnAdminAndAFewBigOnes(t *testing.T) {
	tenancy := BuildTenancy(TenancyInput{Shape: "saas", Seed: 24, Anchor: time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC), Cloud: true, Volume: "L"})
	if len(tenancy.Organizations) != 2_000 || len(tenancy.Projects) != 20_000 || len(tenancy.Users) != 200_000 {
		t.Fatalf("sizes: %d organizations, %d projects, %d users", len(tenancy.Organizations), len(tenancy.Projects), len(tenancy.Users))
	}
	users, admins := map[string]int{}, map[string]bool{}
	for _, user := range tenancy.Users {
		users[user.OrganizationID]++
		if user.Role == "ADMIN" {
			admins[user.OrganizationID] = true
		}
	}
	if len(admins) != len(tenancy.Organizations) {
		t.Fatalf("%d of %d organizations hold an admin", len(admins), len(tenancy.Organizations))
	}
	big, small := users[tenancy.Organizations[0].ID], users[tenancy.Organizations[1_999].ID]
	if big < 100*small/10 || small == 0 {
		t.Fatalf("not a long tail: organization 1 holds %d users, organization 2000 holds %d", big, small)
	}
	for _, team := range tenancy.Teams {
		if team.Personal && users[team.OrganizationID] == 0 {
			t.Fatalf("personal team %s sits in an organization with no users", team.ID)
		}
	}
	if projects := len(tenancy.ProjectsOf(tenancy.Organizations[0].ID)); projects < 10*len(tenancy.ProjectsOf(tenancy.Organizations[1_999].ID)) {
		t.Fatalf("organization 1 holds only %d projects", projects)
	}
}

func TestLongTailTenancySQLStaysSmall(t *testing.T) {
	tenancy := BuildTenancy(TenancyInput{Shape: "saas", Seed: 24, Anchor: time.Date(2026, 10, 12, 0, 0, 0, 0, time.UTC), Cloud: true, Volume: "L"})
	if rows := strings.Count(tenancy.SQL(), `INSERT INTO "TeamUser"`); rows > 6_000*longTailTeamMembers || rows < 6_000 {
		t.Fatalf("%d team memberships", rows)
	}
}
