package ingestionbench

import (
	"strings"
	"testing"
)

func TestBuildSeedPlan(t *testing.T) {
	t.Run("given a run id and a project count", func(t *testing.T) {
		plan, err := buildSeedPlan("run12345", 3)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		t.Run("returns one tenant per requested project", func(t *testing.T) {
			if len(plan.Tenants) != 3 {
				t.Errorf("got %d tenants, want 3", len(plan.Tenants))
			}
		})

		t.Run("wraps the inserts in a transaction so a failure cannot half-seed", func(t *testing.T) {
			if !strings.HasPrefix(plan.SQL, "BEGIN;") || !strings.HasSuffix(plan.SQL, "COMMIT;\n") {
				t.Errorf("SQL is not wrapped in a transaction:\n%s", plan.SQL)
			}
		})

		t.Run("seeds its own organization and team", func(t *testing.T) {
			if strings.Count(plan.SQL, `INSERT INTO "Organization"`) != 1 {
				t.Error("expected exactly one Organization insert")
			}
			if strings.Count(plan.SQL, `INSERT INTO "Team"`) != 1 {
				t.Error("expected exactly one Team insert")
			}
			if strings.Count(plan.SQL, `INSERT INTO "Project"`) != 3 {
				t.Error("expected one Project insert per tenant")
			}
		})

		t.Run("marks every seeded row with the run id", func(t *testing.T) {
			// Makes the rows obvious to anyone inspecting the database later,
			// and keeps concurrent runs from colliding on the unique slugs.
			if !strings.Contains(plan.SQL, "ingestion-benchmark-run12345") {
				t.Error("expected the run id in the seeded slugs")
			}
		})

		t.Run("sets every column the schema requires without a default", func(t *testing.T) {
			// Project.language and Project.framework are NOT NULL with no
			// default, so omitting them fails at insert time rather than at
			// review time.
			for _, column := range []string{`"apiKey"`, `"teamId"`, "language", "framework"} {
				if !strings.Contains(plan.SQL, column) {
					t.Errorf("Project insert is missing %s", column)
				}
			}
		})

		t.Run("issues api keys in the platform's own format", func(t *testing.T) {
			for _, tenant := range plan.Tenants {
				if !strings.HasPrefix(tenant.APIKey, "sk-lw-") {
					t.Errorf("api key %q does not look like a platform key", tenant.APIKey)
				}
			}
		})

		t.Run("gives every project a distinct id and key", func(t *testing.T) {
			seen := map[string]bool{}
			for _, tenant := range plan.Tenants {
				if seen[tenant.ProjectID] {
					t.Errorf("duplicate project id %q", tenant.ProjectID)
				}
				seen[tenant.ProjectID] = true
				if seen[tenant.APIKey] {
					t.Errorf("duplicate api key %q", tenant.APIKey)
				}
				seen[tenant.APIKey] = true
			}
		})

		t.Run("puts each tenant's id and key into the SQL that creates it", func(t *testing.T) {
			for _, tenant := range plan.Tenants {
				if !strings.Contains(plan.SQL, tenant.ProjectID) {
					t.Errorf("project %s is not in the SQL", tenant.ProjectID)
				}
				if !strings.Contains(plan.SQL, tenant.APIKey) {
					t.Errorf("api key for %s is not in the SQL", tenant.ProjectID)
				}
			}
		})
	})

	t.Run("when two runs seed against the same database", func(t *testing.T) {
		t.Run("gives them different organizations, so neither sees the other's traces", func(t *testing.T) {
			// A shared organization would make one run's traces look like
			// cross-tenant leakage to the other — the first check to produce a
			// false positive on a reused database.
			first, err := buildSeedPlan("runaaaaa", 2)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			second, err := buildSeedPlan("runbbbbb", 2)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if first.SQL == second.SQL {
				t.Error("two runs produced identical SQL")
			}
			for _, tenant := range first.Tenants {
				if strings.Contains(second.SQL, tenant.ProjectID) {
					t.Errorf("run b reused run a's project %s", tenant.ProjectID)
				}
			}
		})
	})
}

func TestSQLString(t *testing.T) {
	t.Run("given an ordinary value", func(t *testing.T) {
		t.Run("wraps it in single quotes", func(t *testing.T) {
			if got := sqlString("hello"); got != "'hello'" {
				t.Errorf("got %q, want %q", got, "'hello'")
			}
		})
	})

	t.Run("when the value contains a quote", func(t *testing.T) {
		t.Run("doubles it so the literal cannot be closed early", func(t *testing.T) {
			if got := sqlString("O'Brien"); got != "'O''Brien'" {
				t.Errorf("got %q, want %q", got, "'O''Brien'")
			}
		})
	})
}

func TestNanoid(t *testing.T) {
	t.Run("given a length", func(t *testing.T) {
		t.Run("returns an id of exactly that length", func(t *testing.T) {
			id, err := nanoid(21)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(id) != 21 {
				t.Errorf("got length %d, want 21", len(id))
			}
		})

		t.Run("uses only alphabet characters", func(t *testing.T) {
			id, err := nanoid(64)
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			for _, r := range id {
				if !strings.ContainsRune(nanoidAlphabet, r) {
					t.Errorf("id contains %q, which is outside the alphabet", r)
				}
			}
		})

		t.Run("does not repeat across calls", func(t *testing.T) {
			seen := map[string]bool{}
			for range 100 {
				id, err := nanoid(21)
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if seen[id] {
					t.Fatalf("nanoid repeated %q", id)
				}
				seen[id] = true
			}
		})
	})
}
