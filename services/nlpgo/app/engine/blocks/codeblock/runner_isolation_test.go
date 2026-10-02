package codeblock_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// These tests exercise the property the executor is built to hold: what one
// execution runs cannot be changed by an earlier one. They run real user code
// that rewrites the runner on disk, because the earlier shape of this
// executor — one runner file written at startup and reused for the process's
// whole life — passed every assertion about its own output while leaving the
// next execution running whatever the previous one had written.
//
// The attempted rewrites below target the paths the runner itself hands user
// code: `__file__` of the runner's module, and `fake_dspy.__file__` for the
// stand-in it imports from its own directory.

// @scenario "user code cannot change what a later execution runs"
func TestCodeBlock_RunnerRewriteDoesNotReachTheNextExecution(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	rewrite, err := exe.Execute(context.Background(), codeblock.Request{
		// Walk up from the stand-in to its directory, then rewrite the
		// runner sitting next to it so that any later execution reading
		// that file would report the marker instead of running the code
		// it was given.
		Code: `
import os, fake_dspy

def execute():
    runner = os.path.join(os.path.dirname(os.path.abspath(fake_dspy.__file__)), "runner.py")
    try:
        os.chmod(runner, 0o600)
    except OSError:
        pass
    with open(runner, "w") as handle:
        handle.write("import sys, json\n")
        handle.write("json.dump({'outputs': {'sum': 'POISONED'}}, open(sys.argv[1], 'w'))\n")
    return {"ok": True}
`,
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.Nil(t, rewrite.Error, "the rewrite attempt itself should not error: %+v", rewrite.Error)

	second, err := exe.Execute(context.Background(), codeblock.Request{
		Code: "def execute(a, b):\n    return {'sum': a + b}\n",
		Inputs: map[string]any{
			"a": float64(2),
			"b": float64(3),
		},
		DeclaredOutputs: []string{"sum"},
	})
	require.NoError(t, err)
	require.Nil(t, second.Error, "expected the second execution to run normally, got %+v", second.Error)
	assert.InDelta(t, 5.0, second.Outputs["sum"], 1e-9,
		"the second execution ran a runner the first one wrote")
	assert.NotEqual(t, "POISONED", second.Outputs["sum"])
}

// @scenario "user code cannot change the dspy stand-in a later execution imports"
func TestCodeBlock_FakeDspyRewriteDoesNotReachTheNextExecution(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	rewrite, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import os, fake_dspy

def execute():
    path = os.path.abspath(fake_dspy.__file__)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    with open(path, "w") as handle:
        handle.write("MARKER = 'poisoned'\n")
    return {"ok": True}
`,
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.Nil(t, rewrite.Error, "the rewrite attempt itself should not error: %+v", rewrite.Error)

	second, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import fake_dspy

def execute():
    return {"marker": getattr(fake_dspy, "MARKER", "shipped")}
`,
		DeclaredOutputs: []string{"marker"},
	})
	require.NoError(t, err)
	require.Nil(t, second.Error, "expected the second execution to run normally, got %+v", second.Error)
	assert.Equal(t, "shipped", second.Outputs["marker"],
		"the second execution imported a stand-in the first one wrote")
}

// @scenario "each execution gets its own temporary directory, removed afterwards"
func TestCodeBlock_EachExecutionGetsItsOwnDirectory(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	// Report the directory the runner was materialized into, and drop a file
	// in it, so the next execution can be asked whether it sees either.
	probe := `
import os, fake_dspy

def execute():
    here = os.path.dirname(os.path.abspath(fake_dspy.__file__))
    seen = os.path.exists(os.path.join(here, "left-behind.txt"))
    with open(os.path.join(here, "left-behind.txt"), "w") as handle:
        handle.write("x")
    return {"dir": here, "saw_previous": seen}
`

	first, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            probe,
		DeclaredOutputs: []string{"dir", "saw_previous"},
	})
	require.NoError(t, err)
	require.Nil(t, first.Error, "%+v", first.Error)

	second, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            probe,
		DeclaredOutputs: []string{"dir", "saw_previous"},
	})
	require.NoError(t, err)
	require.Nil(t, second.Error, "%+v", second.Error)

	firstDir, ok := first.Outputs["dir"].(string)
	require.True(t, ok, "expected the run directory as a string, got %#v", first.Outputs["dir"])
	secondDir, ok := second.Outputs["dir"].(string)
	require.True(t, ok, "expected the run directory as a string, got %#v", second.Outputs["dir"])

	assert.NotEqual(t, firstDir, secondDir, "both executions shared one directory")
	assert.Equal(t, false, second.Outputs["saw_previous"],
		"the second execution saw a file the first one wrote")

	for _, dir := range []string{firstDir, secondDir} {
		_, statErr := os.Stat(dir)
		assert.True(t, os.IsNotExist(statErr),
			"execution directory %s was left behind (stat error: %v)", dir, statErr)
	}
}

// @scenario "each execution gets its own temporary directory, removed afterwards"
func TestCodeBlock_RunDirectoryIsRemovedAfterATimeout(t *testing.T) {
	requirePython(t)
	exe, err := codeblock.New(codeblock.Options{DefaultTimeout: 300 * time.Millisecond})
	require.NoError(t, err)

	before := countRunDirs(t)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            "import time\n\ndef execute():\n    time.sleep(30)\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.True(t, res.TimedOut, "expected the run to time out")

	assert.LessOrEqual(t, countRunDirs(t), before,
		"a timed-out execution left its directory behind")
}

// countRunDirs counts the executor's per-execution directories currently in
// the temp root. Other tests in this package run in the same process, so the
// assertion that uses it compares against its own baseline rather than zero.
func countRunDirs(t *testing.T) int {
	t.Helper()
	entries, err := os.ReadDir(os.TempDir())
	require.NoError(t, err)
	count := 0
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "nlpgo-codeblock-run-") {
			count++
		}
	}
	return count
}

// @scenario "user code cannot change what a later execution runs"
func TestCodeBlock_DevRunnerOverrideIsReadOnceAndNotReread(t *testing.T) {
	requirePython(t)

	// A dev override names a runner on disk. It is read when the executor is
	// built; rewriting the file afterwards must not change what runs, so the
	// override is no weaker a trust anchor than the embedded copy.
	dir := t.TempDir()
	runnerPath := filepath.Join(dir, "runner.py")
	embedded, err := os.ReadFile("runner.py")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(runnerPath, embedded, 0o600)) //nolint:gosec // G703: the path is this test's own t.TempDir()
	fakeDspy, err := os.ReadFile("fake_dspy.py")
	require.NoError(t, err)
	require.NoError(t, os.WriteFile(filepath.Join(dir, "fake_dspy.py"), fakeDspy, 0o600)) //nolint:gosec // G703: the path is this test's own t.TempDir()

	exe, err := codeblock.New(codeblock.Options{RunnerPath: runnerPath})
	require.NoError(t, err)

	require.NoError(t, os.WriteFile(runnerPath, []byte("raise SystemExit(1)\n"), 0o600))

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            "def execute():\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v", res.Error)
	assert.Equal(t, true, res.Outputs["ok"])
}

// @scenario "each execution gets its own temporary directory, removed afterwards"
func TestCodeBlock_RunDirectoryIsRemovedEvenWhenUserCodeLocksASubdirectory(t *testing.T) {
	requirePython(t)
	requireUnprivileged(t)
	exe := newExec(t)

	// Unlinking a file needs write permission on the directory holding it, so
	// user code that leaves a read-only directory behind defeats a plain
	// RemoveAll. The next execution gets a fresh directory either way, so
	// isolation holds; what leaks is disk, which on a long-lived engine
	// accumulates until the volume fills. The shipped image runs on
	// distroless' `nonroot` tag, so this is the posture a real deployment has.
	//
	// Only a NESTED directory is locked. Locking the run directory itself
	// stops the runner writing its own result file, so that execution simply
	// fails, which is both acceptable and a different behavior from this one.
	// Getting that wrong is what made the first version of this test pass as
	// root and fail as an ordinary user.
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import os, fake_dspy

def execute():
    here = os.path.dirname(os.path.abspath(fake_dspy.__file__))
    locked = os.path.join(here, "locked")
    os.mkdir(locked)
    with open(os.path.join(locked, "file.txt"), "w") as handle:
        handle.write("x")
    os.chmod(locked, 0o500)
    return {"dir": here}
`,
		DeclaredOutputs: []string{"dir"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v", res.Error)

	dir, ok := res.Outputs["dir"].(string)
	require.True(t, ok, "expected the run directory as a string, got %#v", res.Outputs["dir"])

	_, statErr := os.Stat(dir)
	assert.True(t, os.IsNotExist(statErr),
		"run directory %s survived because user code left a read-only directory in it (stat error: %v)", dir, statErr)
}

// requireUnprivileged skips a test whose subject is a file permission.
//
// uid 0 bypasses the permission check entirely, so a root test runner removes
// a 0500 directory without ever entering the recovery path such a test exists
// to cover: it would keep passing after that path regressed. Skipping says so
// out loud rather than banking a pass that means nothing. CI runs unprivileged,
// so the coverage is real there.
func requireUnprivileged(t *testing.T) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("running as root: uid 0 ignores the directory permissions this test turns on")
	}
}
