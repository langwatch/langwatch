package idpsim

import (
	"context"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func populated(t *testing.T, spec PopulationSpec) *Tenant {
	t.Helper()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)
	tenant.Populate(spec)
	return tenant
}

func TestPopulateGeneratesTheRequestedSize(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 1000, Groups: 8})

	assert.Len(t, tenant.Users(), 1000)
	assert.Len(t, tenant.Groups(), 8)
}

func TestPopulateKeepsTheAccountsYouSignInAs(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 500, Groups: 4})

	// A generate that removed these would end every large-directory session
	// with a locked-out tester.
	_, adminThere := tenant.FindUser("admin@" + tenant.Domain)
	_, memberThere := tenant.FindUser("member@" + tenant.Domain)
	assert.True(t, adminThere, "the admin survives a generate")
	assert.True(t, memberThere, "so does the member")
}

func TestPopulateIsRepeatable(t *testing.T) {
	t.Parallel()
	first := populated(t, PopulationSpec{Users: 200, Groups: 5, Seed: 42})
	second := populated(t, PopulationSpec{Users: 200, Groups: 5, Seed: 42})

	firstNames := userNames(first)
	assert.Equal(t, firstNames, userNames(second),
		"the same request twice produces the same directory")
	assert.Len(t, firstNames, 200)
}

func TestPopulateGivesEverybodyADistinctAddress(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 2000, Groups: 6})

	seen := map[string]bool{}
	for _, u := range tenant.Users() {
		assert.False(t, seen[u.UserName], "duplicate address %s", u.UserName)
		seen[u.UserName] = true
	}
	assert.Len(t, seen, 2000)
}

func TestPopulateGrowingAddsJoinersRatherThanReplacingEverybody(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)

	tenant.Populate(PopulationSpec{Users: 100, Groups: 4})
	before := userNames(tenant)

	tenant.Populate(PopulationSpec{Users: 150, Groups: 4})
	after := userNames(tenant)

	require.Len(t, after, 150)
	// A directory that renamed everybody every time it grew would make every
	// sync after the first look like a total replacement.
	for _, name := range before {
		assert.Contains(t, after, name, "%s was already here and should still be", name)
	}
}

func TestPopulatePutsEverybodyInTheEveryoneGroupAndOneOther(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 300, Groups: 5})

	groups := tenant.Groups()
	require.GreaterOrEqual(t, len(groups), 2)
	// The first group is what makes a group mapping worth testing: a rule on
	// it touches the whole directory, a rule on a department touches a slice.
	assert.Len(t, groups[0].MemberIDs, 300, "everyone is in the first group")

	departmentMembers := 0
	for _, g := range groups[1:] {
		departmentMembers += len(g.MemberIDs)
	}
	assert.Equal(t, 300, departmentMembers, "and in exactly one department")
}

func TestChurnAppliesOnlyWhatItCan(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 20, Groups: 3})

	result := tenant.Churn(ChurnSpec{Deactivate: 500})

	// A directory of twenty cannot deactivate five hundred, and the two seeded
	// accounts are never eligible.
	assert.Equal(t, 18, result.Deactivated)
	assert.Equal(t, 20, result.Users)
}

func TestChurnNeverTouchesTheAccountsYouSignInAs(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 50, Groups: 3})

	tenant.Churn(ChurnSpec{Deactivate: 50, Rename: 50, Leave: 10})

	admin, there := tenant.FindUser("admin@" + tenant.Domain)
	require.True(t, there, "the admin is still here")
	assert.True(t, admin.Active, "and still active")
}

func TestChurnJoinersDoNotReuseADepartedAddress(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 60, Groups: 3})
	before := map[string]bool{}
	for _, name := range userNames(tenant) {
		before[name] = true
	}

	tenant.Churn(ChurnSpec{Leave: 20})
	tenant.Churn(ChurnSpec{Join: 20})

	// Somebody who left may still be on the receiving side; a joiner reusing
	// their address would collide there rather than here.
	seen := map[string]bool{}
	for _, u := range tenant.Users() {
		assert.False(t, seen[u.UserName], "duplicate address %s", u.UserName)
		seen[u.UserName] = true
	}
	assert.Len(t, tenant.Users(), 60)
}

func TestChurnRenameKeepsTheExternalIdentity(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 40, Groups: 3})
	externalBefore := map[string]string{} // id -> externalId
	for _, u := range tenant.Users() {
		externalBefore[u.ID] = u.ExternalID
	}

	require.Equal(t, 15, tenant.Churn(ChurnSpec{Rename: 15}).Renamed)

	// This is the whole point of the rename case: the external id is what the
	// receiving side matches on across a change of name and address.
	for _, u := range tenant.Users() {
		assert.Equal(t, externalBefore[u.ID], u.ExternalID,
			"%s kept their external identity", u.ID)
	}
}

func TestChurnRegroupMovesDepartmentAndKeepsEveryone(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 120, Groups: 5})
	everyone := tenant.Groups()[0].Name

	require.Equal(t, 40, tenant.Churn(ChurnSpec{Regroup: 40}).Regrouped)

	for _, u := range tenant.Users() {
		assert.Contains(t, u.Groups, everyone,
			"%s is still in the everyone group — leaving that is a departure", u.ID)
	}
	assert.Len(t, tenant.Groups()[0].MemberIDs, 120)
}

func TestChurnReactivateBringsPeopleBack(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 40, Groups: 3})
	require.Equal(t, 20, tenant.Churn(ChurnSpec{Deactivate: 20}).Deactivated)

	assert.Equal(t, 20, tenant.Churn(ChurnSpec{Reactivate: 20}).Reactivated)
	for _, u := range tenant.Users() {
		assert.True(t, u.Active, "%s is active again", u.ID)
	}
}

func TestChurnSummaryNamesOnlyWhatMoved(t *testing.T) {
	t.Parallel()
	summary := churnSummary(ChurnResult{Joined: 3, Deactivated: 7, Users: 40})

	assert.Contains(t, summary, "3 joined")
	assert.Contains(t, summary, "7 deactivated")
	assert.Contains(t, summary, "40 users now")
	// The tallies that did not move are absent rather than reported as zero:
	// listing them buries the two numbers somebody is reading for.
	assert.NotContains(t, summary, "renamed")
	assert.NotContains(t, summary, "left")
	assert.NotContains(t, summary, "moved group")
}

func TestResetUndoesAGenerate(t *testing.T) {
	t.Parallel()
	tenant := populated(t, PopulationSpec{Users: 400, Groups: 6})
	require.Len(t, tenant.Users(), 400)

	tenant.Reset()

	assert.Len(t, tenant.Users(), 2, "back to the seeded two")
	assert.Empty(t, tenant.Groups())
}

func userNames(t *Tenant) []string {
	names := make([]string, 0, len(t.Users()))
	for _, u := range t.Users() {
		names = append(names, strings.ToLower(u.UserName))
	}
	return names
}

/**
 * REGRESSION. Growing a directory that has already churned must not re-mint
 * indices the joiners took.
 *
 * `generateUsers` numbered new people from `len(users)`, which is the same as
 * the highest index in use only until a churn has run: joiners are numbered
 * from the highest, so a directory of 5,040 can already hold index 5,119.
 * Counting from the length put two people under one id and one external id —
 * and a receiving side matching on external id then saw one person whose name
 * changed back and forth on every sync, for ever.
 */
func TestPopulateAfterChurnDoesNotReuseAnIndex(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)

	tenant.Populate(PopulationSpec{Users: 200, Groups: 4})
	// Joiners are numbered past the highest in use, so this takes indices the
	// length-based count would hand out again.
	require.Equal(t, 60, tenant.Churn(ChurnSpec{Join: 60}).Joined)
	require.Equal(t, 40, tenant.Churn(ChurnSpec{Leave: 40}).Left)

	tenant.Populate(PopulationSpec{Users: 400, Groups: 4})

	ids := map[string]bool{}
	externals := map[string]bool{}
	for _, u := range tenant.Users() {
		assert.False(t, ids[u.ID], "two people share the id %s", u.ID)
		ids[u.ID] = true
		if u.ExternalID != "" {
			assert.False(t, externals[u.ExternalID],
				"two people share the external id %s", u.ExternalID)
			externals[u.ExternalID] = true
		}
	}
	assert.Len(t, ids, 400)
}

/**
 * The property the bug above broke: a sync run twice with no churn in between
 * sends nothing the second time, even after the directory has grown.
 *
 * Asserted through a real sync rather than by comparing ids, because the way
 * the duplicate showed itself was a run that never converged — and a test that
 * only counted ids would have passed while the directory oscillated.
 */
func TestGrownDirectoryConvergesAfterOneSync(t *testing.T) {
	t.Parallel()
	s := newTestServer(t, 1)
	tenant, ok := s.Tenant(1)
	require.True(t, ok)

	tenant.Populate(PopulationSpec{Users: 120, Groups: 4})
	// Join THEN leave, which is what makes the count diverge from the highest
	// index in use — and is exactly the shape the bug needed.
	tenant.Churn(ChurnSpec{Join: 40})
	tenant.Churn(ChurnSpec{Leave: 30})
	tenant.Populate(PopulationSpec{Users: 300, Groups: 4})

	provider := newPagingServiceProvider()
	server := provider.start(t)
	first := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})
	require.Zero(t, first.FailureCount, "failures: %v", first.Failures)

	second := syncDirectory(context.Background(), syncRun{tenant: tenant, target: syncTarget(server), opts: SyncOptions{}})
	assert.Zero(t, second.Created, "a settled directory creates nobody")
	assert.Zero(t, second.Updated, "and updates nobody")
	assert.Zero(t, second.Deactivated, "and retires nobody")
}
