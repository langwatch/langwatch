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

// @scenario "A plain lint:changed lints the changed files, not their dependants"
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
	if err := os.RemoveAll(filepath.Join(w.root, "generated")); err != nil {
		t.Fatal(err)
	}
	code, stdout, _ := w.run(t, "", "0", "--changed")

	if code != 0 || stdout != "" || len(w.lintCalls(t)) != 0 {
		t.Errorf("exit %d, stdout %q, calls %q; want a silent exit 0", code, stdout, w.lintCalls(t))
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
