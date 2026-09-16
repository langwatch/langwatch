package apidiff

import (
	"net/http"
	"regexp"
	"sort"
	"strings"
)

// The run authenticates as rows in its own database, and until 2026-09-15
// nothing stopped a probe from destroying one of them. Probe #181 of run 8
// issued DELETE /api/projects/{id} against local-dev-project — the project
// whose apiKey IS the probe credential — and every project-key probe after it
// answered 401 on BOTH sides. The two sides then AGREED, so seventeen
// differences left the report reading as fixes, and coverage collapsed while
// the headline counters improved.
//
// The principle this file exists to hold: a difference that disappears must
// never be indistinguishable from a difference that was fixed. Two mechanisms
// keep a probe from destroying what the run needs, and a third (credentials.go)
// catches it when both fail:
//
//  1. A destructive probe is retargeted at a SACRIFICIAL row of the same kind,
//     which fixtures.go provisions for exactly this. Coverage is kept whole —
//     same route, same credential, same scope, same authorization decision.
//  2. When no sacrificial row of that kind exists the operation is SKIPPED and
//     NAMED. The skip carries its own root cause (self-destructive-target), so
//     the loss is a row in the ledger rather than a silence.
//  3. Every credential is re-read at the end of the run and the run fails if
//     one stopped authenticating.

// Seeded identities: the rows packages/prisma-client/prisma/seed.ts creates.
// Both instances hold them identically, and the run's own credentials are
// columns on them.
const (
	seededProjectID      = "local-dev-project"
	seededOrganizationID = "local-dev-organization"
	seededTeamID         = "local-dev-team"
	seededAdminUserID    = "local-dev-admin-user"
)

// identityKind groups rows that are interchangeable as a destructive probe's
// target. Destroying any project in the seeded organization is the same route,
// the same credential and the same authorization decision, so one throwaway
// project substitutes for any of them without weakening the comparison.
type identityKind string

// The kinds a protected identity can have.
const (
	identityProject      identityKind = "project"
	identityTeam         identityKind = "team"
	identityOrganization identityKind = "organization"
	identityUser         identityKind = "user"
)

// protectedIdentity is one row the RUN ITSELF depends on: its kind, and what
// the run loses when a probe destroys it.
type protectedIdentity struct {
	kind identityKind
	role string
}

// protectedIdentities names every row whose destruction would blind later
// probes. The roles are the reason, written out, because they are what the
// skip reason says to the reader when no substitute exists.
var protectedIdentities = map[string]protectedIdentity{
	seededProjectID: {
		kind: identityProject,
		role: "the project whose apiKey is this run's own project credential",
	},
	fixtureProjectBID: {
		kind: identityProject,
		role: "the sibling-project credential the permission pass reads with",
	},
	fixtureProjectCID: {
		kind: identityProject,
		role: "the foreign-organization credential the permission pass reads with",
	},
	seededTeamID: {
		kind: identityTeam,
		role: "the team holding the project whose apiKey is this run's project credential",
	},
	fixtureTeam2ID: {
		kind: identityTeam,
		role: "the team holding the foreign-organization credential",
	},
	seededOrganizationID: {
		kind: identityOrganization,
		role: "the organization this run's bearer token, SCIM token and entitlement all hang off",
	},
	fixtureOrg2ID: {
		kind: identityOrganization,
		role: "the organization holding the foreign-organization credential",
	},
	// Run r6 of 2026-09-16 deleted this row. Probe #216 issued DELETE
	// /api/scim/v2/Users/local-dev-admin-user, the base answered 204, and the
	// organization bearer hangs off that user — so every organization-door
	// probe after it answered 401 on the base: teams, groups, webhooks and
	// the organization family itself, eighteen operations reading as
	// differences that were nothing of the kind. The project kinds above were
	// protected and survived; a user was not a kind at all.
	seededAdminUserID: {
		kind: identityUser,
		role: "the user this run's organization bearer token hangs off",
	},
}

// sacrificialIdentities names the throwaway row a destructive probe is aimed
// at instead, per kind. There is deliberately no organization twin: an
// organization carries the bearer token, the SCIM token and the plan the
// entitled pass elevates, so a second organization is not a substitute for the
// one under test — an operation aimed at one is skipped and named instead.
var sacrificialIdentities = map[identityKind]string{
	identityProject: fixtureDoomedProjectID,
	identityTeam:    fixtureDoomedTeamID,
	// A user twin IS a substitute where an organization twin is not: nothing
	// authenticates as the throwaway user, so destroying it costs the run
	// nothing, while the route, the credential and the authorization decision
	// are the ones under test.
	identityUser: fixtureDoomedUserID,
}

// selfDestructiveSkipPrefix opens every skip this file emits. The ledger reads
// it to give the skip its own root cause, so a coverage loss is never filed
// under the same slug as an ordinary unresolvable parameter.
const selfDestructiveSkipPrefix = "self-destructive target: "

// credentialRevokingPath matches the operations that revoke a row's credential
// without removing the row. A DELETE is destructive by its method; these are
// destructive by what they do.
var credentialRevokingPath = regexp.MustCompile(`/(?:regenerate|rotate)-api-key$`)

// IsDestructiveOperation reports whether probing this operation can remove the
// row its path names, or revoke that row's credential.
func IsDestructiveOperation(operation Operation) bool {
	if operation.Method == http.MethodDelete {
		return true
	}
	if isReadMethod(operation.Method) {
		return false
	}
	return credentialRevokingPath.MatchString(operation.Path)
}

// selfProtection is one destructive operation's verdict: the retargeting that
// was applied, or the reason the operation must not be probed at all.
type selfProtection struct {
	// Retargets are human-readable notes, one per substitution, sorted.
	Retargets []string
	// Blocked is the skip reason, empty when the probe may run.
	Blocked string
}

// GuardSelfDestruction rewrites a destructive operation's resolved parameters
// away from every row the run depends on, on both sides, and reports what it
// did. A non-destructive operation is returned untouched: retargeting a read
// would change what is being compared for no gain.
//
// Both sides are guarded from the same table of literal ids, so a substitution
// applies identically to A and B and the two sides still issue the same
// request — which is the invariant the whole lockstep comparison rests on.
func GuardSelfDestruction(operation Operation, sides ...resolvedParams) selfProtection {
	if !IsDestructiveOperation(operation) {
		return selfProtection{}
	}
	guard := &selfProtection{}
	notes := map[string]bool{}
	for _, params := range sides {
		guard.applyTo(params.pathValues, notes)
		guard.applyToQuery(params, notes)
	}
	for note := range notes {
		guard.Retargets = append(guard.Retargets, note)
	}
	sort.Strings(guard.Retargets)
	return *guard
}

// applyTo retargets one side's path values, recording a note per substitution
// and the first blocking reason (in sorted parameter order, so the reason a
// reader sees does not depend on map iteration).
func (guard *selfProtection) applyTo(values map[string]string, notes map[string]bool) {
	for _, name := range sortedStringKeys(values) {
		replacement, note, blocked := substituteIdentity(name, values[name])
		guard.record(note, blocked, notes)
		if replacement != "" {
			values[name] = replacement
		}
	}
}

// applyToQuery retargets one side's required query values the same way: a
// target named in the query string is no less destructive for not being in the
// path.
func (guard *selfProtection) applyToQuery(params resolvedParams, notes map[string]bool) {
	for _, name := range sortedStringKeys(params.query) {
		replacement, note, blocked := substituteIdentity(name, params.query.Get(name))
		guard.record(note, blocked, notes)
		if replacement != "" {
			params.query.Set(name, replacement)
		}
	}
}

func (guard *selfProtection) record(note, blocked string, notes map[string]bool) {
	if note != "" {
		notes[note] = true
	}
	if blocked != "" && guard.Blocked == "" {
		guard.Blocked = blocked
	}
}

// substituteIdentity decides one parameter's fate: unprotected values pass
// through, protected ones are swapped for the sacrificial row of their kind,
// and a protected one with no sacrificial twin blocks the whole operation.
func substituteIdentity(paramName, value string) (replacement, note, blocked string) {
	identity, protected := protectedIdentities[value]
	if !protected {
		return "", "", ""
	}
	substitute, hasSubstitute := sacrificialIdentities[identity.kind]
	if !hasSubstitute {
		return "", "", selfDestructiveSkipPrefix + paramName + "=" + value + " is " + identity.role +
			", and no sacrificial " + string(identity.kind) + " exists to aim at instead"
	}
	return substitute, paramName + "=" + value + " is " + identity.role +
		", retargeted at the sacrificial " + string(identity.kind) + " " + substitute, ""
}

// sortedStringKeys returns a map's keys in sorted order; both map types this
// file walks (path values and query values) key on strings.
func sortedStringKeys[Value any](values map[string]Value) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

// isSelfDestructiveSkip reports whether a skip reason came from this file.
func isSelfDestructiveSkip(reason string) bool {
	return strings.HasPrefix(reason, selfDestructiveSkipPrefix)
}
