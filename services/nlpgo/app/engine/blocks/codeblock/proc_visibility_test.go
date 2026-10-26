//go:build linux

package codeblock_test

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// Everything in the container runs as one user, and /proc hands a process
// running as that user another's initial variables, its open descriptors and
// its working directory. For two code blocks running side by side that is the
// payload — the project's decrypted secrets and the run's credential — plus the
// path of the other run's scratch directory.
//
// The runner closes it by making itself non-dumpable before it asks for the
// payload, and nlpgo writes the payload only once that has happened. These
// tests are the proof, and they need an unprivileged user: uid 0 reads those
// files whatever the flag says.

// probePeer reports what this execution can read of another process. Written
// as a parameterized probe so the same code answers for a peer execution and
// for itself, which is what tells a refusal apart from a missing process.
const probePeer = `
import os

def execute(pid):
    seen = {}
    for name in ("environ", "cwd", "fd/0", "stat"):
        path = "/proc/%s/%s" % (pid, name)
        try:
            if name == "cwd":
                os.readlink(path)
            else:
                with open(path, "rb") as handle:
                    handle.read(64)
            seen[name] = "readable"
        except OSError as exc:
            seen[name] = type(exc).__name__
    return {"seen": seen}
`

// @scenario "one execution cannot read another's payload, variables or directory through /proc"
func TestCodeBlock_ExecutionCannotReadAnotherExecutionsProcEntries(t *testing.T) {
	requirePython(t)
	requireUnprivileged(t)
	exe := newExec(t)

	// The first execution reports its own pid and stays alive while the second
	// one goes looking, so what the second one meets is a refusal and not an
	// exited process.
	type outcome struct {
		res *codeblock.Result
		err error
	}
	holding := make(chan outcome, 1)
	spool := filepath.Join(t.TempDir(), "pid")
	go func() {
		res, runErr := exe.Execute(context.Background(), codeblock.Request{
			Code: `
import os, time

def execute(spool):
    with open(spool, "w") as handle:
        handle.write(str(os.getpid()))
    time.sleep(2)
    return {"ok": True}
`,
			Inputs:          map[string]any{"spool": spool},
			DeclaredOutputs: []string{"ok"},
		})
		holding <- outcome{res: res, err: runErr}
	}()
	peerPid := waitForSpooledPid(t, spool)

	seeker, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            probePeer,
		Inputs:          map[string]any{"pid": peerPid},
		DeclaredOutputs: []string{"seen"},
	})
	require.NoError(t, err)
	require.Nil(t, seeker.Error, "%+v", seeker.Error)

	seen, ok := seeker.Outputs["seen"].(map[string]any)
	require.True(t, ok, "expected a map, got %#v", seeker.Outputs["seen"])
	assert.Equal(t, "PermissionError", seen["environ"],
		"one execution read another's initial variables, which carry nothing now but once carried its credential")
	assert.Equal(t, "PermissionError", seen["fd/0"],
		"one execution opened another's stdin, which carries the project's secrets")
	assert.Equal(t, "PermissionError", seen["cwd"],
		"one execution learned another's working directory")
	assert.Equal(t, "readable", seen["stat"],
		"stat has to stay readable: it is what the engine's teardown reads")

	// The same files of its own are refused too: they become root-owned, which
	// is what makes the refusal above hold without a capability anywhere.
	own, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            probePeer,
		Inputs:          map[string]any{"pid": "self"},
		DeclaredOutputs: []string{"seen"},
	})
	require.NoError(t, err)
	require.Nil(t, own.Error, "%+v", own.Error)
	ownSeen, ok := own.Outputs["seen"].(map[string]any)
	require.True(t, ok, "expected a map, got %#v", own.Outputs["seen"])
	assert.Equal(t, "PermissionError", ownSeen["environ"])
	assert.Equal(t, "readable", ownSeen["stat"])

	held := <-holding
	require.NoError(t, held.err)
	require.Nil(t, held.res.Error, "%+v", held.res.Error)
}

// @scenario "the run's credential is never in the interpreter's initial variables"
func TestCodeBlock_SandboxCredentialIsNotInTheInitialVariables(t *testing.T) {
	requirePython(t)

	e, err := codeblock.New(codeblock.Options{
		SandboxEndpoint: "https://app.langwatch.test",
	})
	require.NoError(t, err)

	// A variable exec is handed stays in the process's initial set, which is
	// readable from /proc for as long as the process lives — including in the
	// moment before the runner has hidden it, whatever it does after. One the
	// runner sets is never there at all, and user code reads it the same way.
	//
	// The probe makes itself dumpable again to read its own initial set, which
	// is the only way to look at it now, and says something in passing: a
	// process can undo this for itself, exposing itself and nothing else.
	res, err := e.Execute(context.Background(), codeblock.Request{
		Code: `
import ctypes, os

def execute():
    ctypes.CDLL(None).prctl(4, 1, 0, 0, 0)  # PR_SET_DUMPABLE back on, for us only
    with open("/proc/self/environ", "rb") as handle:
        initial = handle.read().decode("utf-8", "replace")
    return {
        "from_os_environ": os.environ.get("LANGWATCH_API_KEY", "<absent>"),
        "key_in_initial": "sk-lw-run-scoped" in initial,
        "run_dir_in_initial": "TMPDIR=" in initial,
        "command_line": open("/proc/self/cmdline", "rb").read().decode("utf-8", "replace"),
    }
`,
		DeclaredOutputs: []string{"from_os_environ", "key_in_initial", "run_dir_in_initial", "command_line"},
		SandboxAPIKey:   "sk-lw-run-scoped",
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v", res.Error)

	assert.Equal(t, "sk-lw-run-scoped", res.Outputs["from_os_environ"],
		"user code must still read the run's credential the way the SDK does")
	assert.Equal(t, false, res.Outputs["key_in_initial"],
		"the run's credential is in the initial variables, where another execution could read it")
	assert.Equal(t, false, res.Outputs["run_dir_in_initial"],
		"the run's directory is in the initial variables")

	commandLine, ok := res.Outputs["command_line"].(string)
	require.True(t, ok, "expected the command line as a string, got %#v", res.Outputs["command_line"])
	assert.NotContains(t, commandLine, "nlpgo-codeblock-",
		"the command line names the run's directory, and it stays readable to every execution")
}

// @scenario "a result file this execution did not write is not read as its output"
func TestCodeBlock_ForgedResultFileIsNotAcceptedAsOutput(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	// A process that did learn the directory can write result.json. It cannot
	// write the nonce, which came in on the payload, so the forged file is not
	// read as this execution's output — the execution reports a runner error
	// instead of another tenant's values.
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import json, os

def execute():
    with open(os.path.join(os.getcwd(), "result.json"), "w") as handle:
        json.dump({"outputs": {"sum": "FORGED"}, "stdout": "", "stderr": "",
                   "duration_ms": 0, "error": None, "nonce": "guessed"}, handle)
    os._exit(0)
`,
		DeclaredOutputs: []string{"sum"},
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error, "a forged result was accepted: %#v", res.Outputs)
	assert.Equal(t, codeblock.RunnerErrorType, res.Error.Type)
	assert.NotEqual(t, "FORGED", res.Outputs["sum"])
}

// waitForSpooledPid reads the pid out of the spool file once the execution
// that is running beside this one has written it.
func waitForSpooledPid(t *testing.T, spool string) int {
	t.Helper()
	for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
		if raw, err := os.ReadFile(spool); err == nil && len(raw) > 0 {
			return spooledPid(t, spool)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("the execution never reported its pid in %s", spool)
	return 0
}
