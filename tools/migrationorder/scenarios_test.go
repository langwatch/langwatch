package migrationorder_test

import (
	"os"
	"os/exec"
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

const (
	seedStep  = "defineMigrationStep({\n  id: \"topic:seed-clusters\",\n  run: seed,\n})"
	pruneStep = "defineMigrationStep({ id: 'topic:prune-clusters', after: [\"topic:seed-clusters\"], run: prune({ keep: \"(\" }) })"
)

// twoStepsFile declares both released steps in one module file.
const twoStepsFile = "export const steps = [\n  " + seedStep + ",\n  " + pruneStep + ",\n];\n"

const twoStepsManifest = `{"release":"3.21.0","steps":[
  {"id":"topic:seed-clusters","kind":"data","mode":"background","owner":"topic","description":"z"},
  {"id":"topic:prune-clusters","kind":"data","mode":"background","owner":"topic","description":"z"}]}`

// branchChangingSteps commits twoStepsFile and its manifest on main, branches
// "feature" and applies change there; it returns the step check's findings.
func branchChangingSteps(t *testing.T, change func(t *testing.T, root string)) []migrationorder.Finding {
	t.Helper()
	root := initRepo(t)
	writeAndCommit(t, root, stepFile, twoStepsFile)
	writeAndCommit(t, root, "packages/upgrade/releases/3.21.0.json", twoStepsManifest)
	gitIn(t, root, "checkout", "-q", "-b", "feature")
	change(t, root)
	in, err := migrationorder.Repo{Root: root}.Steps(t.Context(), "main")
	if err != nil {
		t.Fatal(err)
	}
	return migrationorder.CheckSteps(in)
}

func moveStepFile(t *testing.T, root, content string) {
	t.Helper()
	gitIn(t, root, "rm", "-q", stepFile)
	writeAndCommit(t, root, "modules/topic/process/src/topic.module.ts", content)
}

// @scenario "A PR changes the declaration of a code step a release manifest names"
func TestStepsRefusesAChangeToAReleasedDeclaration(t *testing.T) {
	cases := []struct {
		name    string
		content string
		changed []string
	}{
		{"an edit inside one block", strings.Replace(twoStepsFile, "run: seed", "run: seedAgain", 1), []string{"topic:seed-clusters"}},
		{"an edit inside the other block", strings.Replace(twoStepsFile, "keep: \"(\"", "keep: \")\"", 1), []string{"topic:prune-clusters"}},
		{"both blocks edited", strings.ReplaceAll(twoStepsFile, "run: ", "run: await "), []string{"topic:prune-clusters", "topic:seed-clusters"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			findings := branchChangingSteps(t, func(t *testing.T, root string) {
				t.Helper()
				writeAndCommit(t, root, stepFile, c.content)
			})
			var got []string
			for _, f := range findings {
				if f.Entry != stepFile || !strings.Contains(f.Problem, "which release 3.21.0 shipped, and a released step cannot change") {
					t.Errorf("finding = %+v", f)
				}
				if !strings.Contains(f.Fix, "restore the defineMigrationStep block declaring") || !strings.Contains(f.Fix, "git show main:"+stepFile) {
					t.Errorf("fix = %q, want the base declaration restored", f.Fix)
				}
				if id, _, ok := strings.Cut(strings.TrimPrefix(f.Problem, "declares "), ","); ok {
					got = append(got, id)
				}
			}
			slices.Sort(got)
			if want := c.changed; !slices.Equal(got, want) {
				t.Errorf("changed steps = %v, want %v", got, want)
			}
		})
	}
}

// @scenario "A PR removes a code step a release manifest names"
func TestStepsRefusesRemovingAReleasedStep(t *testing.T) {
	cases := []struct {
		name   string
		change func(t *testing.T, root string)
	}{
		{"its block removed from the file", func(t *testing.T, root string) {
			t.Helper()
			writeAndCommit(t, root, stepFile, "export const steps = [\n  "+pruneStep+",\n];\n")
		}},
		{"its file deleted", func(t *testing.T, root string) {
			t.Helper()
			gitIn(t, root, "rm", "-q", stepFile)
			writeAndCommit(t, root, "modules/topic/process/src/topic.module.ts", "export const steps = ["+pruneStep+"];\n")
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			findings := branchChangingSteps(t, c.change)
			if len(findings) != 1 || findings[0].Problem != "released step topic:seed-clusters was removed: release 3.21.0 shipped it, and a released step cannot change" {
				t.Fatalf("want one removal finding for topic:seed-clusters, got %+v", findings)
			}
			if findings[0].Entry != stepFile || !strings.Contains(findings[0].Fix, "git show main:"+stepFile) {
				t.Errorf("finding = %+v", findings[0])
			}
		})
	}
}

func TestStepsStopsOnAFileItCannotRead(t *testing.T) {
	root := initRepo(t)
	writeAndCommit(t, root, stepFile, twoStepsFile)
	writeAndCommit(t, root, "packages/upgrade/releases/3.21.0.json", twoStepsManifest)
	gitIn(t, root, "checkout", "-q", "-b", "feature")
	writeAndCommit(t, root, stepFile, "// unreadable on HEAD\n"+twoStepsFile)
	blob := strings.TrimSpace(gitOut(t, root, "rev-parse", "HEAD:"+stepFile))
	if err := os.Remove(filepath.Join(root, ".git", "objects", blob[:2], blob[2:])); err != nil {
		t.Fatal(err)
	}
	in, err := migrationorder.Repo{Root: root}.Steps(t.Context(), "main")
	if err == nil {
		t.Fatalf("a HEAD file git cannot read must stop the check, got findings %+v", migrationorder.CheckSteps(in))
	}
	if !strings.Contains(err.Error(), "git show HEAD:"+stepFile) {
		t.Errorf("error does not name the read: %v", err)
	}
}

func gitOut(t *testing.T, root string, args ...string) string {
	t.Helper()
	out, err := exec.CommandContext(t.Context(), "git", append([]string{"-C", root}, args...)...).Output() //nolint:gosec // test helper driving git with fixed subcommands
	if err != nil {
		t.Fatalf("git %v: %v", args, err)
	}
	return string(out)
}

// @scenario "A PR changes the rest of a file declaring a released code step"
func TestStepsLeavesTheRestOfAReleasedStepFileAlone(t *testing.T) {
	cases := []struct {
		name   string
		change func(t *testing.T, root string)
	}{
		{"an unrelated edit in the same file", func(t *testing.T, root string) {
			t.Helper()
			writeAndCommit(t, root, stepFile, "import { next } from \"./next\";\n"+strings.Replace(twoStepsFile, "];", "  defineMigrationStep({ id: \"topic:next\", after: [\"topic:prune-clusters\"], run: next }),\n];", 1))
		}},
		{"a reformatted block", func(t *testing.T, root string) {
			t.Helper()
			writeAndCommit(t, root, stepFile, strings.Replace(twoStepsFile, "\n  run: seed,\n", " run: seed, ", 1))
		}},
		{"both steps moved to another file unchanged", func(t *testing.T, root string) {
			t.Helper()
			moveStepFile(t, root, "// moved\n"+twoStepsFile)
		}},
		{"the file renamed", func(t *testing.T, root string) {
			t.Helper()
			gitIn(t, root, "mv", stepFile, strings.Replace(stepFile, "seed-clusters", "seed", 1))
			gitIn(t, root, "commit", "-q", "-m", "rename")
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if findings := branchChangingSteps(t, c.change); len(findings) != 0 {
				t.Errorf("want no finding, got %+v", findings)
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
