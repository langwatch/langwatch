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
				if !strings.Contains(f.Fix, "restore the declaration of") || !strings.Contains(f.Fix, "git show main:"+stepFile) {
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

// @scenario "A released replay step freezes only its own call"
func TestStepsFreezesOnlyAReleasedReplayStepCall(t *testing.T) {
	const (
		moduleFile = "modules/topic/process/src/topic.module.ts"
		specFile   = "modules/topic/specs/topic-deploy-steps.feature"
		replay     = "defineProjectionReplayStep({\n  id: \"topic:replay-clusters\",\n  lane: \"clusters\",\n})"
		module     = "export const steps = [\n  " + replay + ",\n];\n"
	)
	findingsAfter := func(t *testing.T, moduleHead, specHead string) []migrationorder.Finding {
		t.Helper()
		root := initRepo(t)
		writeAndCommit(t, root, moduleFile, module)
		writeAndCommit(t, root, specFile, "Then it declares \"topic:replay-clusters\"\n")
		writeAndCommit(t, root, "packages/upgrade/releases/3.21.0.json", `{"release":"3.21.0","steps":[
  {"id":"topic:replay-clusters","kind":"data","mode":"background","owner":"topic","description":"z"}]}`)
		gitIn(t, root, "checkout", "-q", "-b", "feature")
		writeAndCommit(t, root, moduleFile, moduleHead)
		writeAndCommit(t, root, specFile, specHead)
		in, err := migrationorder.Repo{Root: root}.Steps(t.Context(), "main")
		if err != nil {
			t.Fatal(err)
		}
		return migrationorder.CheckSteps(in)
	}
	newStep := strings.Replace(module, "];", "  defineMigrationStep({ id: \"topic:next\", run: next }),\n];", 1)
	if findings := findingsAfter(t, newStep, "Then it declares \"topic:replay-clusters\" again\n"); len(findings) != 0 {
		t.Errorf("a new step beside a released replay step, want no finding, got %+v", findings)
	}
	edited := strings.Replace(module, "\"clusters\"", "\"clusters-v2\"", 1)
	findings := findingsAfter(t, edited, "Then it still declares \"topic:replay-clusters\"\n")
	if len(findings) != 1 || findings[0].Entry != moduleFile || !strings.Contains(findings[0].Problem, "declares topic:replay-clusters") {
		t.Errorf("an edited replay call, want one finding on %s, got %+v", moduleFile, findings)
	}
}

// @scenario "A released id-index step is read from its owner's call in code"
func TestStepsFreezesEachIdIndexCallOfOneChainOnItsOwn(t *testing.T) {
	const (
		gatewayFile = "modules/gateway/process/src/gateway.module.ts"
		opsFile     = "modules/ops/process/src/ops.module.ts"
		gatewayOwn  = ".withIdIndexes(GATEWAY_ID_INDEXES, {\n  description: \"Fills gateway.\",\n})"
		gatewayNext = ".withIdIndexes(SECOND_ID_INDEXES, {\n  step: \"fill-second-id-indexes\",\n  description: \"Fills second.\",\n})"
		opsOwn      = ".withIdIndexes(OPS_ID_INDEXES, {\n  description: \"Fills ops.\",\n})"
		opsLog      = ".withIdIndexes([EVENT_LOG_ID_INDEX], {\n  step: \"fill-event-log-id-index\",\n  description: \"Fills the event log.\",\n})"
		gateway     = "export const gateway = defineProcessModule(\"gateway\")\n  " + gatewayOwn + "\n  " + gatewayNext + ";\n"
		ops         = "export const ops = defineProcessModule(\"ops\")\n  " + opsOwn + "\n  " + opsLog + ";\n"
	)
	// Released: gateway:fill-id-indexes (no step option) and ops:fill-event-log-id-index.
	// Not released: gateway:fill-second-id-indexes and ops:fill-id-indexes.
	cases := []struct {
		name, gateway, ops, want string
	}{
		{"the gateway's unreleased second call edited", strings.Replace(gateway, "Fills second.", "Fills more.", 1), ops, ""},
		{"the gateway's released call edited", strings.Replace(gateway, "Fills gateway.", "Fills more.", 1), ops, "declares gateway:fill-id-indexes"},
		{"the ops module's unreleased call edited", gateway, strings.Replace(ops, "Fills ops.", "Fills more.", 1), ""},
		{"the ops module's released call edited", gateway, strings.Replace(ops, "Fills the event log.", "Fills more.", 1), "declares ops:fill-event-log-id-index"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			findings := idIndexFindings(t, map[string][2]string{gatewayFile: {gateway, c.gateway}, opsFile: {ops, c.ops}})
			if c.want == "" {
				if len(findings) != 0 {
					t.Errorf("want no finding, got %+v", findings)
				}
				return
			}
			if len(findings) != 1 || !strings.Contains(findings[0].Problem, c.want) {
				t.Errorf("want one finding %q, got %+v", c.want, findings)
			}
		})
	}
}

// idIndexFindings commits each file's base on main, under a manifest
// releasing the gateway, ops and coding-agent id-index steps, then each
// changed head on a branch, and returns the step findings.
func idIndexFindings(t *testing.T, files map[string][2]string) []migrationorder.Finding {
	t.Helper()
	root := initRepo(t)
	for file, versions := range files {
		writeAndCommit(t, root, file, versions[0])
	}
	writeAndCommit(t, root, "packages/upgrade/releases/3.21.0.json", `{"release":"3.21.0","steps":[
  {"id":"gateway:fill-id-indexes","kind":"data","mode":"background","owner":"gateway","description":"g"},
  {"id":"ops:fill-event-log-id-index","kind":"data","mode":"background","owner":"ops","description":"o"},
  {"id":"coding-agent:fill-id-indexes","kind":"data","mode":"background","owner":"coding-agent","description":"c"}]}`)
	gitIn(t, root, "checkout", "-q", "-b", "feature")
	for file, versions := range files {
		if versions[1] != versions[0] {
			writeAndCommit(t, root, file, versions[1])
		}
	}
	in, err := migrationorder.Repo{Root: root}.Steps(t.Context(), "main")
	if err != nil {
		t.Fatal(err)
	}
	return migrationorder.CheckSteps(in)
}

// @scenario "A released id-index step is frozen in its declaring call, not where another step orders after it"
func TestStepsFreezesAReleasedIdIndexStepInItsDeclaringCall(t *testing.T) {
	const (
		gatewayFile = "modules/gateway/process/src/gateway.module.ts"
		opsFile     = "modules/ops/process/src/ops.module.ts"
		gatewayCall = ".withIdIndexes(GATEWAY_ID_INDEXES, {\n  after: [\"coding-agent:fill-id-indexes\"],\n  description: \"Fills gateway.\",\n})"
		opsCall     = ".withIdIndexes([EVENT_LOG_ID_INDEX], {\n  step: \"fill-event-log-id-index\",\n  after: [\"gateway:fill-id-indexes\"],\n})"
		gateway     = "export const gateway = defineProcessModule(\"gateway\")\n  " + gatewayCall + ";\n"
		ops         = "export const ops = defineProcessModule(\"ops\")\n  .withEventing(usageEventing)\n  // reads the event log\n  " + opsCall + ";\n"
	)
	findingsAfter := func(t *testing.T, gatewayHead, opsHead string) []migrationorder.Finding {
		t.Helper()
		return idIndexFindings(t, map[string][2]string{gatewayFile: {gateway, gatewayHead}, opsFile: {ops, opsHead}})
	}
	unrelated := strings.Replace(ops, "  .withEventing(usageEventing)\n", "  .withEventing(usageEventing)\n  .withEventing(replayEventing)\n", 1)
	if findings := findingsAfter(t, gateway, unrelated); len(findings) != 0 {
		t.Errorf("an unrelated line in the referencing file, want no finding, got %+v", findings)
	}
	// coding-agent:fill-id-indexes is only referenced here, never declared.
	gatewayUnrelated := "import { more } from \"./more\";\n" + gateway
	if findings := findingsAfter(t, gatewayUnrelated, ops); len(findings) != 0 {
		t.Errorf("an unrelated line beside a reference to an undeclared step, want no finding, got %+v", findings)
	}
	cases := []struct {
		name, gateway, ops, entry, problem string
	}{
		{"the gateway call edited", strings.Replace(gateway, "Fills gateway.", "Fills more.", 1), ops, gatewayFile, "declares gateway:fill-id-indexes"},
		{"the ops call edited", gateway, strings.Replace(ops, "[EVENT_LOG_ID_INDEX]", "[EVENT_LOG_ID_INDEX, MORE]", 1), opsFile, "declares ops:fill-event-log-id-index"},
		{"the gateway call removed", "export const gateway = defineProcessModule(\"gateway\");\n", ops, gatewayFile, "released step gateway:fill-id-indexes was removed"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			findings := findingsAfter(t, c.gateway, c.ops)
			if len(findings) != 1 || findings[0].Entry != c.entry || !strings.Contains(findings[0].Problem, c.problem) {
				t.Errorf("want one finding on %s %q, got %+v", c.entry, c.problem, findings)
			}
		})
	}
}

// @scenario "A released id-index step is read from its owner's call in code"
func TestStepsReadsAReleasedIdIndexStepFromItsOwnersCallInCode(t *testing.T) {
	const (
		gatewayFile = "modules/gateway/process/src/gateway.module.ts"
		opsFile     = "modules/ops/process/src/ops.module.ts"
		otherFile   = "modules/other/process/src/other.module.ts"
		gatewayCall = ".withIdIndexes (GATEWAY_ID_INDEXES, {\n  description: \"Fills gateway.\",\n})"
		opsCall     = ".withIdIndexes([EVENT_LOG_ID_INDEX], {\n  // step: \"old-name\",\n  step: \"fill-event-log-id-index\",\n  after: [\"gateway:fill-id-indexes\"],\n})"
		gateway     = "export const gateway = defineProcessModule(\"gateway\")\n  " + gatewayCall + ";\n"
		ops         = "export const ops = defineProcessModule(\"ops\")\n  " + opsCall + ";\n"
		removed     = "export const gateway = defineProcessModule(\"gateway\");\n"
		other       = "// mirrors defineProcessModule(\"gateway\")\nexport const other = defineProcessModule(\"other\")\n  " + gatewayCall + ";\n"
	)
	edited := strings.Replace(ops, "[EVENT_LOG_ID_INDEX]", "[EVENT_LOG_ID_INDEX, MORE]", 1)
	wrapped := func(file string) string {
		return strings.Replace(file, `defineProcessModule("gateway")`, "defineProcessModule(\n  \"gateway\",\n)", 1)
	}
	quotedKey := func(quote, file string) string {
		return strings.Replace(file, "  step:", "  "+quote+"step"+quote+":", 1)
	}
	cases := []struct {
		name, problem, entry string
		files                map[string][2]string
	}{
		{"a space before the bracket", "declares gateway:fill-id-indexes", gatewayFile, map[string][2]string{
			gatewayFile: {gateway, strings.Replace(gateway, "Fills gateway.", "Fills more.", 1)}, opsFile: {ops, ops},
		}},
		{"a comment naming another step", "declares ops:fill-event-log-id-index", opsFile, map[string][2]string{
			gatewayFile: {gateway, gateway}, opsFile: {ops, edited},
		}},
		{"the call commented out", "released step gateway:fill-id-indexes was removed", gatewayFile, map[string][2]string{
			gatewayFile: {gateway, strings.Replace(gateway, gatewayCall, "/* "+gatewayCall+" */", 1)}, opsFile: {ops, ops},
		}},
		{"another module's identical call", "released step gateway:fill-id-indexes was removed", gatewayFile, map[string][2]string{
			gatewayFile: {gateway, removed}, opsFile: {ops, ops}, otherFile: {other, other},
		}},
		{"a double-quoted step key", "declares ops:fill-event-log-id-index", opsFile, map[string][2]string{
			gatewayFile: {gateway, gateway}, opsFile: {quotedKey(`"`, ops), quotedKey(`"`, edited)},
		}},
		{"a single-quoted step key", "declares ops:fill-event-log-id-index", opsFile, map[string][2]string{
			gatewayFile: {gateway, gateway}, opsFile: {quotedKey(`'`, ops), quotedKey(`'`, edited)},
		}},
		{"the owner's call wrapped with a trailing comma", "declares gateway:fill-id-indexes", gatewayFile, map[string][2]string{
			gatewayFile: {wrapped(gateway), wrapped(strings.Replace(gateway, "Fills gateway.", "Fills more.", 1))}, opsFile: {ops, ops},
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			findings := idIndexFindings(t, c.files)
			if len(findings) != 1 || findings[0].Entry != c.entry || !strings.Contains(findings[0].Problem, c.problem) {
				t.Errorf("want one finding on %s %q, got %+v", c.entry, c.problem, findings)
			}
		})
	}
}

// @scenario "An after list with a comment before its colon or its bracket is still a reference"
func TestStepsTreatsAnAfterListBehindACommentAsAReference(t *testing.T) {
	const file = "modules/gateway/process/src/gateway.module.ts"
	for _, after := range []string{"after: /* dependency */ [", "after /* dependency */: [", "after // dependency\n    : ["} {
		t.Run(after, func(t *testing.T) {
			base := "export const gateway = defineProcessModule(\"gateway\")\n  .withIdIndexes(GATEWAY_ID_INDEXES, {\n    " + after + "\"coding-agent:fill-id-indexes\"],\n  });\n"
			head := "import { more } from \"./more\";\n" + base
			if findings := idIndexFindings(t, map[string][2]string{file: {base, head}}); len(findings) != 0 {
				t.Errorf("an unrelated line beside a commented after list, want no finding, got %+v", findings)
			}
		})
	}
}

// @scenario "After-list text in a comment or a string is not an after list"
func TestStepsIgnoresAfterListTextInACommentOrAString(t *testing.T) {
	const file = "modules/gateway/process/src/fill.ts"
	for name, base := range map[string]string{
		"a comment": "const steps = { // after: [\n  fill: customStep(\"coding-agent:fill-id-indexes\") };\n",
		"a string":  "const steps = { note: \"after: [\", // \"\n  fill: customStep(\"coding-agent:fill-id-indexes\") };\n",
	} {
		t.Run(name, func(t *testing.T) {
			head := "import { more } from \"./more\";\n" + base
			findings := idIndexFindings(t, map[string][2]string{file: {base, head}})
			if len(findings) != 1 || findings[0].Entry != file || !strings.Contains(findings[0].Problem, "declares coding-agent:fill-id-indexes") {
				t.Errorf("an edit to a file naming the step outside an after list, want one finding, got %+v", findings)
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

// @scenario "A file that only names a released step in a comment may still change"
func TestStepsLeavesAFileThatOnlyMentionsAStepInACommentAlone(t *testing.T) {
	const appFile = "modules/topic/process/src/app/topic.app.ts"
	root := initRepo(t)
	writeAndCommit(t, root, stepFile, "export const step = defineMigrationStep({ id: \"topic:seed-clusters\" });\n")
	writeAndCommit(t, root, appFile, "/** Step `topic:seed-clusters`: fills clusters. */\n// see 'topic:seed-clusters'\nexport const app = 1;\n")
	writeAndCommit(t, root, "packages/upgrade/releases/3.21.0.json", releasedManifest)
	gitIn(t, root, "checkout", "-q", "-b", "feature")
	writeAndCommit(t, root, appFile, "/** Step `topic:seed-clusters`: fills clusters. */\nexport const app = 2;\n")

	in, err := migrationorder.Repo{Root: root}.Steps(t.Context(), "main")
	if err != nil {
		t.Fatal(err)
	}
	if findings := migrationorder.CheckSteps(in); len(findings) != 0 {
		t.Errorf("a file naming the step only in comments changed, want no finding, got %+v", findings)
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
