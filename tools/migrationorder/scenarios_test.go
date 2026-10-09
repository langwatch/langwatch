package migrationorder_test

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/migrationorder"
)

// @scenario "A PR into a long-running branch takes a goose number main already used"
func TestCheckRefusesAGooseNumberMainAlreadyUsed(t *testing.T) {
	in := migrationorder.Input{
		Set:          setNamed(t, "ClickHouse"),
		BaseRef:      "origin/long-branch",
		Base:         []string{"00100_branch.sql"},
		MergeBase:    []string{"00100_branch.sql"},
		Head:         []string{"00100_branch.sql", "00101_mine.sql"},
		Released:     []string{"00100_branch.sql", "00101_main_unreleased.sql", "00102_main_newest.sql"},
		ReleasedRefs: []string{"origin/main"},
	}
	findings := migrationorder.Check(in)
	if len(findings) != 1 {
		t.Fatalf("want one finding, got %+v", findings)
	}
	got := findings[0]
	if got.Entry != "00101_mine.sql" || !strings.Contains(got.Problem, "00101_main_unreleased.sql already took on origin/main") {
		t.Errorf("finding does not name main's migration: %+v", got)
	}
	if want := "packages/clickhouse-migrations/migrations/00103_mine.sql"; !strings.HasSuffix(got.Fix, want) {
		t.Errorf("fix = %q, want a rename above main's newest goose number, ending %q", got.Fix, want)
	}
}

// @scenario "A Prisma timestamp main used for another name is not a collision"
func TestCheckLeavesAPrismaTimestampMainUsedAlone(t *testing.T) {
	in := migrationorder.Input{
		Set:          setNamed(t, "Prisma"),
		BaseRef:      "origin/long-branch",
		Base:         []string{"20261001000000_branch"},
		MergeBase:    []string{"20261001000000_branch"},
		Head:         []string{"20261001000000_branch", "20261002090000_mine"},
		Released:     []string{"20261002090000_join_request_origin"},
		ReleasedRefs: []string{"origin/main"},
	}
	if findings := migrationorder.Check(in); len(findings) != 0 {
		t.Errorf("want no finding for a Prisma timestamp main used, got %+v", findings)
	}
}

const stepFile = "modules/topic/process/src/migrations/seed-clusters.topic.migration.ts"

func writeAndCommit(t *testing.T, root, path, content string) {
	t.Helper()
	full := filepath.Join(root, filepath.FromSlash(path))
	if err := os.MkdirAll(filepath.Dir(full), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(full, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	gitIn(t, root, "add", ".")
	gitIn(t, root, "commit", "-q", "-m", "write "+path)
}

// repoWithStep commits a module file declaring "topic:seed-clusters" and,
// when manifest is not empty, a release manifest; then branches "feature".
func repoWithStep(t *testing.T, manifest string) string {
	t.Helper()
	root := initRepo(t)
	writeAndCommit(t, root, stepFile, "export const step = defineMigrationStep({ id: \"topic:seed-clusters\" });\n")
	writeAndCommit(t, root, "modules/topic/process/src/migrations/__tests__/seed.test.ts", "it(\"topic:seed-clusters\")\n")
	writeAndCommit(t, root, "packages/upgrade/releases/lts-floor.json", `{"release":"3.20.1","namedAt":"2026-10-06"}`)
	if manifest != "" {
		writeAndCommit(t, root, "packages/upgrade/releases/3.21.0.json", manifest)
	}
	gitIn(t, root, "checkout", "-q", "-b", "feature")
	return root
}

const releasedManifest = `{"release":"3.21.0","previous":"3.20.1","cutAt":"2026-10-06","steps":[
  {"id":"prisma:20261001000000_x","kind":"schema","mode":"blocking","owner":null,"description":"x"},
  {"id":"clickhouse:00101","kind":"schema","mode":"blocking","owner":null,"description":"y"},
  {"id":"topic:seed-clusters","kind":"data","mode":"background","owner":"topic","description":"z"}]}`

// @scenario "A PR changes the file of a code step a release manifest names"
func TestStepsRefusesAChangeToAReleasedStepFile(t *testing.T) {
	for _, change := range []string{"modify", "delete", "rename"} {
		t.Run(change, func(t *testing.T) {
			root := repoWithStep(t, releasedManifest)
			switch change {
			case "modify":
				writeAndCommit(t, root, stepFile, "export const step = defineMigrationStep({ id: \"topic:seed-clusters\", run });\n")
			case "delete":
				gitIn(t, root, "rm", "-q", stepFile)
				gitIn(t, root, "commit", "-q", "-m", "delete")
			case "rename":
				gitIn(t, root, "mv", stepFile, strings.Replace(stepFile, "seed-clusters", "seed", 1))
				gitIn(t, root, "commit", "-q", "-m", "rename")
			}
			in, err := migrationorder.Repo{Root: root}.Steps(t.Context(), "main")
			if err != nil {
				t.Fatal(err)
			}
			findings := migrationorder.CheckSteps(in)
			if len(findings) != 1 || findings[0].Entry != stepFile {
				t.Fatalf("want one finding for %s, got %+v", stepFile, findings)
			}
			if !strings.Contains(findings[0].Problem, "topic:seed-clusters, which release 3.21.0 shipped") {
				t.Errorf("problem = %q", findings[0].Problem)
			}
			if want := "git checkout main -- " + stepFile; findings[0].Fix != want {
				t.Errorf("fix = %q, want %q", findings[0].Fix, want)
			}
		})
	}
}

// @scenario "A code step no release manifest names yet may still change"
func TestStepsLeavesAnUnreleasedStepFileAlone(t *testing.T) {
	root := repoWithStep(t, "")
	writeAndCommit(t, root, stepFile, "export const step = defineMigrationStep({ id: \"topic:seed-clusters\", run });\n")
	var stdout, stderr strings.Builder
	if code := migrationorder.Run([]string{"-root", root, "-base", "main"}, &stdout, &stderr); code != 0 {
		t.Fatalf("exit code = %d, want 0; stderr: %s", code, stderr.String())
	}

	// A step's test file may change even once the step has shipped.
	released := repoWithStep(t, releasedManifest)
	writeAndCommit(t, released, "modules/topic/process/src/migrations/__tests__/seed.test.ts", "it(\"topic:seed-clusters again\")\n")
	in, err := migrationorder.Repo{Root: released}.Steps(t.Context(), "main")
	if err != nil {
		t.Fatal(err)
	}
	if findings := migrationorder.CheckSteps(in); len(findings) != 0 {
		t.Errorf("a released step's test file changed, want no finding, got %+v", findings)
	}
}

// @scenario "A release manifest that is not valid JSON stops the check"
func TestRunStopsOnAManifestThatIsNotJSON(t *testing.T) {
	root := repoWithStep(t, "{ not json")
	var stdout, stderr strings.Builder
	if code := migrationorder.Run([]string{"-root", root, "-base", "main"}, &stdout, &stderr); code != 2 {
		t.Fatalf("exit code = %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "packages/upgrade/releases/3.21.0.json is not valid JSON") {
		t.Errorf("stderr does not name the manifest: %s", stderr.String())
	}
}

func TestStepsReadsManifestsOnTheReleaseLine(t *testing.T) {
	// main stamped the release; the long-running base branch has the step file
	// but no manifest yet.
	root := repoWithStep(t, "")
	gitIn(t, root, "branch", "long-branch")
	gitIn(t, root, "checkout", "-q", "main")
	writeAndCommit(t, root, "packages/upgrade/releases/3.21.0.json", releasedManifest)
	gitIn(t, root, "checkout", "-q", "feature")
	writeAndCommit(t, root, stepFile, "changed\n")
	in, err := migrationorder.Repo{Root: root}.Steps(t.Context(), "long-branch", "main")
	if err != nil {
		t.Fatal(err)
	}
	if findings := migrationorder.CheckSteps(in); len(findings) != 1 {
		t.Errorf("want the manifest on main to freeze the step, got %+v", findings)
	}
	if !slices.ContainsFunc(in.Released, func(s migrationorder.ReleasedStep) bool { return s.ID == "topic:seed-clusters" }) {
		t.Errorf("released steps = %+v", in.Released)
	}
}
