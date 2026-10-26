//go:build linux

package codeblock_test

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// An execution owns every process it starts, and owns them for exactly as long
// as it runs. These tests spawn a background process from user code the way a
// code block would — and the way a code block that means to leave one behind
// would, with its own session, a scrubbed environment and a working directory
// outside the run's — and then assert the pid is gone once Execute returns.
//
// Linux only: the mechanism is PR_SET_CHILD_SUBREAPER plus /proc, so a macOS
// checkout kills the process group and no more. The shipped artifact is the
// Linux container.

// Each of these is user code that starts a process outliving the interpreter.
// The pid goes to a file rather than to an output, so the same code serves the
// paths where the execution returns, raises, or is killed before it can do
// either.
//
// backgroundChild is the ordinary case: a child in a session of its own, which
// is all it takes to leave the run's process group behind.
const backgroundChild = `
import subprocess, sys

def execute(spool):
    child = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        start_new_session=True,
    )
    with open(spool, "w") as handle:
        handle.write(str(child.pid))
    return {"ok": True}
`

// detachedChild goes further: a new session, an environment with no trace of
// the run, and a working directory outside it. Nothing identifies it as the
// execution's but its place in the process tree.
const detachedChild = `
import subprocess, sys

def execute(spool):
    child = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        start_new_session=True,
        cwd="/",
        env={"PATH": "/usr/bin:/bin"},
    )
    with open(spool, "w") as handle:
        handle.write(str(child.pid))
    return {"ok": True}
`

// raisingChild leaves the same process behind and then fails, which is the
// path that used to kill nothing at all: before this, only a timeout swept.
const raisingChild = `
import subprocess, sys

def execute(spool):
    child = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        start_new_session=True,
    )
    with open(spool, "w") as handle:
        handle.write(str(child.pid))
    raise RuntimeError("user code failed after starting a process")
`

// @scenario "no process an execution started is left running"
func TestCodeBlock_NoProcessSurvivesAnExecution(t *testing.T) {
	requirePython(t)

	for _, tc := range []struct {
		name  string
		code  string
		fails bool
	}{
		{name: "child in a session of its own", code: backgroundChild},
		{name: "child detached with a scrubbed environment", code: detachedChild},
		{name: "child left behind by code that then raised", code: raisingChild, fails: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			exe := newExec(t)
			spool := filepath.Join(t.TempDir(), "pid")
			res, err := exe.Execute(context.Background(), codeblock.Request{
				Code:            tc.code,
				Inputs:          map[string]any{"spool": spool},
				DeclaredOutputs: []string{"ok"},
			})
			require.NoError(t, err)
			if tc.fails {
				require.NotNil(t, res.Error, "expected the user code to fail")
			} else {
				require.Nil(t, res.Error, "%+v", res.Error)
			}

			pid := spooledPid(t, spool)
			assert.False(t, processExists(pid),
				"pid %d was still running after the execution returned", pid)
		})
	}
}

// @scenario "no process an execution started is left running"
func TestCodeBlock_NoProcessSurvivesATimeout(t *testing.T) {
	requirePython(t)

	exe, err := codeblock.New(codeblock.Options{DefaultTimeout: 500 * time.Millisecond})
	require.NoError(t, err)

	// The pid reaches us through a file because the execution never gets to
	// return an output: it is killed mid-sleep.
	spool := filepath.Join(t.TempDir(), "pid")
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import subprocess, sys, time

def execute(spool):
    child = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(120)"],
        start_new_session=True,
    )
    with open(spool, "w") as handle:
        handle.write(str(child.pid))
    time.sleep(30)
    return {"ok": True}
`,
		Inputs:          map[string]any{"spool": spool},
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.True(t, res.TimedOut, "expected the run to time out, got %+v", res)

	pid := spooledPid(t, spool)
	assert.False(t, processExists(pid),
		"pid %d survived the timeout that killed the execution", pid)
}

// @scenario "no process an execution started is left running"
func TestCodeBlock_TeardownLeavesConcurrentExecutionsAlone(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	// Teardown reads a child of the engine that no execution is running as a
	// process that escaped one. A run that is still going is such a child, so
	// a short execution tearing down next to a long one must not take it with
	// it.
	var wg sync.WaitGroup
	results := make([]*codeblock.Result, 6)
	failures := make([]error, len(results))
	for i := range results {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			res, err := exe.Execute(context.Background(), codeblock.Request{
				Code: `
import time

def execute(nap):
    time.sleep(nap)
    return {"ok": True}
`,
				Inputs:          map[string]any{"nap": float64(slot) * 0.2},
				DeclaredOutputs: []string{"ok"},
			})
			failures[slot] = err
			results[slot] = res
		}(i)
	}
	wg.Wait()

	for slot, err := range failures {
		require.NoError(t, err, "execution %d could not be run", slot)
	}
	for slot, res := range results {
		require.NotNil(t, res, "execution %d returned nothing", slot)
		require.Nil(t, res.Error, "execution %d was killed by another one's teardown: %+v", slot, res.Error)
		assert.Equal(t, true, res.Outputs["ok"])
	}
}

// @scenario "no process an execution started is left running"
func TestCodeBlock_DetachedChildCannotHoldTheExecutionOpen(t *testing.T) {
	requirePython(t)

	// The child inherits the interpreter's stderr. When that was a pipe exec
	// copied in a goroutine, a child holding it open held Wait open with it,
	// and the execution ran past the timeout the executor exists to enforce.
	exe, err := codeblock.New(codeblock.Options{DefaultTimeout: 10 * time.Second})
	require.NoError(t, err)

	started := time.Now()
	spool := filepath.Join(t.TempDir(), "pid")
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            backgroundChild,
		Inputs:          map[string]any{"spool": spool},
		DeclaredOutputs: []string{"ok"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v", res.Error)
	assert.Less(t, time.Since(started), 5*time.Second,
		"Execute waited on a descriptor the process it started was holding open")
	assert.False(t, processExists(spooledPid(t, spool)))
}

// spooledPid reads the pid the user code wrote out.
func spooledPid(t *testing.T, spool string) int {
	t.Helper()
	raw, err := os.ReadFile(spool)
	require.NoError(t, err, "user code never reported the pid of the process it started")
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	require.NoError(t, err)
	require.Positive(t, pid)
	return pid
}

// processExists reports whether the pid is still in the process table.
//
// It reads /proc rather than signaling pid 0, because a process that was
// killed but never reaped answers a signal as though it were alive: the test
// is about both halves, the kill and the reap, since an unreaped child holds a
// slot in the table for as long as the engine runs.
func processExists(pid int) bool {
	for deadline := time.Now().Add(5 * time.Second); ; {
		if _, err := os.Stat("/proc/" + strconv.Itoa(pid)); os.IsNotExist(err) {
			return false
		}
		if time.Now().After(deadline) {
			return true
		}
		time.Sleep(20 * time.Millisecond)
	}
}
