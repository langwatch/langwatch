package lintrun_test

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/lintrun"
)

// A stand-in for node_modules/.bin/oxlint: it prints a config for --print-config,
// records every lint call, and answers each with $OXLINT_OUTPUT and $OXLINT_STATUS.
const fakeOxlint = `#!/bin/sh
if [ "$1" = "--print-config" ]; then
  echo '{"ignorePatterns":["generated/**"],"rules":{"typescript/no-floating-promises":"error"}}'
  exit 0
fi
echo "$@" >> "$OXLINT_CALLS"
printf '%s' "$OXLINT_OUTPUT"
exit "$OXLINT_STATUS"
`

type workspace struct {
	root, calls string
}

func newWorkspace(t *testing.T) workspace {
	t.Helper()
	root := t.TempDir()
	write := func(name, content string, mode os.FileMode) {
		path := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), mode); err != nil {
			t.Fatal(err)
		}
	}
	write("pnpm-workspace.yaml", "packages:\n  - apps/*\n", 0o600)
	write("nx.json", `{"namedInputs":{"lintGlobals":["{workspaceRoot}/.oxlintrc.jsonc"]}}`, 0o600)
	write(".oxlintrc.jsonc", "{}", 0o600)
	write("node_modules/.bin/oxlint", fakeOxlint, 0o755)
	write(".gitignore", "node_modules/\n", 0o600)
	write("apps/api/package.json", `{"name":"@langwatch/api"}`, 0o600)
	write("apps/api/tsconfig.json", "{}", 0o600)
	write("apps/notes/package.json", `{"name":"notes"}`, 0o600)
	t.Setenv("GIT_CONFIG_GLOBAL", os.DevNull)
	t.Setenv("GIT_CONFIG_NOSYSTEM", "1")
	for _, args := range [][]string{
		{"init", "-q"},
		{"add", "."},
		{"-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "base"},
	} {
		cmd := exec.Command("git", args...)
		cmd.Dir = root
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	write("generated/client.ts", "export {};\n", 0o600)
	calls := filepath.Join(t.TempDir(), "calls")
	t.Setenv("OXLINT_CALLS", calls)
	t.Chdir(root)
	return workspace{root: root, calls: calls}
}

func (w workspace) run(t *testing.T, output string, status string, args ...string) (int, string, string) {
	t.Helper()
	t.Setenv("OXLINT_OUTPUT", output)
	t.Setenv("OXLINT_STATUS", status)
	var stdout, stderr bytes.Buffer
	code := lintrun.Run(args, &stdout, &stderr)
	return code, stdout.String(), stderr.String()
}

func (w workspace) lintCalls(t *testing.T) []string {
	t.Helper()
	data, err := os.ReadFile(w.calls)
	if err != nil {
		return nil
	}
	return strings.Split(strings.TrimSpace(string(data)), "\n")
}

// @scenario "A change whose lintable files are all ignored passes"
func TestRunPassesWhenOxlintFindsNoFilesToLint(t *testing.T) {
	w := newWorkspace(t)
	code, stdout, stderr := w.run(t, noFilesOutput, "1", "--base", "HEAD")

	if code != 0 || stdout != "\n0 problem(s)\n" {
		t.Errorf("exit %d, stdout %q, stderr %q; want exit 0 and 0 problem(s)", code, stdout, stderr)
	}
	calls := w.lintCalls(t)
	want := "--quiet -f json -c .oxlintrc.native.jsonc --ignore-pattern generated/** generated/client.ts"
	if len(calls) != 2 || (calls[0] != want && calls[1] != want) {
		t.Errorf("oxlint calls = %q, want the native and plugin runs over generated/client.ts", calls)
	}
}

func TestRunFailsOnAFindingAndPrintsIt(t *testing.T) {
	w := newWorkspace(t)
	report := `{"diagnostics":[{"message":"Too long.","code":"langwatch(comment-block-size)","filename":"generated/client.ts","labels":[{"span":{"offset":0,"length":1,"line":1,"column":1}}]}]}`
	code, stdout, _ := w.run(t, report, "1", "--base", "HEAD")

	want := "generated/client.ts:1:1: Too long. [langwatch(comment-block-size)]\n" +
		"generated/client.ts:1:1: Too long. [langwatch(comment-block-size)]\n\n2 problem(s)\n"
	if code != 1 || stdout != want {
		t.Errorf("exit %d, stdout %q; want exit 1 and %q", code, stdout, want)
	}
}

func TestRunFailsWhenOxlintFailsToRun(t *testing.T) {
	w := newWorkspace(t)
	code, stdout, stderr := w.run(t, "Failed to parse configuration file.", "2", "--base", "HEAD")

	if code != 1 || stdout != "\n0 problem(s)\n" || !strings.Contains(stderr, "oxlint -c .oxlintrc.native.jsonc exited 2:") {
		t.Errorf("exit %d, stdout %q, stderr %q; want exit 1 and the failed run named", code, stdout, stderr)
	}
}

func TestRunWithTypesAddsTheTypeAwareProcess(t *testing.T) {
	w := newWorkspace(t)
	code, _, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--types")

	if code != 0 {
		t.Fatalf("exit %d, stderr %q", code, stderr)
	}
	calls := w.lintCalls(t)
	want := "--quiet -f json -c .oxlintrc.types.jsonc --type-aware --ignore-pattern generated/** apps/api"
	if len(calls) != 3 || !slices.Contains(calls, want) {
		t.Errorf("oxlint calls = %q, want three runs, one of them %q", calls, want)
	}
}

func TestRunChangedWithNothingChangedExitsQuietly(t *testing.T) {
	w := newWorkspace(t)
	w.git(t, "update-ref", "refs/remotes/origin/main", "HEAD")
	if err := os.RemoveAll(filepath.Join(w.root, "generated")); err != nil {
		t.Fatal(err)
	}
	code, stdout, _ := w.run(t, "", "0", "--changed")

	if code != 0 || stdout != "" || len(w.lintCalls(t)) != 0 {
		t.Errorf("exit %d, stdout %q, calls %q; want a silent exit 0", code, stdout, w.lintCalls(t))
	}
}

func (w workspace) git(t *testing.T, args ...string) {
	t.Helper()
	argv := append([]string{"-c", "user.name=t", "-c", "user.email=t@example.com"}, args...)
	cmd := exec.Command("git", argv...)
	cmd.Dir = w.root
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
}

// commitChange commits apps/api/src/a.ts on a new branch and drops the untracked fixture,
// so the tracked git diff is the only source of changed files.
func (w workspace) commitChange(t *testing.T) {
	t.Helper()
	if err := os.RemoveAll(filepath.Join(w.root, "generated")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(w.root, "apps", "api", "src"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(w.root, "apps", "api", "src", "a.ts"), []byte("export {};\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	w.git(t, "checkout", "-q", "-b", "work")
	w.git(t, "add", "apps/api/src/a.ts")
	w.git(t, "commit", "-qm", "change")
}

func (w workspace) wantLinted(t *testing.T, file string, code int, stderr string) {
	t.Helper()
	want := "--quiet -f json -c .oxlintrc.native.jsonc --ignore-pattern generated/** " + file
	if code != 0 || !slices.Contains(w.lintCalls(t), want) {
		t.Errorf("exit %d, stderr %q, calls %q; want the committed change linted as %q", code, stderr, w.lintCalls(t), want)
	}
}

func TestRunChangedLintsACommitSinceTheUpstream(t *testing.T) {
	w := newWorkspace(t)
	w.git(t, "branch", "trunk")
	w.commitChange(t)
	w.git(t, "branch", "--set-upstream-to=trunk")
	code, _, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--changed")

	w.wantLinted(t, "apps/api/src/a.ts", code, stderr)
}

func TestRunChangedFallsBackToOriginMain(t *testing.T) {
	w := newWorkspace(t)
	w.git(t, "update-ref", "refs/remotes/origin/main", "HEAD")
	w.commitChange(t)
	code, _, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--changed")

	w.wantLinted(t, "apps/api/src/a.ts", code, stderr)
}

func TestRunChangedFallsBackToTheNamedIntegrationBranch(t *testing.T) {
	w := newWorkspace(t)
	w.git(t, "update-ref", "refs/remotes/origin/feat/strict-feature-layout-v0", "HEAD")
	w.commitChange(t)
	code, _, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--changed")

	w.wantLinted(t, "apps/api/src/a.ts", code, stderr)
}

func TestRunChangedFailsWhenNoMergeBaseExists(t *testing.T) {
	w := newWorkspace(t)
	w.commitChange(t)
	code, _, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--changed")

	if code != 1 || !strings.Contains(stderr, "no merge base") || len(w.lintCalls(t)) != 0 {
		t.Errorf("exit %d, stderr %q, calls %q; want a loud failure and no oxlint run", code, stderr, w.lintCalls(t))
	}
}

func TestRunBaseFailsWhenGitCannotReadTheBase(t *testing.T) {
	w := newWorkspace(t)
	code, stdout, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--base", "0123456789abcdef0123456789abcdef01234567")

	if code != 1 || stdout != "" || !strings.Contains(stderr, "git diff --name-only") || len(w.lintCalls(t)) != 0 {
		t.Errorf("exit %d, stdout %q, stderr %q; want exit 1 naming the failed git diff", code, stdout, stderr)
	}
}

func TestRunFailsWithOxlintsReasonWhenPrintConfigFails(t *testing.T) {
	w := newWorkspace(t)
	script := "#!/bin/sh\necho 'Failed to parse configuration file.' >&2\nexit 3\n"
	if err := os.WriteFile(filepath.Join(w.root, "node_modules", ".bin", "oxlint"), []byte(script), 0o755); err != nil { //nolint:gosec // a test stand-in must be executable
		t.Fatal(err)
	}
	code, _, stderr := w.run(t, "", "0", "--base", "HEAD")

	for _, want := range []string{"oxlint --print-config -c .oxlintrc.jsonc failed", "exit status 3", "Failed to parse configuration file."} {
		if code != 1 || !strings.Contains(stderr, want) {
			t.Errorf("exit %d, stderr %q; want it to contain %q", code, stderr, want)
		}
	}
}

// @scenario "A disable directive is unused only when no lint process used it"
func TestRunLeavesATypeAwareDirectiveToTheTypesRun(t *testing.T) {
	w := newWorkspace(t)
	directive := "// oxlint-disable-next-line typescript/no-floating-promises"
	if err := os.WriteFile(filepath.Join(w.root, "generated", "client.ts"), []byte(directive+"\nexport {};\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	report := `{"diagnostics":[{"message":"Unused oxlint-disable directive (no problems were reported).","filename":"generated/client.ts","labels":[{"span":{"offset":0,"length":59,"line":1,"column":1}}]}]}`

	if code, stdout, _ := w.run(t, report, "1", "--base", "HEAD"); code != 0 || stdout != "\n0 problem(s)\n" {
		t.Errorf("plain run: exit %d, stdout %q; want the type-aware directive left unjudged", code, stdout)
	}
	if code, stdout, _ := w.run(t, report, "1", "--types"); code != 1 || !strings.HasSuffix(stdout, "\n1 problem(s)\n") {
		t.Errorf("types run: exit %d, stdout %q; want the directive reported", code, stdout)
	}
}

// fakePnpm puts a pnpm on PATH that prints $PNPM_STDOUT, writes $PNPM_STDERR and exits $PNPM_STATUS.
func fakePnpm(t *testing.T, stdout, stderr, status string) {
	t.Helper()
	dir := t.TempDir()
	script := "#!/bin/sh\nprintf '%s' \"$PNPM_STDOUT\"\nprintf '%s' \"$PNPM_STDERR\" >&2\nexit \"$PNPM_STATUS\"\n"
	if err := os.WriteFile(filepath.Join(dir, "pnpm"), []byte(script), 0o755); err != nil { //nolint:gosec // a test stand-in must be executable
		t.Fatal(err)
	}
	t.Setenv("PATH", dir+string(os.PathListSeparator)+os.Getenv("PATH"))
	t.Setenv("PNPM_STDOUT", stdout)
	t.Setenv("PNPM_STDERR", stderr)
	t.Setenv("PNPM_STATUS", status)
}

func TestRunWithTypesFailsWhenNxFailsAndPrintsItsStderr(t *testing.T) {
	w := newWorkspace(t)
	fakePnpm(t, "", "nx: cannot reach the daemon", "3")
	code, _, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--types", "--base", "HEAD")

	if code != 3 || !strings.Contains(stderr, "nx: cannot reach the daemon") || len(w.lintCalls(t)) != 0 {
		t.Errorf("exit %d, stderr %q, calls %q; want nx's status, its stderr and no oxlint run", code, stderr, w.lintCalls(t))
	}
}

func TestRunWithTypesLintsTheProjectsNxListed(t *testing.T) {
	w := newWorkspace(t)
	fakePnpm(t, `["@langwatch/api"]`, "", "0")
	code, _, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--types", "--base", "HEAD")

	want := "--quiet -f json -c .oxlintrc.types.jsonc --type-aware --ignore-pattern generated/** apps/api"
	if code != 0 || !slices.Contains(w.lintCalls(t), want) {
		t.Errorf("exit %d, stderr %q, calls %q; want the listed project linted", code, stderr, w.lintCalls(t))
	}
}

func TestRunWithTypesFailsClearlyWhenPnpmIsMissing(t *testing.T) {
	w := newWorkspace(t)
	t.Setenv("PATH", t.TempDir())
	code, _, stderr := w.run(t, `{"diagnostics":[]}`, "0", "--types", "--base", "HEAD")

	if code != 1 || !strings.Contains(stderr, "nx show projects: cannot run pnpm") || len(w.lintCalls(t)) != 0 {
		t.Errorf("exit %d, stderr %q; want exit 1 naming the missing pnpm", code, stderr)
	}
}

func TestRunAcceptsFlagsAfterAPositionalArgument(t *testing.T) {
	w := newWorkspace(t)
	code, stdout, stderr := w.run(t, `{"diagnostics":[]}`, "0", "apps/api", "--types")

	if code != 0 || len(w.lintCalls(t)) != 3 {
		t.Errorf("exit %d, stdout %q, stderr %q, calls %q; want --types applied after a positional", code, stdout, stderr, w.lintCalls(t))
	}
}

func TestRunRefusesAnUnknownFlagWithStatusTwo(t *testing.T) {
	w := newWorkspace(t)
	if code, _, _ := w.run(t, "", "0", "--bogus"); code != 2 {
		t.Errorf("exit %d, want 2", code)
	}
}
