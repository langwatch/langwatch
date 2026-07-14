package migrationorder_test

import (
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/migrationorder"
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
		name string
		in   migrationorder.Input
		want []migrationorder.Finding
	}{
		{
			name: "a migration numbered above everything on main is in order",
			in: migrationorder.Input{
				Set:       clickhouse,
				BaseRef:   "origin/main",
				Base:      []string{"00040_a.sql", "00041_b.sql"},
				MergeBase: []string{"00040_a.sql", "00041_b.sql"},
				Head:      []string{"00040_a.sql", "00041_b.sql", "00042_c.sql"},
			},
		},
		{
			name: "a branch that adds no migrations is in order",
			in: migrationorder.Input{
				Set:       clickhouse,
				BaseRef:   "origin/main",
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql"},
			},
		},
		{
			name: "migrations already on main are not judged, keyless or duplicated",
			in: migrationorder.Input{
				Set:       prisma,
				BaseRef:   "origin/main",
				Base:      []string{"0_init", "20260227120000_one", "20260227120000_two"},
				MergeBase: []string{"0_init", "20260227120000_one", "20260227120000_two"},
				Head:      []string{"0_init", "20260227120000_one", "20260227120000_two", "20260301000000_mine"},
			},
		},
		{
			name: "a key another branch merged first is reported with a rename",
			in: migrationorder.Input{
				Set:       clickhouse,
				BaseRef:   "origin/main",
				Base:      []string{"00040_a.sql", "00041_theirs.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00041_theirs.sql", "00041_mine.sql"},
			},
			want: []migrationorder.Finding{{
				Set:     "ClickHouse",
				Entry:   "00041_mine.sql",
				Problem: "takes key 41, which 00041_theirs.sql already took on main",
				Fix: "git mv langwatch/src/server/clickhouse/migrations/00041_mine.sql " +
					"langwatch/src/server/clickhouse/migrations/00042_mine.sql",
			}},
		},
		{
			name: "a migration numbered below the newest on main is reported with a rename",
			in: migrationorder.Input{
				Set:       clickhouse,
				BaseRef:   "origin/main",
				Base:      []string{"00040_a.sql", "00041_b.sql", "00042_c.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00041_b.sql", "00042_c.sql", "00039_mine.sql"},
			},
			want: []migrationorder.Finding{{
				Set:     "ClickHouse",
				Entry:   "00039_mine.sql",
				Problem: "is numbered below 42, the newest migration on main, so it runs out of order or not at all",
				Fix: "git mv langwatch/src/server/clickhouse/migrations/00039_mine.sql " +
					"langwatch/src/server/clickhouse/migrations/00043_mine.sql",
			}},
		},
		{
			name: "a Prisma migration timestamped before one already merged is renamed to now",
			in: migrationorder.Input{
				Set:       prisma,
				BaseRef:   "origin/main",
				Base:      []string{"20260101000000_old", "20260708150000_theirs"},
				MergeBase: []string{"20260101000000_old"},
				Head:      []string{"20260101000000_old", "20260708150000_theirs", "20260702090000_mine"},
			},
			want: []migrationorder.Finding{{
				Set:   "Prisma",
				Entry: "20260702090000_mine",
				Problem: "is numbered below 20260708150000, the newest migration on main, " +
					"so it runs out of order or not at all",
				Fix: "git mv langwatch/prisma/migrations/20260702090000_mine " +
					"langwatch/prisma/migrations/$(date -u +%Y%m%d%H%M%S)_mine",
			}},
		},
		{
			name: "a merged migration that the branch edits is reported with a restore",
			in: migrationorder.Input{
				Set:       clickhouse,
				BaseRef:   "origin/main",
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql"},
				Touched:   []string{"00040_a.sql"},
			},
			want: []migrationorder.Finding{{
				Set:     "ClickHouse",
				Entry:   "00040_a.sql",
				Problem: "already merged, and migrations that have run somewhere cannot change",
				Fix:     "git checkout origin/main -- langwatch/src/server/clickhouse/migrations/00040_a.sql",
			}},
		},
		{
			name: "editing a migration the branch added itself is in order",
			in: migrationorder.Input{
				Set:       clickhouse,
				BaseRef:   "origin/main",
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00041_mine.sql"},
				Touched:   []string{"00041_mine.sql"},
			},
		},
		{
			name: "two migrations in one branch sharing a key are both reported",
			in: migrationorder.Input{
				Set:       clickhouse,
				BaseRef:   "origin/main",
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00041_one.sql", "00041_two.sql"},
			},
			want: []migrationorder.Finding{
				{
					Set:     "ClickHouse",
					Entry:   "00041_one.sql",
					Problem: "shares key 41 with another migration in this branch",
					Fix: "git mv langwatch/src/server/clickhouse/migrations/00041_one.sql " +
						"langwatch/src/server/clickhouse/migrations/00042_one.sql",
				},
				{
					Set:     "ClickHouse",
					Entry:   "00041_two.sql",
					Problem: "shares key 41 with another migration in this branch",
					Fix: "git mv langwatch/src/server/clickhouse/migrations/00041_two.sql " +
						"langwatch/src/server/clickhouse/migrations/00043_two.sql",
				},
			},
		},
		{
			name: "a hostile migration name is quoted in the suggested fix",
			in: migrationorder.Input{
				Set:       clickhouse,
				BaseRef:   "origin/main",
				Base:      []string{"00040_a.sql"},
				MergeBase: []string{"00040_a.sql"},
				Head:      []string{"00040_a.sql", "00039_$(curl evil).sql"},
			},
			want: []migrationorder.Finding{{
				Set:     "ClickHouse",
				Entry:   "00039_$(curl evil).sql",
				Problem: "is numbered below 40, the newest migration on main, so it runs out of order or not at all",
				Fix: "git mv 'langwatch/src/server/clickhouse/migrations/00039_$(curl evil).sql' " +
					"langwatch/src/server/clickhouse/migrations/00041'_$(curl evil).sql'",
			}},
		},
		{
			name: "a migration with no ordering key is reported with the naming format",
			in: migrationorder.Input{
				Set:     clickhouse,
				BaseRef: "origin/main",
				Head:    []string{"add-thing.sql"},
			},
			want: []migrationorder.Finding{{
				Set:     "ClickHouse",
				Entry:   "add-thing.sql",
				Problem: "has no ordering key, so it has no place in the sequence — migrations are named NNNNN_name.sql",
			}},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := migrationorder.Check(test.in)

			if len(got) != len(test.want) {
				t.Fatalf("got %d findings, want %d: %+v", len(got), len(test.want), got)
			}
			for index, want := range test.want {
				if got[index] != want {
					t.Errorf("finding %d:\n got %+v\nwant %+v", index, got[index], want)
				}
			}
		})
	}
}
