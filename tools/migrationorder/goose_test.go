package migrationorder_test

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/migrationorder"
)

// grandfathered is a migration named on the exception list, so its live Down
// block is tolerated. Naming it here keeps the tests below honest: the same
// body under any other name has to fail.
const grandfathered = "00059_gateway_budget_ledger_provider_key.sql"

const liveDown = `-- +goose Up
-- +goose StatementBegin
ALTER TABLE db.t ADD COLUMN IF NOT EXISTS ProviderKey String DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE db.t DROP COLUMN IF EXISTS ProviderKey;
-- +goose StatementEnd
`

const commentedDown = `-- +goose Up
-- +goose StatementBegin
ALTER TABLE db.t ADD COLUMN IF NOT EXISTS ProviderKey String DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- IRREVERSIBLE: dropping ProviderKey discards the audit dimension.
-- Down migrations are commented out to prevent accidental data loss.
-- To roll back, uncomment and run manually.
--
-- ALTER TABLE db.t DROP COLUMN IF EXISTS ProviderKey;
`

// The cases below are table-driven, so their subtest names come from a variable
// and cannot each carry their own annotation. The scenarios bind to the
// enclosing function instead — renaming or deleting it re-arms the parity check
// for all five.
//
// @scenario "A Down block that is commented out passes"
// @scenario "A Down block that ships a live statement fails"
// @scenario "An exception that no longer applies fails the check"
// @scenario "Two statements in one block fail"
// @scenario "One statement with several actions passes"
func TestCheckSQL(t *testing.T) {
	clickhouse := setNamed(t, "ClickHouse")
	prisma := setNamed(t, "Prisma")

	tests := []struct {
		name  string
		in    migrationorder.SQLInput
		want  int
		entry string
		// contains is a phrase the finding must carry, so the message keeps
		// telling the author what to do rather than only that they are wrong.
		contains string
	}{
		{
			name: "a Down block that is commented out with a rollback note passes",
			in: migrationorder.SQLInput{
				Set:   clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: commentedDown}},
			},
		},
		{
			name: "a live statement in a Down block is reported with the example to follow",
			in: migrationorder.SQLInput{
				Set:   clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: liveDown}},
			},
			want:     1,
			entry:    "00064_mine.sql",
			contains: "uncomment and run manually, as 00061_trace_analytics_storage_anchor.sql does",
		},
		{
			name: "the live statement is reported at its line, past the goose annotations",
			in: migrationorder.SQLInput{
				Set:   clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: liveDown}},
			},
			want:     1,
			entry:    "00064_mine.sql",
			contains: "Down block (line 8)",
		},
		{
			name: "the grandfathered migration keeps its live Down block",
			in: migrationorder.SQLInput{
				Set:   clickhouse,
				Files: []migrationorder.SQLFile{{Entry: grandfathered, Body: liveDown}},
			},
		},
		{
			name: "a grandfathered migration whose Down block was fixed is reported as stale",
			in: migrationorder.SQLInput{
				Set:   clickhouse,
				Files: []migrationorder.SQLFile{{Entry: grandfathered, Body: commentedDown}},
			},
			want:     1,
			entry:    grandfathered,
			contains: "which only shrinks",
		},
		{
			name: "a Down section of nothing but comments and blank lines passes",
			in: migrationorder.SQLInput{
				Set: clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: `-- +goose Up
-- +goose StatementBegin
ALTER TABLE db.t ADD COLUMN X String DEFAULT '';
-- +goose StatementEnd

-- +goose Down
-- +goose ENVSUB ON
--

--
-- -- +goose StatementBegin
-- -- ALTER TABLE db.t DROP COLUMN IF EXISTS X;
-- -- +goose StatementEnd
-- +goose ENVSUB OFF
`}},
			},
		},
		{
			name: "a migration with no Down section at all passes",
			in: migrationorder.SQLInput{
				Set: clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: `-- +goose Up
-- +goose StatementBegin
CREATE TABLE db.t (Id String) ENGINE = MergeTree ORDER BY Id;
-- +goose StatementEnd
`}},
			},
		},
		{
			name: "live SQL in the Up section is not a Down finding",
			in: migrationorder.SQLInput{
				Set: clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: `-- +goose Up
ALTER TABLE db.t ADD COLUMN X String DEFAULT '';
-- +goose Down
-- ALTER TABLE db.t DROP COLUMN IF EXISTS X;
`}},
			},
		},
		{
			name: "two statements in one goose block are reported",
			in: migrationorder.SQLInput{
				Set: clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: `-- +goose Up
-- +goose StatementBegin
ALTER TABLE db.t ADD COLUMN X String DEFAULT '';
ALTER TABLE db.t ADD COLUMN Y String DEFAULT '';
-- +goose StatementEnd
`}},
			},
			want:     1,
			entry:    "00064_mine.sql",
			contains: "packs 2 statements into the goose block at line 2",
		},
		{
			name: "one ALTER with two comma-separated actions is one statement",
			in: migrationorder.SQLInput{
				Set: clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: `-- +goose Up
-- +goose StatementBegin
ALTER TABLE db.governance_kpis
    ADD COLUMN EventId String AFTER TraceId,
    MODIFY ORDER BY (TenantId, SourceId, HourBucket, TraceId, EventId);
-- +goose StatementEnd
`}},
			},
		},
		{
			name: "one statement per block is not reported, however many blocks",
			in: migrationorder.SQLInput{
				Set: clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: `-- +goose Up
-- +goose StatementBegin
ALTER TABLE db.t ADD COLUMN X String DEFAULT '';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE db.t ADD COLUMN Y String DEFAULT '';
-- +goose StatementEnd
`}},
			},
		},
		{
			name: "a commented-out statement in a block is not counted",
			in: migrationorder.SQLInput{
				Set: clickhouse,
				Files: []migrationorder.SQLFile{{Entry: "00064_mine.sql", Body: `-- +goose Up
-- +goose StatementBegin
-- ALTER TABLE db.t ADD COLUMN X String DEFAULT '';
ALTER TABLE db.t ADD COLUMN Y String DEFAULT '';
-- +goose StatementEnd
`}},
			},
		},
		{
			name: "Prisma migrations carry no goose sections and are not read as SQL",
			in: migrationorder.SQLInput{
				Set:   prisma,
				Files: []migrationorder.SQLFile{{Entry: "20260101000000_mine", Body: liveDown}},
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := migrationorder.CheckSQL(test.in)

			if len(got) != test.want {
				t.Fatalf("got %d findings, want %d: %+v", len(got), test.want, got)
			}
			if test.want == 0 {
				return
			}
			if got[0].Set != test.in.Set.Name || got[0].Entry != test.entry {
				t.Errorf("finding = %s/%s, want %s/%s", got[0].Set, got[0].Entry, test.in.Set.Name, test.entry)
			}
			if !strings.Contains(got[0].Problem, test.contains) {
				t.Errorf("problem = %q, want it to contain %q", got[0].Problem, test.contains)
			}
		})
	}
}

// TestCheckSQLAgainstThisRepository is the check running on the tree it guards.
// The exceptions are the only reason it passes, and each of them is a migration
// that already merged — so a red result here is either a new migration breaking
// the rule, or an exception that has outlived its file.
//
// @scenario "The migrations that already break the rule are named, not skipped"
func TestCheckSQLAgainstThisRepository(t *testing.T) {
	inputs, err := migrationorder.Repo{Root: "../.."}.SQLInputs()
	if err != nil {
		t.Fatal(err)
	}
	if len(inputs) == 0 {
		t.Fatal("no goose migration sets were read, so this check proved nothing")
	}

	for _, in := range inputs {
		if len(in.Files) == 0 {
			t.Fatalf("%s: no migrations were read from %s", in.Set.Name, in.Set.Directory)
		}
		for _, finding := range migrationorder.CheckSQL(in) {
			t.Errorf("%s: %s %s", finding.Set, finding.Entry, finding.Problem)
		}
	}
}
