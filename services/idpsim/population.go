package idpsim

import (
	"fmt"
	"math/rand/v2"
	"sort"
	"strings"
)

/**
 * A directory big enough to be worth syncing, and the changes a real one goes
 * through between syncs.
 *
 * The seeded tenant is two users, which is the right size for "does a sign-in
 * work" and the wrong size for every question about provisioning: whether a
 * push is incremental, whether the receiving side pages its lists, whether a
 * deactivation reaches the membership table, what a thousand joiners does to
 * the screen an administrator is reading. Those only appear at scale.
 *
 * TWO VERBS, DELIBERATELY SEPARATE. `Populate` decides how big the directory
 * is; `Churn` decides what happened to it since the last sync. Keeping them
 * apart is what makes a run repeatable — populate once, then churn and push
 * as many times as you like, each push carrying only that round's changes.
 *
 * EVERYTHING IS SEEDED. The generator takes an explicit seed and defaults to
 * one derived from the tenant, so the same request twice produces the same
 * directory and the same churn picks the same people. A bug found at 5,000
 * users is reproducible rather than a story about one afternoon.
 */

// PopulationSpec is how large a directory to generate, and how to name it.
type PopulationSpec struct {
	// Users is the total the tenant should hold afterwards, INCLUDING the
	// seeded two. Fewer than it already has is a truncation, not an error:
	// shrinking is a change worth testing too.
	Users int `json:"users"`
	// Groups is how many groups to spread them across. Zero leaves the
	// tenant's groups alone.
	Groups int `json:"groups"`
	// Domain overrides the tenant's own domain for the generated addresses,
	// for exercising a directory whose people are not all on one domain.
	Domain string `json:"domain,omitempty"`
	// Seed makes a run reproducible. Zero means "derive one from the tenant",
	// which is itself stable across restarts.
	Seed int64 `json:"seed,omitempty"`
}

// PopulationResult is what a generate left the tenant holding.
type PopulationResult struct {
	Users   int `json:"users"`
	Groups  int `json:"groups"`
	Added   int `json:"added"`
	Removed int `json:"removed"`
}

// givenNames and familyNames are a small fixed vocabulary. Real names rather
// than "user-00417" because the screens under test render them, and a column
// of identical-width identifiers hides the wrapping and truncation bugs that a
// column of real names shows immediately.
var givenNames = []string{
	"Ada", "Bram", "Cato", "Dieuwke", "Emre", "Fenna", "Gijs", "Hana",
	"Imke", "Joris", "Kira", "Lars", "Maud", "Noor", "Otto", "Pien",
	"Quinn", "Roos", "Sander", "Tess", "Ugo", "Veerle", "Wout", "Xan",
	"Yara", "Zeno",
}

var familyNames = []string{
	"Aalders", "Bakker", "Cremers", "Dijkstra", "Elzinga", "Fokkema",
	"Groen", "Hendriks", "Ijssel", "Jansen", "Koster", "Linden", "Mulder",
	"Nieuwenhuis", "Oosterhuis", "Prins", "Quist", "Roosendaal", "Smit",
	"Terpstra", "Ubbink", "Vermeer", "Wolters", "Xylander", "Ypma", "Zomer",
}

// departmentNames is the group vocabulary. Named after the things an
// organization actually divides itself by, so a group list reads like one.
var departmentNames = []string{
	"Everyone", "Engineering", "Design", "Sales", "Support", "Finance",
	"People", "Legal", "Marketing", "Operations", "Security", "Research",
	"Data", "Platform", "Partnerships", "Field", "Compliance", "Facilities",
}

// Populate generates the tenant's directory to the requested size.
//
// The seeded admin and member are KEPT: they are the accounts a developer
// signs in as, and a generate that removed them would end every large-directory
// session with a locked-out tester.
func (t *Tenant) Populate(spec PopulationSpec) PopulationResult {
	t.mu.Lock()
	defer t.mu.Unlock()

	domain := spec.Domain
	if domain == "" {
		domain = t.Domain
	}
	source := rand.NewPCG(uint64(t.seedOr(spec.Seed)), 0x1d0)
	// A SEEDED generator, deliberately. Reproducibility is the whole point —
	// the same request twice has to produce the same directory — and a
	// cryptographic source would defeat it. Nothing here is a secret: these
	// are synthetic names for a simulator.
	//nolint:gosec // G404: predictability is the requirement, not a weakness.
	random := rand.New(source)

	before := len(t.users)
	groups := t.rebuildGroups(spec.Groups)
	t.users = t.generateUsers(generateInput{
		want:   spec.Users,
		domain: domain,
		groups: groups,
		random: random,
	})
	t.assignMembership(groups)

	return PopulationResult{
		Users:   len(t.users),
		Groups:  len(t.groups),
		Added:   max(0, len(t.users)-before),
		Removed: max(0, before-len(t.users)),
	}
}

// generateInput is what building the user list needs. A struct because the
// alternative is five positional arguments of which three are strings.
type generateInput struct {
	want   int
	domain string
	groups []*Group
	random *rand.Rand
}

/**
 * The tenant's users at the requested size, seeded accounts first.
 *
 * GROWING KEEPS WHO IS ALREADY THERE, rather than regenerating from scratch.
 * A directory that renamed everybody every time it grew would make every push
 * after the first look like a total replacement, which is the one shape a real
 * identity provider never sends.
 */
func (t *Tenant) generateUsers(in generateInput) []*User {
	kept := t.seededUsers()
	if in.want <= len(kept) {
		return kept[:max(in.want, len(kept))]
	}

	users := make([]*User, 0, in.want)
	users = append(users, kept...)
	// Everyone already generated stays, so a second Populate at a larger size
	// adds joiners instead of replacing the organization.
	for _, u := range t.users {
		if len(users) >= in.want {
			break
		}
		if !isSeededUser(u) {
			users = append(users, u)
		}
	}
	// PAST THE HIGHEST INDEX ALREADY MINTED, not `len(users)`. Those two
	// diverge the moment a churn has run: joiners are numbered from the
	// highest in use, so a directory of 5,040 can already hold index 5,119.
	// Counting from the length re-minted indices that were taken, which put
	// two people in the directory under one id and one external id — and the
	// receiving side, matching on external id, saw a person whose name kept
	// changing back and forth on every sync.
	next := t.highestGeneratedIndex() + 1
	for len(users) < in.want {
		users = append(users, generatedUser(generatedUserInput{
			tenantID: t.ID,
			index:    next,
			domain:   in.domain,
			random:   in.random,
		}))
		next++
	}
	return users
}

// generatedUserInput names one synthetic person.
type generatedUserInput struct {
	tenantID int
	index    int
	domain   string
	random   *rand.Rand
}

// generatedUser mints one person. The id carries the index so a reader can
// tell at a glance which of five thousand they are looking at, and so two
// generates at different sizes agree about who is who.
func generatedUser(in generatedUserInput) *User {
	given := givenNames[in.random.IntN(len(givenNames))]
	family := familyNames[in.random.IntN(len(familyNames))]
	// The index is in the address as well as the id: two people called Tess
	// Smit in a directory of thousands is normal, and two people with the same
	// address is not a directory the receiving side can accept.
	local := fmt.Sprintf("%s.%s.%d", strings.ToLower(given), strings.ToLower(family), in.index)
	return &User{
		ID:         fmt.Sprintf("t%d-user-%05d", in.tenantID, in.index),
		UserName:   local + "@" + in.domain,
		Email:      local + "@" + in.domain,
		GivenName:  given,
		FamilyName: family,
		Active:     true,
		// externalId is what a real IdP sends and what the receiving side
		// matches on across renames, so the generated population carries one.
		ExternalID: fmt.Sprintf("idpsim-t%d-%05d", in.tenantID, in.index),
	}
}

// seededUsers are the two accounts every tenant starts with, in their original
// order, if they are still there.
func (t *Tenant) seededUsers() []*User {
	kept := make([]*User, 0, 2)
	for _, u := range t.users {
		if isSeededUser(u) {
			kept = append(kept, u)
		}
	}
	return kept
}

// isSeededUser reports whether this is one of the two accounts Reset restores.
func isSeededUser(u *User) bool {
	return strings.HasSuffix(u.ID, "-user-admin") || strings.HasSuffix(u.ID, "-user-member")
}

// rebuildGroups makes the tenant hold exactly `want` groups, keeping the ones
// it already has so group ids survive a resize.
func (t *Tenant) rebuildGroups(want int) []*Group {
	if want <= 0 {
		return t.groups
	}
	groups := make([]*Group, 0, want)
	for index := range want {
		name := departmentNames[index%len(departmentNames)]
		if index >= len(departmentNames) {
			name = fmt.Sprintf("%s %d", name, index/len(departmentNames)+1)
		}
		id := fmt.Sprintf("t%d-group-%03d", t.ID, index)
		if existing, ok := t.groupByIDLocked(id); ok {
			existing.Name = name
			groups = append(groups, existing)
			continue
		}
		groups = append(groups, &Group{ID: id, Name: name})
	}
	t.groups = groups
	return groups
}

// groupByIDLocked is GroupByID for a caller already holding the lock.
func (t *Tenant) groupByIDLocked(id string) (*Group, bool) {
	for _, g := range t.groups {
		if g.ID == id {
			return g, true
		}
	}
	return nil, false
}

/**
 * Put everybody in the first group and one other.
 *
 * THE FIRST GROUP IS EVERYONE, which is what makes a group mapping worth
 * testing: a rule that grants on "Everyone" touches the whole directory, and a
 * rule on a department touches a slice. A membership where each person is in
 * exactly one group cannot tell those two apart.
 *
 * Deterministic by index rather than random: the same person is in the same
 * department across runs, so a churn that moves them is visible as a move.
 */
func (t *Tenant) assignMembership(groups []*Group) {
	if len(groups) == 0 {
		return
	}
	for _, g := range groups {
		g.MemberIDs = nil
	}
	for index, u := range t.users {
		groups[0].MemberIDs = append(groups[0].MemberIDs, u.ID)
		names := []string{groups[0].Name}
		if len(groups) > 1 {
			department := groups[1+index%(len(groups)-1)]
			department.MemberIDs = append(department.MemberIDs, u.ID)
			names = append(names, department.Name)
		}
		u.Groups = names
	}
}

// seedOr resolves the spec's seed, falling back to one derived from the
// tenant so an unseeded request is still reproducible.
func (t *Tenant) seedOr(seed int64) int64 {
	if seed != 0 {
		return seed
	}
	return int64(t.ID)*7919 + 104729
}

// ChurnSpec is one round of directory change, in the shapes a real one takes.
//
// Counts rather than proportions: "fifty joiners" is the sentence somebody says
// when reproducing a problem, and a percentage of a number you would have to
// look up is not.
type ChurnSpec struct {
	// Join adds new people.
	Join int `json:"join"`
	// Leave removes people outright — the SCIM delete an identity provider
	// sends when somebody is taken off it altogether.
	Leave int `json:"leave"`
	// Deactivate flips `active` to false, which is what most providers send
	// instead of a delete and what the receiving side should treat as a
	// suspension rather than an erasure.
	Deactivate int `json:"deactivate"`
	// Reactivate flips it back, so the return path is testable too.
	Reactivate int `json:"reactivate"`
	// Rename changes names and addresses, which is the case that proves the
	// receiving side matches on external id rather than on email.
	Rename int `json:"rename"`
	// Regroup moves people between departments.
	Regroup int `json:"regroup"`
	// Seed makes the selection reproducible.
	Seed int64 `json:"seed,omitempty"`
}

// Any reports whether this spec asks for anything at all.
func (c ChurnSpec) Any() bool {
	return c.Join+c.Leave+c.Deactivate+c.Reactivate+c.Rename+c.Regroup > 0
}

// ChurnResult is what the round actually did, which can be less than was asked
// for: a directory of ten cannot deactivate fifty.
type ChurnResult struct {
	Joined      int `json:"joined"`
	Left        int `json:"left"`
	Deactivated int `json:"deactivated"`
	Reactivated int `json:"reactivated"`
	Renamed     int `json:"renamed"`
	Regrouped   int `json:"regrouped"`
	Users       int `json:"users"`
}

// Churn applies one round of change to the tenant's directory.
//
// The seeded admin and member are never chosen: they are how a developer signs
// in, and a churn that deactivated them would end the session it was meant to
// be observing.
func (t *Tenant) Churn(spec ChurnSpec) ChurnResult {
	t.mu.Lock()
	defer t.mu.Unlock()

	// Seeded for the same reason Populate is: a churn round has to pick the
	// same people every time, so a problem found at 5,000 users is reproducible.
	//nolint:gosec // G404: predictability is the requirement, not a weakness.
	random := rand.New(rand.NewPCG(uint64(t.seedOr(spec.Seed)), 0xc40))
	var result ChurnResult

	result.Joined = t.churnJoin(spec.Join, random)
	result.Left = t.churnLeave(spec.Leave, random)
	result.Deactivated = t.churnActive(spec.Deactivate, false, random)
	result.Reactivated = t.churnActive(spec.Reactivate, true, random)
	result.Renamed = t.churnRename(spec.Rename, random)
	result.Regrouped = t.churnRegroup(spec.Regroup, random)

	t.reindexGroups()
	result.Users = len(t.users)
	return result
}

// churnJoin adds new people on the tenant's domain.
func (t *Tenant) churnJoin(count int, random *rand.Rand) int {
	if count <= 0 {
		return 0
	}
	next := t.highestGeneratedIndex() + 1
	for added := range count {
		t.users = append(t.users, generatedUser(generatedUserInput{
			tenantID: t.ID, index: next + added, domain: t.Domain, random: random,
		}))
	}
	return count
}

// highestGeneratedIndex is the largest index already minted, so joiners never
// collide with somebody who left and whose address is still on the other side.
func (t *Tenant) highestGeneratedIndex() int {
	highest := -1
	for _, u := range t.users {
		var index int
		if _, err := fmt.Sscanf(u.ID, fmt.Sprintf("t%d-user-%%05d", t.ID), &index); err == nil {
			highest = max(highest, index)
		}
	}
	return highest
}

// churnLeave removes people outright.
func (t *Tenant) churnLeave(count int, random *rand.Rand) int {
	chosen := t.pick(count, random, func(*User) bool { return true })
	if len(chosen) == 0 {
		return 0
	}
	leaving := map[string]bool{}
	for _, u := range chosen {
		leaving[u.ID] = true
	}
	kept := t.users[:0]
	for _, u := range t.users {
		if !leaving[u.ID] {
			kept = append(kept, u)
		}
	}
	t.users = kept
	return len(chosen)
}

// churnActive flips `active` on people who are not already in that state.
func (t *Tenant) churnActive(count int, to bool, random *rand.Rand) int {
	chosen := t.pick(count, random, func(u *User) bool { return u.Active != to })
	for _, u := range chosen {
		u.Active = to
	}
	return len(chosen)
}

/**
 * churnRename changes a person's name AND their address.
 *
 * Both, because renaming only the display name is the easy half. A person who
 * marries and changes their email is the case that proves the receiving side
 * matches on external id: their `externalId` is untouched here, so anything
 * that loses them was matching on the address.
 */
func (t *Tenant) churnRename(count int, random *rand.Rand) int {
	chosen := t.pick(count, random, func(*User) bool { return true })
	for _, u := range chosen {
		u.FamilyName = familyNames[random.IntN(len(familyNames))]
		local := fmt.Sprintf("%s.%s.%s",
			strings.ToLower(u.GivenName), strings.ToLower(u.FamilyName), idSuffix(u.ID))
		domain := u.Email[strings.Index(u.Email, "@")+1:]
		u.Email = local + "@" + domain
		u.UserName = u.Email
	}
	return len(chosen)
}

// idSuffix is the trailing index of a generated id, or the whole id when it
// has none — a seeded user's address stays recognizable either way.
func idSuffix(id string) string {
	if at := strings.LastIndex(id, "-"); at >= 0 {
		return id[at+1:]
	}
	return id
}

// churnRegroup moves people into a different department, leaving the
// everyone-group alone: leaving THAT is a departure, which is `Leave`.
func (t *Tenant) churnRegroup(count int, random *rand.Rand) int {
	if len(t.groups) < 3 {
		return 0
	}
	departments := t.groups[1:]
	chosen := t.pick(count, random, func(*User) bool { return true })
	for _, u := range chosen {
		moved := departments[random.IntN(len(departments))]
		u.Groups = []string{t.groups[0].Name, moved.Name}
	}
	return len(chosen)
}

/**
 * pick chooses up to `count` distinct eligible users.
 *
 * The seeded admin and member are never eligible — see `Churn`. The candidate
 * list is sorted by id before shuffling so the same seed picks the same people
 * regardless of the order a previous round happened to leave the slice in.
 */
func (t *Tenant) pick(count int, random *rand.Rand, eligible func(*User) bool) []*User {
	if count <= 0 {
		return nil
	}
	candidates := make([]*User, 0, len(t.users))
	for _, u := range t.users {
		if !isSeededUser(u) && eligible(u) {
			candidates = append(candidates, u)
		}
	}
	sort.Slice(candidates, func(a, b int) bool { return candidates[a].ID < candidates[b].ID })
	random.Shuffle(len(candidates), func(a, b int) {
		candidates[a], candidates[b] = candidates[b], candidates[a]
	})
	return candidates[:min(count, len(candidates))]
}

// reindexGroups rebuilds every group's membership from what the users now say,
// so a join, a departure and a move all land in the group lists a push sends.
func (t *Tenant) reindexGroups() {
	byName := map[string]*Group{}
	for _, g := range t.groups {
		g.MemberIDs = nil
		byName[g.Name] = g
	}
	for _, u := range t.users {
		for _, name := range u.Groups {
			if g, ok := byName[name]; ok {
				g.MemberIDs = append(g.MemberIDs, u.ID)
			}
		}
	}
}
