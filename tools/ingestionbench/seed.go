package ingestionbench

import (
	"context"
	"crypto/rand"
	"fmt"
	"os/exec"
	"strings"
)

// nanoidAlphabet matches the alphabet Prisma's nanoid() default uses, so
// seeded ids are indistinguishable from ones the application would mint.
const nanoidAlphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"

// nanoid returns a URL-safe random id of the given length.
func nanoid(length int) (string, error) {
	buffer := make([]byte, length)
	if _, err := rand.Read(buffer); err != nil {
		return "", fmt.Errorf("could not read randomness for an id: %w", err)
	}
	out := make([]byte, length)
	for i, b := range buffer {
		out[i] = nanoidAlphabet[int(b)%len(nanoidAlphabet)]
	}
	return string(out), nil
}

// sqlString renders a Go string as a Postgres literal.
func sqlString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

// seedPlan is the SQL for one seeding run plus the tenants it will create.
type seedPlan struct {
	SQL     string
	Tenants []Tenant
}

// buildSeedPlan composes the inserts for one run's organization, team, and
// projects.
//
// Each run gets its OWN organization rather than reusing a fixture, so a run
// can never observe another run's traces and report them as cross-tenant
// leakage — the check that would otherwise be the first to produce a false
// positive on a shared database. The run id in every name and slug also makes
// the rows obvious to anyone inspecting the database later.
//
// Kept separate from the psql invocation so the generated SQL is testable
// without a database.
func buildSeedPlan(runID string, count int) (seedPlan, error) {
	orgID, err := nanoid(21)
	if err != nil {
		return seedPlan{}, err
	}
	teamID, err := nanoid(21)
	if err != nil {
		return seedPlan{}, err
	}

	label := fmt.Sprintf("Ingestion Benchmark %s", runID)
	slug := fmt.Sprintf("ingestion-benchmark-%s", runID)

	var sql strings.Builder
	sql.WriteString("BEGIN;\n")
	fmt.Fprintf(&sql,
		"INSERT INTO \"Organization\" (id, name, slug, \"createdAt\", \"updatedAt\") VALUES (%s, %s, %s, now(), now());\n",
		sqlString(orgID), sqlString(label), sqlString(slug))
	fmt.Fprintf(&sql,
		"INSERT INTO \"Team\" (id, name, slug, \"organizationId\", \"createdAt\", \"updatedAt\") VALUES (%s, %s, %s, %s, now(), now());\n",
		sqlString(teamID), sqlString(label), sqlString(slug), sqlString(orgID))

	tenants := make([]Tenant, 0, count)
	for i := range count {
		projectID, err := nanoid(21)
		if err != nil {
			return seedPlan{}, err
		}
		keySuffix, err := nanoid(24)
		if err != nil {
			return seedPlan{}, err
		}
		apiKey := "sk-lw-" + keySuffix

		fmt.Fprintf(&sql,
			"INSERT INTO \"Project\" (id, name, slug, \"apiKey\", \"teamId\", language, framework, "+
				"\"firstMessage\", integrated, \"createdAt\", \"updatedAt\") "+
				"VALUES (%s, %s, %s, %s, %s, 'en', 'langchain', false, false, now(), now());\n",
			sqlString(projectID),
			sqlString(fmt.Sprintf("%s #%d", label, i)),
			sqlString(fmt.Sprintf("%s-%d", slug, i)),
			sqlString(apiKey),
			sqlString(teamID))

		tenants = append(tenants, Tenant{ProjectID: projectID, APIKey: apiKey})
	}
	sql.WriteString("COMMIT;\n")

	return seedPlan{SQL: sql.String(), Tenants: tenants}, nil
}

// applySeed runs the plan's SQL through psql.
//
// psql rather than a Postgres driver: the root module carries no SQL driver,
// and haven already shells out to psql for its own seeding, so this adds a
// tool the environment must have rather than a dependency the module must
// carry. ON_ERROR_STOP makes a mid-script failure a non-zero exit instead of a
// half-seeded organization that the run would then quietly use.
func applySeed(ctx context.Context, databaseURL, sql string) error {
	command := exec.CommandContext(ctx, "psql", databaseURL, "-v", "ON_ERROR_STOP=1", "-q", "-b")
	command.Stdin = strings.NewReader(sql)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("psql failed: %w\n%s", err, strings.TrimSpace(string(output)))
	}
	return nil
}
