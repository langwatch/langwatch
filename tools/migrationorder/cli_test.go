package migrationorder_test

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/migrationorder"
)

func TestRun(t *testing.T) {
	t.Run("exits 0 and reports in order on a clean branch", func(t *testing.T) {
		root := initRepo(t)
		commitMigration(t, root, "00040_a.sql")
		gitIn(t, root, "checkout", "-q", "-b", "feature")
		commitMigration(t, root, "00041_mine.sql")

		var stdout, stderr strings.Builder
		code := migrationorder.Run([]string{"-root", root, "-base", "main"}, &stdout, &stderr)
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr: %s", code, stderr.String())
		}
		if got, want := stdout.String(), "Migrations are in order against main.\n"; got != want {
			t.Errorf("stdout = %q, want %q", got, want)
		}
	})

	t.Run("renders no findings as an empty JSON array", func(t *testing.T) {
		// The workflow script indexes findings.length, which throws on null —
		// this pins [] rather than null for the zero-findings encoding.
		root := initRepo(t)
		commitMigration(t, root, "00040_a.sql")
		gitIn(t, root, "checkout", "-q", "-b", "feature")

		var stdout, stderr strings.Builder
		code := migrationorder.Run([]string{"-root", root, "-base", "main", "-json"}, &stdout, &stderr)
		if code != 0 {
			t.Fatalf("exit code = %d, want 0; stderr: %s", code, stderr.String())
		}
		if got := stdout.String(); got != "[]\n" {
			t.Errorf("stdout = %q, want %q", got, "[]\n")
		}
	})

	t.Run("exits 1 and prints the finding and fix when out of order", func(t *testing.T) {
		root := initRepo(t)
		commitMigration(t, root, "00040_a.sql")
		gitIn(t, root, "checkout", "-q", "-b", "feature")
		commitMigration(t, root, "00039_mine.sql")

		var stdout, stderr strings.Builder
		code := migrationorder.Run([]string{"-root", root, "-base", "main"}, &stdout, &stderr)
		if code != 1 {
			t.Fatalf("exit code = %d, want 1; stdout: %s", code, stdout.String())
		}
		if !strings.Contains(stderr.String(), "00039_mine.sql") || !strings.Contains(stderr.String(), "git mv") {
			t.Errorf("stderr = %q, want the entry and its fix", stderr.String())
		}
	})

	t.Run("exits 2 when the repository cannot be read", func(t *testing.T) {
		var stdout, stderr strings.Builder
		code := migrationorder.Run([]string{"-root", t.TempDir(), "-base", "main"}, &stdout, &stderr)
		if code != 2 {
			t.Fatalf("exit code = %d, want 2", code)
		}
		if stderr.String() == "" {
			t.Error("stderr is empty, want the git error")
		}
	})
}
