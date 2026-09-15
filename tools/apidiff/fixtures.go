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
)

// provisioningSQL inserts the permission-probe fixtures: organization 2 with
// its team and project C, and project B in the seeded organization. Insert
// order respects the foreign keys; ON CONFLICT makes re-runs into a kept
// database idempotent.
func provisioningSQL() string {
	return `INSERT INTO "Organization" ("id", "name", "slug") VALUES ('` + fixtureOrg2ID + `', 'apidiff org 2', 'apidiff-org-2') ON CONFLICT ("id") DO NOTHING;
INSERT INTO "Team" ("id", "name", "slug", "organizationId") VALUES ('` + fixtureTeam2ID + `', 'apidiff team 2', 'apidiff-team-2', '` + fixtureOrg2ID + `') ON CONFLICT ("id") DO NOTHING;
INSERT INTO "Project" ("id", "name", "slug", "apiKey", "teamId", "language", "framework") VALUES
  ('` + fixtureProjectBID + `', 'apidiff project B', 'apidiff-project-b', '` + ProjectKeyB + `', 'local-dev-team', 'typescript', 'apidiff'),
  ('` + fixtureProjectCID + `', 'apidiff project C', 'apidiff-project-c', '` + ProjectKeyC + `', '` + fixtureTeam2ID + `', 'typescript', 'apidiff')
ON CONFLICT ("id") DO NOTHING;`
}
