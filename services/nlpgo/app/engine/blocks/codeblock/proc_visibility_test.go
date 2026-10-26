//go:build linux

package codeblock_test

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
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

// outcome is what an execution running in a goroutine beside the test comes
// back with, so the test can wait for it on a channel.
type outcome struct {
	res *codeblock.Result
	err error
}

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

// @scenario "the interpreter is handed nothing belonging to the run"
func TestCodeBlock_TheInterpreterIsHandedNothingOfTheRun(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	// A descriptor exec hands the interpreter can be cloned out of /proc by
	// another execution in the moment before the runner hides itself, and a
	// clone of a pipe reads what is written to it later. So the payload is not
	// on one: stdin is empty, and the only descriptor the interpreter starts
	// with that leads anywhere is a stderr file with no name, outside the run.
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import os

def execute():
    return {
        "stdin": os.readlink("/proc/self/fd/0"),
        "stderr": os.readlink("/proc/self/fd/2"),
        "cwd": os.getcwd(),
    }
`,
		DeclaredOutputs: []string{"stdin", "stderr", "cwd"},
		Secrets:         map[string]string{"TOKEN": "sk-secret-of-the-project"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v", res.Error)

	assert.Equal(t, "/dev/null", res.Outputs["stdin"],
		"the payload traveled on a descriptor the interpreter was handed at exec")
	stderr, ok := res.Outputs["stderr"].(string)
	require.True(t, ok, "expected a string, got %#v", res.Outputs["stderr"])
	assert.Contains(t, stderr, "(deleted)",
		"the interpreter's stderr file has a name, so another execution can open it")
	workDir, ok := res.Outputs["cwd"].(string)
	require.True(t, ok, "expected a string, got %#v", res.Outputs["cwd"])
	assert.NotContains(t, stderr, workDir,
		"the interpreter's stderr file names the run's directory")
}

// watchForAnInterpreter reports what it could read of every other interpreter
// that started while it was running, which is the one moment a peer execution
// has: before the runner makes itself non-dumpable.
const watchForAnInterpreter = `
import os, time

def execute(seconds):
    mine = os.getpid()
    seen = {}
    deadline = time.time() + seconds
    while time.time() < deadline:
        for name in os.listdir("/proc"):
            if not name.isdigit() or int(name) == mine or name in seen:
                continue
            try:
                with open("/proc/%s/cmdline" % name, "rb") as handle:
                    argv = handle.read().decode("utf-8", "replace")
            except OSError:
                continue
            if "python" not in argv:
                continue
            caught = {}
            for entry in ("cwd", "fd/0", "fd/2"):
                try:
                    caught[entry] = os.readlink("/proc/%s/%s" % (name, entry))
                except OSError as exc:
                    caught[entry] = type(exc).__name__
            try:
                with open("/proc/%s/fd/0" % name, "rb") as handle:
                    caught["stdin"] = handle.read(8192).decode("utf-8", "replace")
            except OSError as exc:
                caught["stdin"] = type(exc).__name__
            seen[name] = caught
    return {"seen": seen}
`

// @scenario "one execution cannot read another's payload, variables or directory through /proc"
func TestCodeBlock_AWatchingExecutionCatchesNothingAtInterpreterStartup(t *testing.T) {
	requirePython(t)
	requireUnprivileged(t)
	exe := newExec(t)

	// The watcher spins on /proc for the whole run of the execution beside it,
	// opening every interpreter it finds as early as it can. Whatever it
	// manages to catch must carry neither the payload nor the other run's
	// directory. It polls as fast as Python allows and may still miss the
	// window, so this proves what a catch yields, not that there is one.
	watching := make(chan outcome, 1)
	go func() {
		res, runErr := exe.Execute(context.Background(), codeblock.Request{
			Code:            watchForAnInterpreter,
			Inputs:          map[string]any{"seconds": 3.0},
			DeclaredOutputs: []string{"seen"},
		})
		watching <- outcome{res: res, err: runErr}
	}()

	spool := filepath.Join(t.TempDir(), "pid")
	watched, err := exe.Execute(context.Background(), codeblock.Request{
		Code: `
import os, time

def execute(spool):
    with open(spool, "w") as handle:
        handle.write(str(os.getpid()))
    time.sleep(1)
    return {"dir": os.getcwd()}
`,
		Inputs:          map[string]any{"spool": spool},
		DeclaredOutputs: []string{"dir"},
		Secrets:         map[string]string{"TOKEN": "sk-secret-of-the-project"},
	})
	require.NoError(t, err)
	require.Nil(t, watched.Error, "%+v", watched.Error)
	watchedDir, ok := watched.Outputs["dir"].(string)
	require.True(t, ok, "expected a string, got %#v", watched.Outputs["dir"])
	watchedPid := spooledPid(t, spool)

	seen := <-watching
	require.NoError(t, seen.err)
	require.Nil(t, seen.res.Error, "%+v", seen.res.Error)
	observations, ok := seen.res.Outputs["seen"].(map[string]any)
	require.True(t, ok, "expected a map, got %#v", seen.res.Outputs["seen"])

	caught, ok := observations[strconv.Itoa(watchedPid)]
	if !ok {
		t.Logf("the watcher never caught pid %d; the window it looks for is interpreter start-up", watchedPid)
		return
	}
	readings, ok := caught.(map[string]any)
	require.True(t, ok, "expected a map, got %#v", caught)
	for entry, reading := range readings {
		text, isText := reading.(string)
		require.True(t, isText, "expected a string for %s, got %#v", entry, reading)
		assert.NotContains(t, text, "sk-secret-of-the-project",
			"a watching execution read the other run's payload out of its %s", entry)
		assert.NotContains(t, text, watchedDir,
			"a watching execution learned the other run's directory from its %s", entry)
	}
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

// askThePayloadChannel asks the channel for a payload twice over: from the
// interpreter, which already collected its own, and from a process the
// executed code starts, which never had one. The name of the socket is in the
// environment and the abstract namespace is shared, so both reach it; the pid
// the kernel reports is what decides the answer.
const askThePayloadChannel = `
import os, socket, subprocess, sys

_ASK = """
import socket, sys

sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.settimeout(10)
try:
    sock.connect("\\0" + sys.argv[1])
except OSError as exc:
    sys.stdout.write("refused:" + type(exc).__name__)
    raise SystemExit(0)
chunks = []
while True:
    chunk = sock.recv(1 << 16)
    if not chunk:
        break
    chunks.append(chunk)
sys.stdout.write(b"".join(chunks).decode("utf-8", "replace"))
"""


def _ask(name):
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(10)
    try:
        sock.connect("\0" + name)
    except OSError as exc:
        return "refused:" + type(exc).__name__
    chunks = []
    while True:
        chunk = sock.recv(1 << 16)
        if not chunk:
            break
        chunks.append(chunk)
    sock.close()
    return b"".join(chunks).decode("utf-8", "replace")


def execute():
    name = os.environ.get("NLPGO_CODE_BLOCK_CHANNEL", "")
    child = subprocess.run([sys.executable, "-c", _ASK, name],
                           capture_output=True, text=True, timeout=30)
    if child.returncode != 0:
        raise RuntimeError("the probe did not finish: rc=%d stderr=%s"
                           % (child.returncode, child.stderr))
    return {
        "channel": name,
        "from_interpreter": _ask(name) if name else "<no channel>",
        "from_child": child.stdout,
    }
`

// @scenario "the payload channel answers only the interpreter it started, once"
func TestCodeBlock_ThePayloadChannelAnswersNobodyElse(t *testing.T) {
	requirePython(t)
	exe := newExec(t)

	// The pid check is the whole authorization: no token and no secret, because
	// anything the engine could hand the interpreter beforehand would be
	// readable in the very window the channel exists to close. So it is worth a
	// test of its own that a second ask and an ask from a different process
	// both come back with nothing.
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            askThePayloadChannel,
		DeclaredOutputs: []string{"channel", "from_interpreter", "from_child"},
		Secrets:         map[string]string{"TOKEN": "sk-secret-of-the-project"},
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v", res.Error)

	channel, ok := res.Outputs["channel"].(string)
	require.True(t, ok, "expected a string, got %#v", res.Outputs["channel"])
	require.NotEmpty(t, channel, "the payload did not travel over the channel, so this proves nothing")

	for _, asker := range []string{"from_interpreter", "from_child"} {
		answer, isText := res.Outputs[asker].(string)
		require.True(t, isText, "expected a string for %s, got %#v", asker, res.Outputs[asker])
		assert.NotContains(t, answer, "sk-secret-of-the-project",
			"%s was handed a payload by the channel", asker)
		assert.True(t, answer == "" || strings.HasPrefix(answer, "refused:"),
			"%s was answered with %q instead of nothing", asker, answer)
	}
}

func TestCodeBlock_ABootThatFailsAfterwardsLeavesNoChannelBehind(t *testing.T) {
	requireUnprivileged(t)

	// The channel is bound before the scratch root is created, so a boot that
	// fails on an unwritable TMPDIR has one open. Nothing would ever answer on
	// it, and nothing would close it either, so New gives it up on the way out.
	locked := t.TempDir()
	require.NoError(t, os.Chmod(locked, 0o400))
	t.Setenv("TMPDIR", locked)

	before := boundChannels(t)
	_, err := codeblock.New(codeblock.Options{})
	require.Error(t, err, "an unwritable TMPDIR has to fail the boot")
	assert.Equal(t, before, boundChannels(t),
		"the boot left a payload channel bound that nothing can answer on")
}

// boundChannels counts the payload channel sockets this process holds. They
// are in the abstract namespace, where the kernel lists them by name with a
// leading @.
func boundChannels(t *testing.T) int {
	t.Helper()
	listed, err := os.ReadFile("/proc/net/unix")
	require.NoError(t, err)
	return strings.Count(string(listed), "@nlpgo-codeblock-")
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
