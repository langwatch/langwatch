package apidiff

// Permission-probe fixtures. Both layouts share the Organization/Team/Project
// table shapes (verified against both prisma schemas: identical required
// columns), so one SQL script serves every profile. Project.apiKey is a
// PLAINTEXT exact-match lookup column in both layouts (the legacy project key
// path — see seed.ts), so the fixed keys need no hashing.
//
// All IDs are fixed, so both instances get byte-identical fixtures. The rows
// live only in the run-scoped database and never touch anything outside it.
const (
	// ProjectKeyB belongs to a second project in the SEEDED organization
	// (same org, wrong project). ProjectKeyC belongs to a project in a
	// separate organization (foreign org).
	ProjectKeyB = "sk-lw-apidiff-project-b-key"
	ProjectKeyC = "sk-lw-apidiff-project-c-key"

	fixtureOrg2ID     = "apidiff-org-2"
	fixtureTeam2ID    = "apidiff-team-2"
	fixtureProjectBID = "apidiff-project-b"
	fixtureProjectCID = "apidiff-project-c"

	// The sacrificial rows. A destructive probe that would otherwise name a
	// row the run depends on is aimed at one of these instead
	// (self-protection.go). They sit in the SEEDED organization and team, so
	// the probe still travels the real route with the real credential and
	// meets the real authorization decision; the only thing that changes is
	// which row is destroyed. Nothing authenticates as them and nothing reads
	// them, so destroying one costs the run nothing.
	fixtureDoomedProjectID = "apidiff-project-doomed"
	fixtureDoomedTeamID    = "apidiff-team-doomed"
	fixtureDoomedUserID    = "apidiff-user-doomed"

	// fixtureDoomedProjectKey exists only because Project.apiKey is a required
	// column. No probe ever presents it.
	fixtureDoomedProjectKey = "sk-lw-apidiff-project-doomed-key"

	// fixtureDoomedUserEmail is unique-constrained in both layouts, so it is
	// fixed here rather than generated: two runs against a kept database must
	// insert the same row, not a second one.
	fixtureDoomedUserEmail = "apidiff-user-doomed@apidiff.invalid"

	// The fixture workflow (fixture-seeding.go): no REST route creates one.
	fixtureWorkflowID        = "apidiff-workflow"
	fixtureWorkflowVersionID = "apidiff-workflow-version"
)

// forcedFeatureFlags are switched on for both instances, so the routes they
// gate are compared rather than refused alike. release_custom_chart_playground
// is left off: it turns the saved-chart routes off (the two are mutually
// exclusive per project), and those carry more of the surface.
var forcedFeatureFlags = "release_lwql_workbench,release_instant_evals,release_langy_enabled"

// provisioningSQL inserts the permission-probe fixtures: organization 2 with
// its team and project C, project B in the seeded organization, and the two
// sacrificial rows destructive probes are aimed at. Insert order respects the
// foreign keys; ON CONFLICT makes re-runs into a kept database idempotent.
//
// The sacrificial project sits in the SEEDED team rather than in the
// sacrificial team, so a probe that destroys the team cannot take the project
// with it and leave the next destructive probe with nothing to aim at.
//
// The sacrificial USER is a member of the SEEDED organization, because the
// directory routes that can delete one are organization-scoped: a user outside
// the organization the run authenticates in is invisible to them, and a probe
// aimed at an invisible row would answer 404 on both sides and prove nothing.
func provisioningSQL() string {
	return `INSERT INTO "Organization" ("id", "name", "slug") VALUES ('` + fixtureOrg2ID + `', 'apidiff org 2', 'apidiff-org-2') ON CONFLICT ("id") DO NOTHING;
INSERT INTO "Team" ("id", "name", "slug", "organizationId") VALUES
  ('` + fixtureTeam2ID + `', 'apidiff team 2', 'apidiff-team-2', '` + fixtureOrg2ID + `'),
  ('` + fixtureDoomedTeamID + `', 'apidiff doomed team', 'apidiff-team-doomed', '` + seededOrganizationID + `')
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "Project" ("id", "name", "slug", "apiKey", "teamId", "language", "framework") VALUES
  ('` + fixtureProjectBID + `', 'apidiff project B', 'apidiff-project-b', '` + ProjectKeyB + `', '` + seededTeamID + `', 'typescript', 'apidiff'),
  ('` + fixtureProjectCID + `', 'apidiff project C', 'apidiff-project-c', '` + ProjectKeyC + `', '` + fixtureTeam2ID + `', 'typescript', 'apidiff'),
  ('` + fixtureDoomedProjectID + `', 'apidiff doomed project', 'apidiff-project-doomed', '` + fixtureDoomedProjectKey + `', '` + seededTeamID + `', 'typescript', 'apidiff')
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "User" ("id", "name", "email") VALUES
  ('` + fixtureDoomedUserID + `', 'apidiff doomed user', '` + fixtureDoomedUserEmail + `')
ON CONFLICT ("id") DO NOTHING;
INSERT INTO "OrganizationUser" ("userId", "organizationId", "role") VALUES
  ('` + fixtureDoomedUserID + `', '` + seededOrganizationID + `', 'MEMBER')
ON CONFLICT ("userId", "organizationId") DO NOTHING;
` + fixtureWorkflowSQL()
}
