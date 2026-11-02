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
// execution runs cannot be changed by another one. They run real user code
// that tries to plant code where the next execution would load it, because an
// earlier shape of this executor — one runner file written at startup and
// reused for the process's whole life — passed every assertion about its own
// output while leaving the next execution running whatever the previous one
// had written.
//
// The runner and its dspy stand-in now reach the interpreter in memory, so
// user code is not handed a path to either: `__file__` is absent on the
// stand-in and the working directory is off sys.path. That is what the first
// two tests are about; the rest are about the directory itself.

// @scenario "the runner and the dspy stand-in are never written to disk"
func TestCodeBlock_NoRunnerOrStandInIsOnDisk(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import os, fake_dspy

def execute():
    here = os.getcwd()
    return {
        "stand_in_file": getattr(fake_dspy, "__file__", None),
        "files": sorted(os.listdir(here)),
        "work_dir_on_path": any(
            entry in ("", ".", here) for entry in __import__("sys").path
        ),
    }
`,
		DeclaredOutputs: []string{"stand_in_file", "files", "work_dir_on_path"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v", res.Error)

	assert.Nil(t, res.Outputs["stand_in_file"],
		"the dspy stand-in was loaded from a file, so user code has a path to rewrite")
	assert.Equal(t, false, res.Outputs["work_dir_on_path"],
		"the working directory is on sys.path, so a planted module would be imported")
	for _, name := range res.Outputs["files"].([]any) {
		assert.False(t, strings.HasSuffix(name.(string), ".py"),
			"found Python source in the execution's own directory: %v", name)
	}
}

// @scenario "an import is never answered by the execution's working directory"
func TestCodeBlock_PlantedModuleIsNotImported(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		// Both halves of the old attack in one: plant a module under a name
		// the runner itself imports, and one under a fresh name, then try to
		// import each.
		Code: `
import os

def execute():
    for name in ("fake_dspy", "planted"):
        with open(os.path.join(os.getcwd(), name + ".py"), "w") as handle:
            handle.write("MARKER = 'poisoned'\n")
    try:
        import planted
        planted_marker = planted.MARKER
    except ImportError as exc:
        planted_marker = "not_importable"
    import fake_dspy
    return {
        "planted": planted_marker,
        "stand_in": getattr(fake_dspy, "MARKER", "shipped"),
    }
`,
		DeclaredOutputs: []string{"planted", "stand_in"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v", res.Error)
	assert.Equal(t, "not_importable", res.Outputs["planted"],
		"a module written into the working directory was imported from it")
	assert.Equal(t, "shipped", res.Outputs["stand_in"],
		"the planted file replaced the dspy stand-in the runner had already registered")
}

// @scenario "user code cannot change what a later execution runs"
func TestCodeBlock_PlantedRunnerDoesNotReachTheNextExecution(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	plant, err := exe.Execute(context.Background(), codeblock.Request{
		// The only place this execution can write is its own directory, so
		// that is where it leaves a runner and a stand-in for a later
		// execution to pick up.
		Code: `
import os

def execute():
    here = os.getcwd()
    with open(os.path.join(here, "runner.py"), "w") as handle:
        handle.write("import sys, json\n")
        handle.write("json.dump({'outputs': {'sum': 'POISONED'}}, open(sys.argv[1], 'w'))\n")
    with open(os.path.join(here, "fake_dspy.py"), "w") as handle:
        handle.write("MARKER = 'poisoned'\n")
    return {"ok": True}
`,
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.Nil(t, plant.Error, "the attempt itself should not error: %+v", plant.Error)

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
func TestCodeBlock_PlantedStandInDoesNotReachTheNextExecution(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	plant, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import os

def execute():
    with open(os.path.join(os.getcwd(), "fake_dspy.py"), "w") as handle:
        handle.write("MARKER = 'poisoned'\n")
    return {"ok": True}
`,
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.Nil(t, plant.Error, "the attempt itself should not error: %+v", plant.Error)

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

// @scenario "each execution gets its own working directory, removed afterwards"
func TestCodeBlock_EachExecutionGetsItsOwnDirectory(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	// Report the working directory, and drop a file in it, so the next
	// execution can be asked whether it sees either.
	probe := `
import os

def execute():
    here = os.getcwd()
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

// @scenario "an execution cannot reach another execution's working directory"
func TestCodeBlock_ExecutionCannotReachAnotherExecutionsDirectory(t *testing.T) {
	requirePython(t)
	requireUnprivileged(t)
	exe := newExec(t)

	first, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import os

def execute():
    with open(os.path.join(os.getcwd(), "secret.txt"), "w") as handle:
        handle.write("first-execution-secret")
    return {"dir": os.getcwd()}
`,
		DeclaredOutputs: []string{"dir"},
	})
	require.NoError(t, err)
	require.Nil(t, first.Error, "%+v", first.Error)
	firstDir, ok := first.Outputs["dir"].(string)
	require.True(t, ok, "expected the run directory as a string, got %#v", first.Outputs["dir"])

	// The second execution is handed the first one's path, which is more than
	// it could find on its own: the root holding both cannot be listed, and
	// the names in it are random.
	second, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import os

def execute(other_dir):
    try:
        siblings = sorted(os.listdir(os.path.dirname(os.getcwd())))
        listing = "listed"
    except OSError as exc:
        siblings = []
        listing = type(exc).__name__
    try:
        with open(os.path.join(other_dir, "secret.txt")) as handle:
            read = handle.read()
    except OSError as exc:
        read = type(exc).__name__
    try:
        with open(os.path.join(other_dir, "planted.txt"), "w") as handle:
            handle.write("x")
        wrote = "wrote"
    except OSError as exc:
        wrote = type(exc).__name__
    return {"listing": listing, "siblings": siblings, "read": read, "wrote": wrote}
`,
		Inputs:          map[string]any{"other_dir": firstDir},
		DeclaredOutputs: []string{"listing", "siblings", "read", "wrote"},
	})
	require.NoError(t, err)
	require.Nil(t, second.Error, "%+v", second.Error)

	assert.Equal(t, "PermissionError", second.Outputs["listing"],
		"the root holding the execution directories could be listed, so they can be discovered")
	assert.Empty(t, second.Outputs["siblings"])
	assert.Equal(t, "FileNotFoundError", second.Outputs["read"],
		"the second execution read a file the first one wrote")
	assert.Equal(t, "FileNotFoundError", second.Outputs["wrote"],
		"the second execution wrote into the first one's directory")
}

// @scenario "an execution cannot reach another execution's working directory"
func TestCodeBlock_ConcurrentExecutionsCannotDiscoverEachOther(t *testing.T) {
	requirePython(t)
	requireUnprivileged(t)
	exe := newExec(t)

	// The first execution is still running while the second one looks, so its
	// directory does exist on disk. What the second one cannot do is find it.
	type outcome struct {
		res *codeblock.Result
		err error
	}
	holding := make(chan outcome, 1)
	go func() {
		res, runErr := exe.Execute(context.Background(), codeblock.Request{
			Code: `
import os, time

def execute():
    with open(os.path.join(os.getcwd(), "secret.txt"), "w") as handle:
        handle.write("concurrent-secret")
    time.sleep(1.5)
    return {"ok": True}
`,
			DeclaredOutputs: []string{"ok"},
		})
		holding <- outcome{res: res, err: runErr}
	}()
	time.Sleep(500 * time.Millisecond)

	seeker, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import glob, os

def execute():
    root = os.path.dirname(os.getcwd())
    try:
        entries = sorted(os.listdir(root))
        listing = "listed"
    except OSError as exc:
        entries = []
        listing = type(exc).__name__
    return {
        "listing": listing,
        "entries": entries,
        "globbed": sorted(glob.glob(os.path.join(root, "*", "secret.txt"))),
    }
`,
		DeclaredOutputs: []string{"listing", "entries", "globbed"},
	})
	require.NoError(t, err)
	require.Nil(t, seeker.Error, "%+v", seeker.Error)
	assert.Equal(t, "PermissionError", seeker.Outputs["listing"])
	assert.Empty(t, seeker.Outputs["entries"])
	assert.Empty(t, seeker.Outputs["globbed"],
		"a concurrent execution's directory was discovered by walking the root")

	held := <-holding
	require.NoError(t, held.err)
	require.Nil(t, held.res.Error, "%+v", held.res.Error)
}

// @scenario "each execution gets its own working directory, removed afterwards"
func TestCodeBlock_RunDirectoryIsRemovedAfterATimeout(t *testing.T) {
	requirePython(t)

	exe, err := codeblock.New(codeblock.Options{DefaultTimeout: 300 * time.Millisecond})
	require.NoError(t, err)

	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            "import time\n\ndef execute():\n    time.sleep(30)\n    return {'ok': True}\n",
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.True(t, res.TimedOut, "expected the run to time out")

	assert.Empty(t, runDirsIn(t, exe),
		"a timed-out execution left its directory behind")
}

// runDirsIn returns the execution directories left in the executor's root.
//
// The root has no read permission, which is the point of it, so the test
// restores one for the length of the call: nothing inside is being asserted on
// except that it is empty.
func runDirsIn(t *testing.T, exe *codeblock.Executor) []string {
	t.Helper()
	root := exe.ScratchRoot()
	mode := os.FileMode(0o300)
	if info, err := os.Stat(root); err == nil {
		mode = info.Mode().Perm()
	}
	require.NoError(t, os.Chmod(root, 0o700)) //nolint:gosec // G302: a directory, where the execute bit is what makes it traversable
	defer func() { require.NoError(t, os.Chmod(root, mode)) }()

	entries, err := os.ReadDir(root)
	require.NoError(t, err)
	var dirs []string
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "run-") {
			dirs = append(dirs, entry.Name())
		}
	}
	return dirs
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

// @scenario "each execution gets its own working directory, removed afterwards"
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
import os

def execute():
    here = os.getcwd()
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
// a 0500 directory, and lists a directory with no read permission, without
// ever entering the path such a test exists to cover: it would keep passing
// after that path regressed. Skipping says so out loud rather than banking a
// pass that means nothing. CI runs unprivileged, so the coverage is real there.
func requireUnprivileged(t *testing.T) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("running as root: uid 0 ignores the directory permissions this test turns on")
	}
}
