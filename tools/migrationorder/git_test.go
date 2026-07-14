package migrationorder_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"testing"

	"github.com/langwatch/langwatch/tools/migrationorder"
)

const clickhouseDir = "platform/app/src/server/clickhouse/migrations"

func gitIn(t *testing.T, root string, args ...string) {
	t.Helper()
	cmd := exec.CommandContext(t.Context(), "git", append([]string{"-C", root}, args...)...) //nolint:gosec // test helper driving git with fixed subcommands
	cmd.Env = append(os.Environ(),
		"GIT_CONFIG_GLOBAL=/dev/null",
		"GIT_CONFIG_SYSTEM=/dev/null",
		"GIT_AUTHOR_NAME=test", "GIT_AUTHOR_EMAIL=test@example.com",
		"GIT_COMMITTER_NAME=test", "GIT_COMMITTER_EMAIL=test@example.com",
	)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

func initRepo(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	gitIn(t, root, "init", "-q", "-b", "main")
	return root
}

func commitMigration(t *testing.T, root, name string) {
	t.Helper()
	path := filepath.Join(root, filepath.FromSlash(clickhouseDir), name)
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("SELECT 1;\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	gitIn(t, root, "add", ".")
	gitIn(t, root, "commit", "-q", "-m", "add "+name)
}

func TestRepoInputs(t *testing.T) {
	// main starts with one migration; the branch adds one, renames the merged
	// one, and then main moves ahead — the exact staleness the check exists for.
	root := initRepo(t)
	commitMigration(t, root, "00040_a.sql")
	gitIn(t, root, "checkout", "-q", "-b", "feature")
	commitMigration(t, root, "00043_mine.sql")
	gitIn(t, root, "mv", clickhouseDir+"/00040_a.sql", clickhouseDir+"/00042_renamed.sql")
	gitIn(t, root, "commit", "-q", "-m", "rename merged migration")
	gitIn(t, root, "checkout", "-q", "main")
	commitMigration(t, root, "00041_theirs.sql")
	gitIn(t, root, "checkout", "-q", "feature")

	inputs, err := migrationorder.Repo{Root: root}.Inputs(t.Context(), "main")
	if err != nil {
		t.Fatal(err)
	}
	index := slices.IndexFunc(inputs, func(in migrationorder.Input) bool {
		return in.Set.Name == "ClickHouse"
	})
	if index < 0 {
		t.Fatalf("no ClickHouse input in %+v", inputs)
	}
	in := inputs[index]

	if want := []string{"00040_a.sql", "00041_theirs.sql"}; !slices.Equal(in.Base, want) {
		t.Errorf("Base = %v, want %v", in.Base, want)
	}
	if want := []string{"00040_a.sql"}; !slices.Equal(in.MergeBase, want) {
		t.Errorf("MergeBase = %v, want %v", in.MergeBase, want)
	}
	if want := []string{"00042_renamed.sql", "00043_mine.sql"}; !slices.Equal(in.Head, want) {
		t.Errorf("Head = %v, want %v", in.Head, want)
	}
	// The rename's old name must surface as touched: rename detection would
	// report only the destination and let the merged migration escape.
	if want := []string{"00040_a.sql"}; !slices.Equal(in.Touched, want) {
		t.Errorf("Touched = %v, want %v", in.Touched, want)
	}

	findings := migrationorder.Check(in)
	if len(findings) != 1 {
		t.Fatalf("got %d findings, want 1: %+v", len(findings), findings)
	}
	if findings[0].Entry != "00040_a.sql" {
		t.Errorf("finding entry = %q, want the renamed merged migration", findings[0].Entry)
	}
}

func TestTopLevelEntries(t *testing.T) {
	tests := []struct {
		name      string
		paths     []string
		directory string
		want      []string
	}{
		{
			name: "prisma directories dedupe to one entry and the lock file is dropped",
			paths: []string{
				"platform/app/prisma/migrations/20260102000000_new/migration.sql",
				"platform/app/prisma/migrations/20260102000000_new/README.md",
				"platform/app/prisma/migrations/20260101000000_old/migration.sql",
				"platform/app/prisma/migrations/migration_lock.toml",
			},
			directory: "platform/app/prisma/migrations",
			want:      []string{"20260101000000_old", "20260102000000_new"},
		},
		{
			name: "clickhouse files are taken flat and sorted",
			paths: []string{
				"platform/app/src/server/clickhouse/migrations/00041_b.sql",
				"platform/app/src/server/clickhouse/migrations/00040_a.sql",
			},
			directory: "platform/app/src/server/clickhouse/migrations",
			want:      []string{"00040_a.sql", "00041_b.sql"},
		},
		{
			name: "paths outside the directory are ignored, prefix-alikes included",
			paths: []string{
				"platform/app/prisma/migrations_archive/20260101000000_old/migration.sql",
				"platform/app/prisma/schema.prisma",
			},
			directory: "platform/app/prisma/migrations",
			want:      nil,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			entries := migrationorder.TopLevelEntries(test.paths, test.directory)
			if !slices.Equal(entries, test.want) {
				t.Fatalf("entries = %v, want %v", entries, test.want)
			}
		})
	}
}
