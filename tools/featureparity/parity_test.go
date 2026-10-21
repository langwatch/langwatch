package featureparity

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"testing"
)

const nodeTool = "packages/architecture-enforcer/src/tools/check-feature-parity.ts"

func repoRoot(t *testing.T) string {
	t.Helper()
	wd, _ := os.Getwd()
	root, err := FindRepoRoot(wd)
	if err != nil {
		t.Fatal(err)
	}
	return root
}

// tsListSpan is the byte span of the body of `const name: string[] = [...]`.
func tsListSpan(src, name string) (int, int) {
	head := "const " + name + ": string[] = ["
	start := strings.Index(src, head) + len(head)
	if k := strings.Index(src[start:start+strings.Index(src[start:], "\n")], "]"); k >= 0 {
		return start, start + k
	}
	return start, start + strings.Index(src[start:], "\n];") + 1
}

var (
	tsEntryLine = regexp.MustCompile(`(?m)^\s*"([^"]+)",?\s*$`)
	tsQuoted    = regexp.MustCompile(`"([^"]+)"`)
)

// tsList reads a list's entries, skipping the reason comments between them.
func tsList(src, name string) []string {
	s, e := tsListSpan(src, name)
	re := tsEntryLine
	if !strings.Contains(src[s:e], "\n") {
		re = tsQuoted
	}
	var out []string
	for _, m := range re.FindAllStringSubmatch(src[s:e], -1) {
		out = append(out, m[1])
	}
	return out
}

var tsListNames = []string{"DEFAULT_TEST_ROOTS", "DEFAULT_BATS_TEST_ROOTS", "DEFAULT_SHELL_TEST_ROOTS", "DEFAULT_GO_TEST_ROOTS", "DEFAULT_PYTHON_TEST_ROOTS", "LEGACY_UNBOUND"}

func listsInOrder(l Lists) [][]string {
	return [][]string{l.TSRoots, l.BatsRoots, l.ShellRoots, l.GoRoots, l.PythonRoots, l.LegacyUnbound}
}

func TestListsMatchNodeTool(t *testing.T) {
	src, err := os.ReadFile(filepath.Join(repoRoot(t), nodeTool))
	if err != nil {
		t.Skip("Node tool removed; the Go lists are the only copy")
	}
	for i, got := range listsInOrder(DefaultLists()) {
		if want := tsList(string(src), tsListNames[i]); !slices.Equal(got, want) {
			t.Errorf("%s drifted from %s:\n go:   %q\n node: %q", tsListNames[i], nodeTool, got, want)
		}
	}
}

func titles(src string) []string {
	var out []string
	for _, a := range FindScenarioAnnotations(src) {
		out = append(out, a.Title)
	}
	return out
}

func TestFindScenarioAnnotations(t *testing.T) {
	cases := []struct {
		name, src string
		want      []string
	}{
		{"python docstring", "def test_it():\n    \"\"\"\n    @scenario Docstring form\n    \"\"\"\n", []string{"Docstring form"}},
		{"open block comment", "/*\n@scenario Marker-less block form\n*/", []string{"Marker-less block form"}},
		{"bare source line", `@scenario "Bare line"`, nil},
		{"template literal fixture", "const fixture = `\n@scenario \"Quoted in a fixture\"\n`;", nil},
		{"after a closed comment", "/* opened and closed */\n@scenario \"After the comment\"", nil},
		{"jsdoc quoted", `/** @scenario "Quoted title" */`, []string{"Quoted title"}},
		{"indented", `    /** @scenario "Indented" */`, []string{"Indented"}},
		{"continuation unquoted", " * @scenario Unquoted continuation", []string{"Unquoted continuation"}},
		{"line comment", "  // @scenario Line comment form", []string{"Line comment form"}},
		{"nested marker", "  *   /** @scenario Nested marker */", []string{"Nested marker"}},
		{"hash comment", "# @scenario Unquoted hash form", []string{"Unquoted hash form"}},
		{"lone slash", "/ @scenario Not a comment", nil},
		{"closing marker", "*/ @scenario Not a comment", nil},
		{"marker run", "/" + strings.Repeat("**/", 30) + "x", nil},
		{"prose", "// Deliberately carries no @scenario annotation: this guards", nil},
		{"trailing code", "const x = 1; // see @scenario Something for context", nil},
		{"two annotations", "/** @scenario \"First\" */\n/** @scenario \"Second\" */", []string{"First", "Second"}},
		{"CRLF quoted", "// @scenario \"Carriage\"\r\nit(", []string{"Carriage"}},
		{"CR is a JS line start", "x\r// @scenario \"After CR\"", []string{"After CR"}},
	}
	for _, c := range cases {
		if got := titles(c.src); !slices.Equal(got, c.want) {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestGoBindings(t *testing.T) {
	cases := []struct {
		name string
		src  []string
		want []string
	}{
		{"one-line subtest", []string{"func TestThing(t *testing.T) {", "\t// @scenario \"One-line subtest\"", "\tt.Run(\"stays on one line\", func(t *testing.T) {", "\t})", "}"}, []string{"One-line subtest"}},
		{"multiline subtest", []string{"func TestThing(t *testing.T) {", "\t// @scenario \"Multiline subtest\"", "\tt.Run(", "\t\t\"a long name\",", "\t\tfunc(t *testing.T) {", "\t\t},", "\t)", "}"}, []string{"Multiline subtest"}},
		{"nested comma", []string{"func TestThing(t *testing.T) {", "\t// @scenario \"Nested comma subtest\"", "\tt.Run(fmt.Sprintf(\"%s,%s\", tc.a, tc.b), func(t *testing.T) {", "\t})", "}"}, []string{"Nested comma subtest"}},
		{"top-level func", []string{"/** @scenario \"Top-level test func\" */", "func TestThing(t *testing.T) {", "}"}, []string{"Top-level test func"}},
		{"Run without closure", []string{"func TestThing(t *testing.T) {", "\t// @scenario \"Not a subtest\"", "\tserver.Run(ctx)", "}"}, nil},
	}
	for _, c := range cases {
		var got []string
		for _, b := range blockBindings("x_test.go", strings.Join(c.src, "\n"), IsFollowedByGoTestFunc) {
			got = append(got, b.Title)
		}
		if !slices.Equal(got, c.want) {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestLocaleCompareMatchesICU(t *testing.T) {
	got := []string{"Ab", "aB", "ab", "a0", "a/B/c", "a/b/C", "a/b", "a.b", "a-b", "a_b"}
	slices.SortStableFunc(got, localeCompare)
	want := []string{"a_b", "a-b", "a.b", "a/b", "a/b/C", "a/B/c", "a0", "ab", "aB", "Ab"}
	if !slices.Equal(got, want) {
		t.Errorf("got %q, want %q", got, want)
	}
}

// passingFrozen and failingFrozen are the per-scenario tolerance both tools read.
const passingFrozen = `{
  "untagged": {
    "specs/inert.feature": ["Untagged"],
    "specs/partial.feature": ["Partial untagged"],
    "specs/annotated.feature": ["Annotated only"]
  },
  "unimplementedWithoutIssue": { "specs/inert.feature": ["Parked"] },
  "annotatedUntagged": { "packages/p/src/b.test.ts": ["Annotated only"] }
}
`

const failingFrozen = `{
  "untagged": {
    "specs/inert.feature": ["Untagged", "Untagged"],
    "specs/partial.feature": ["Partial untagged"],
    "specs/annotated.feature": ["Annotated only"],
    "specs/bound.feature": ["Bound in TS"]
  },
  "unimplementedWithoutIssue": { "specs/inert.feature": ["Parked", "Gone"] },
  "annotatedUntagged": { "packages/p/src/b.test.ts": ["Annotated only", "Never annotated"] }
}
`

// fixture writes a small repository that exercises every report section.
func fixture(t *testing.T, passing bool) (string, Lists) {
	t.Helper()
	dir := t.TempDir()
	files := map[string]string{
		"pnpm-workspace.yaml":                "",
		"sdks/typescript/specs/.keep":        "",
		"specs/bound.feature":                "@unit\nFeature: Bound\n  Scenario: Bound in TS\n    Given x\n  Scenario: Bound in bats\n  Scenario: Bound in shell\n  Scenario: Bound in Go\n  Scenario: Bound in Python\n",
		"specs/legacy.feature":               "Feature: Legacy\n  @unit\n  Scenario: Legacy bound\n  @integration\n  Scenario: Legacy unbound\n",
		"specs/inert.feature":                "Feature: Inert\n  @unimplemented\n  Scenario: Parked\n  # Tracked in #12\n  @unimplemented\n  Scenario: Parked by comment\n  @unimplemented @issue:7\n  Scenario: Parked by tag\n  Scenario: Untagged\n",
		"specs/partial.feature":              "Feature: Partial\n  @unit\n  Scenario: Partial bound\n  Scenario: Partial untagged\n",
		"specs/annotated.feature":            "Feature: Annotated\n  Scenario: Annotated only\n",
		"packages/p/specs/empty.feature":     "Feature: Empty\n",
		"packages/p/src/a.test.ts":           "/** @scenario \"Bound in TS\" */\nit(\"x\", () => {});\n/** @scenario Legacy bound */\ntest(\"y\");\n/** @scenario Partial bound */\nvoid it(\"z\");\n",
		"packages/p/src/b.test.ts":           "/** @scenario \"Annotated only\" */\nit(\"x\", () => {});\n",
		"dev/scripts/__tests__/a.bats":       "# @scenario \"Bound in bats\"\n\n@test \"x\" {\n}\n",
		"charts/langwatch/tests/a.sh":        "# @scenario 'Bound in shell'\ntest_it() {\n}\n",
		"services/nlpgo/a_test.go":           "// @scenario \"Bound in Go\"\nfunc TestIt(t *testing.T) {}\n",
		"services/langevals/tests/test_a.py": "# @scenario \"Bound in Python\"\n@pytest.mark.x(\n  1)\ndef test_it():\n  pass\n",
		frozenRelative:                       passingFrozen,
	}
	lists := DefaultLists()
	lists.LegacyUnbound = []string{"specs/legacy.feature"}
	if !passing {
		files[frozenRelative] = failingFrozen
		files["specs/new-inert.feature"] = "Feature: New inert\n  Scenario: Nothing tagged\n  @unimplemented\n  Scenario: New parked\n"
		files["specs/new-partial.feature"] = "Feature: New partial\n  @e2e\n  Scenario: New unbound\n  Scenario: Also untagged\n"
		files["specs/lane.feature"] = "Feature: Lane\n  @unimplemented @issue-3\n  Scenario: Parked but tested\n  Scenario: Untagged but tested\n"
		files["packages/p/src/lane.integration.test.ts"] = "/** @scenario \"Parked but tested\" */\nit(\"x\");\n/** @scenario \"Untagged but tested\" */\nit(\"y\");\n"
		files["packages/z/b.spec.tsx"] = "// @scenario \"No such scenario\"\nit(\"x\");\n"
		files["packages/A/b.test.mjs"] = "// @scenario \"Another unknown\"\nit(\"x\");\n"
		lists.LegacyUnbound = append(lists.LegacyUnbound, "specs/missing.feature", "specs/legacy.feature", "specs/partial.feature")
	}
	for name, body := range files {
		p := filepath.Join(dir, name)
		if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir, lists
}

func run(repo string, lists Lists, args ...string) (string, string, int) {
	var out, errOut bytes.Buffer
	code := RunAt(Invocation{Repo: repo, Lists: lists, Args: args, Stdout: &out, Stderr: &errOut})
	return out.String(), errOut.String(), code
}

func TestFixturePasses(t *testing.T) {
	repo, lists := fixture(t, true)
	out, errOut, code := run(repo, lists)
	if code != 0 || errOut != "" {
		t.Fatalf("exit %d, stderr %q\n%s", code, errOut, out)
	}
	for _, want := range []string{
		"Enforced: 5 file(s) · Legacy: 1 file(s) · Inert: 2 file(s)",
		"▸ specs/bound.feature\n  5/5 scenarios bound\n  ✓ all bound",
		"  1/1 tagged scenario(s) bound · 1 scenario(s) untagged and unmeasured",
		"  0 of 4 scenario(s) enforced — 3 @unimplemented, the rest untagged",
		"  · specs/legacy.feature  1/2 bound, 1 unbound",
		"OK: 6 enforced scenario(s) bound across 5 file(s).",
		"3 untagged scenario(s) tolerated by name in " + frozenRelative,
		"1 @unimplemented scenario(s) citing no issue tolerated by name",
		"1 @scenario annotation(s) on a scenario with no binding tag tolerated by name",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
}

func TestFixtureFails(t *testing.T) {
	repo, lists := fixture(t, false)
	out, errOut, code := run(repo, lists)
	if code != 1 {
		t.Fatalf("exit %d", code)
	}
	for _, want := range []string{
		"✗ THIS RUN FAILS: 1 unbound scenario(s) in enforced files, 2 unknown annotation(s)",
		"    ✗ [@e2e] New unbound\n      specs/new-partial.feature:3",
		"\n  ▸ packages/A/b.test.mjs\n    ✗ @scenario Another unknown\n      line 1\n\n  ▸ packages/z/b.spec.tsx",
		"  ✗ packages/p/src/lane.integration.test.ts:1 @scenario \"Parked but tested\"\n      binds specs/lane.feature:3, which is @unimplemented and missing @integration.",
		"  ✗ packages/p/src/lane.integration.test.ts:3 @scenario \"Untagged but tested\"\n      binds specs/lane.feature:4, which is missing @integration. Add @integration",
		"  ✗ specs/new-inert.feature:2 \"Nothing tagged\"",
		"  ✗ specs/new-inert.feature:4 \"New parked\"",
		"Frozen entries that no longer apply (remove them from \"untagged\" in " + frozenRelative + "):\n  ✗ specs/inert.feature \"Untagged\"\n  ✗ specs/bound.feature \"Bound in TS\"",
		"(remove them from \"unimplementedWithoutIssue\" in " + frozenRelative + "):\n  ✗ specs/inert.feature \"Gone\"",
		"(remove them from \"annotatedUntagged\" in " + frozenRelative + "):\n  ✗ packages/p/src/b.test.ts \"Never annotated\"",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in stdout:\n%s", want, out)
		}
	}
	for _, want := range []string{
		"Exemption list: LEGACY_UNBOUND entry does not resolve to an existing .feature file: specs/missing.feature",
		"Exemption list: LEGACY_UNBOUND contains duplicate entry: specs/legacy.feature",
		"1 fully-bound file(s) still in LEGACY_UNBOUND — remove them from the list: specs/partial.feature",
		"2 @scenario annotation(s) bind a scenario carrying no binding tag",
		"@unimplemented scenario(s) cite no tracked issue",
		"frozen scenario entr(y/ies) no longer apply — remove them from " + frozenRelative,
	} {
		if !strings.Contains(errOut, want) {
			t.Errorf("missing %q in stderr:\n%s", want, errOut)
		}
	}
}

// TestFrozenFileIsTheOnlyTolerance pins that the Go tool reads the frozen JSON
// the Node tool reads, and that on this repository every entry it holds still applies.
func TestFrozenFileIsTheOnlyTolerance(t *testing.T) {
	frozen, err := loadFrozen(repoRoot(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(frozen.Untagged.Files) == 0 {
		t.Fatal("frozen file lists no untagged scenarios; is it being read?")
	}
	a, err := Analyze(repoRoot(t), DefaultLists())
	if err != nil {
		t.Fatal(err)
	}
	// Only the frozen verdicts: an unrelated unbound scenario is not this test's business.
	if n := len(a.Untagged.Fresh) + len(a.Untagged.Stale) + len(a.UnimplementedWithoutIssue.Fresh) + len(a.UnimplementedWithoutIssue.Stale) +
		len(a.AnnotationsOnUntagged.Fresh) + len(a.AnnotationsOnUntagged.Stale); n > 0 {
		t.Errorf("%d findings disagree with the frozen file: %q", n, FormatFrozenFailures(a))
	}
}

// TestFixtureMatchesNodeTool runs the Node tool on the same fixtures, with its
// lists rewritten to the fixture's, and requires identical output and exit.
func TestFixtureMatchesNodeTool(t *testing.T) {
	node, err := exec.LookPath("node")
	src, readErr := os.ReadFile(filepath.Join(repoRoot(t), nodeTool))
	if err != nil || readErr != nil {
		t.Skip("needs node and the Node tool")
	}
	for _, passing := range []bool{true, false} {
		repo, lists := fixture(t, passing)
		script := string(src)
		for i, list := range listsInOrder(lists)[5:] {
			s, e := tsListSpan(script, tsListNames[5+i])
			quoted := make([]string, len(list))
			for k, v := range list {
				quoted[k] = `"` + v + `"`
			}
			script = script[:s] + strings.Join(quoted, ", ") + script[e:]
		}
		path := filepath.Join(repo, "tool", "check.ts")
		root, err := os.OpenRoot(repo)
		if err != nil {
			t.Fatal(err)
		}
		_ = root.MkdirAll("tool", 0o750)
		// The Node tool reads the frozen file beside itself.
		frozen, _ := root.ReadFile(frozenRelative)
		if err := root.WriteFile(filepath.Join("tool", "feature-parity-frozen.json"), frozen, 0o600); err != nil {
			t.Fatal(err)
		}
		if err := root.WriteFile(filepath.Join("tool", "check.ts"), []byte(script), 0o600); err != nil {
			t.Fatal(err)
		}
		_ = root.Close()
		for _, args := range [][]string{nil, {"--json"}} {
			var nOut, nErr bytes.Buffer
			cmd := exec.Command(node, append([]string{"--no-warnings", "--experimental-transform-types", path}, args...)...)
			cmd.Stdout, cmd.Stderr = &nOut, &nErr
			runErr := cmd.Run()
			nCode := 0
			if ee, ok := runErr.(*exec.ExitError); ok {
				nCode = ee.ExitCode()
			}
			gOut, gErr, gCode := run(repo, lists, args...)
			if gOut != nOut.String() || gErr != nErr.String() || gCode != nCode {
				t.Errorf("passing=%v args=%v: node exit %d, go exit %d\n--- node stdout\n%s\n--- go stdout\n%s\n--- node stderr\n%s\n--- go stderr\n%s",
					passing, args, nCode, gCode, nOut.String(), gOut, nErr.String(), gErr)
			}
		}
	}
}

// BenchmarkAnalyze is the core pass over this repository's tree.
func BenchmarkAnalyze(b *testing.B) {
	wd, _ := os.Getwd()
	repo, err := FindRepoRoot(wd)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := Analyze(repo, DefaultLists()); err != nil {
			b.Fatal(err)
		}
	}
}
