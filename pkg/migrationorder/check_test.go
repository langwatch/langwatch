package migrationorder_test

import (
	"regexp"
	"slices"
	"testing"

	"github.com/langwatch/langwatch/pkg/migrationorder"
)

func setNamed(t *testing.T, name string) migrationorder.Set {
	t.Helper()
	index := slices.IndexFunc(migrationorder.Sets, func(set migrationorder.Set) bool {
		return set.Name == name
	})
	if index < 0 {
		t.Fatalf("no migration set named %q", name)
	}
	return migrationorder.Sets[index]
}

func TestCheck(t *testing.T) {
	clickhouse := setNamed(t, "ClickHouse")
	prisma := setNamed(t, "Prisma")

	tests := []struct {
		name  string
		in    migrationorder.Input
		want  []*regexp.Regexp
		clean bool
	}{
		{
			name: "passes when the added migration sorts after everything on the base branch",
			in: migrationorder.Input{
				Set:       clickhouse,
				Base:      []string{"00040_a.sql", "00041_b.sql"},
				MergeBase: []string{"00040_a.sql", "00041_b.sql"},
				Head:      []string{"00040_a.sql", "00041_b.sql", "00042_c.sql"},
			},
			clean: true,
		},
		{
			name: "passes when the pull request adds no migrations",
			in: migrationorder.Input{
				Set:       clickhouse,
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql"},
			},
			clean: true,
		},
		{
			name: "passes when merged history is unparseable or duplicated",
			in: migrationorder.Input{
				Set:       prisma,
				Base:      []string{"0_init", "20260227120000_one", "20260227120000_two"},
				MergeBase: []string{"0_init", "20260227120000_one", "20260227120000_two"},
				Head:      []string{"0_init", "20260227120000_one", "20260227120000_two", "20260301000000_mine"},
			},
			clean: true,
		},
		{
			name: "fails when a migration merged first already took the key",
			in: migrationorder.Input{
				Set:       clickhouse,
				Base:      []string{"00040_a.sql", "00041_merged-first.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00041_merged-first.sql", "00041_mine.sql"},
			},
			want: []*regexp.Regexp{regexp.MustCompile(`00041_mine\.sql.*reuses ordering key 41`)},
		},
		{
			name: "fails when the added migration sorts below the highest on the base branch",
			in: migrationorder.Input{
				Set:       clickhouse,
				Base:      []string{"00040_a.sql", "00041_b.sql", "00042_c.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00041_b.sql", "00042_c.sql", "00039_mine.sql"},
			},
			want: []*regexp.Regexp{regexp.MustCompile(`00039_mine\.sql.*sorts at or before 42`)},
		},
		{
			name: "fails when a Prisma migration is timestamped before one already merged",
			in: migrationorder.Input{
				Set:       prisma,
				Base:      []string{"20260101000000_old", "20260708150000_merged_later"},
				MergeBase: []string{"20260101000000_old"},
				Head:      []string{"20260101000000_old", "20260708150000_merged_later", "20260702090000_mine"},
			},
			want: []*regexp.Regexp{regexp.MustCompile(`20260702090000_mine.*sorts at or before 20260708150000`)},
		},
		{
			name: "fails when a merged migration is modified",
			in: migrationorder.Input{
				Set:       clickhouse,
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql"},
				Touched:   []string{"00040_a.sql"},
			},
			want: []*regexp.Regexp{regexp.MustCompile(`00040_a\.sql.*immutable history`)},
		},
		{
			name: "fails when a merged migration is deleted",
			in: migrationorder.Input{
				Set:       clickhouse,
				Base:      []string{"00040_a.sql", "00041_b.sql"},
				MergeBase: []string{"00040_a.sql", "00041_b.sql"},
				Head:      []string{"00040_a.sql"},
				Touched:   []string{"00041_b.sql"},
			},
			want: []*regexp.Regexp{regexp.MustCompile(`00041_b\.sql.*immutable history`)},
		},
		{
			name: "passes when the pull request edits a migration it introduced itself",
			in: migrationorder.Input{
				Set:       clickhouse,
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00041_mine.sql"},
				Touched:   []string{"00041_mine.sql"},
			},
			clean: true,
		},
		{
			name: "fails when the pull request adds two migrations sharing a key",
			in: migrationorder.Input{
				Set:       clickhouse,
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00041_one.sql", "00041_two.sql"},
			},
			want: []*regexp.Regexp{
				regexp.MustCompile(`00041_one\.sql.*00041_two\.sql.*share ordering key 41`),
				regexp.MustCompile(`00041_two\.sql.*00041_one\.sql.*share ordering key 41`),
			},
		},
		{
			name: "fails when an added migration has no ordering key",
			in: migrationorder.Input{
				Set:  clickhouse,
				Head: []string{"add-thing.sql"},
			},
			want: []*regexp.Regexp{regexp.MustCompile(`add-thing\.sql.*does not start with an ordering key`)},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			errs := migrationorder.Check(test.in)

			if test.clean {
				if len(errs) > 0 {
					t.Fatalf("expected no errors, got %v", errs)
				}
				return
			}
			if len(errs) != len(test.want) {
				t.Fatalf("expected %d errors, got %d: %v", len(test.want), len(errs), errs)
			}
			for index, want := range test.want {
				if !want.MatchString(errs[index]) {
					t.Errorf("error %d = %q, want match for %s", index, errs[index], want)
				}
			}
		})
	}
}

func TestTopLevelEntries(t *testing.T) {
	entries := migrationorder.TopLevelEntries([]string{
		"langwatch/prisma/migrations/20260102000000_new/migration.sql",
		"langwatch/prisma/migrations/20260101000000_old/migration.sql",
		"langwatch/prisma/migrations/migration_lock.toml",
	}, "langwatch/prisma/migrations")

	want := []string{"20260101000000_old", "20260102000000_new"}
	if !slices.Equal(entries, want) {
		t.Fatalf("entries = %v, want %v", entries, want)
	}
}
