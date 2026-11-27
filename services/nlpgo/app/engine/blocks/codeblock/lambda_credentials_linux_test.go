//go:build linux

package codeblock_test

import (
	"context"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/nlpgo/adapters/httpapi"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// These cases run user code under the conditions AWS Lambda gives the NLP
// runner: seccomp answers EPERM to prctl(PR_SET_DUMPABLE), there are no
// namespaces, every process runs as the same user, and the role's credentials
// are in the environment the runtime and its extensions were started with.

const (
	credentialCanary = "lambda-role-credential-canary-7c1e"
	wantExposureEnv  = "NLPGO_TEST_WANT_EXPOSURE"
	lambdaPythonEnv  = "NLPGO_TEST_LAMBDA_PYTHON"
	routerAddrEnv    = "NLPGO_TEST_ROUTER"
)

// roleSecretEnv stands for the role's credentials in a process other test
// binaries can read: every package's tests run as this user at once, and one
// holding a real AWS_* name would disable their code blocks for its lifetime.
const roleSecretEnv = "NLPGO_TEST_ROLE_SECRET"

// lambdaInjected is what Lambda puts into the environment of every process it
// starts in the sandbox: the runtime (the engine) and each extension (the web
// adapter). The real AWS_* names go only into a process nothing else can read.
func lambdaInjected(readable bool) []string {
	env := []string{
		roleSecretEnv + "=" + credentialCanary,
		"AWS_LAMBDA_FUNCTION_NAME=langwatch_nlp-project",
		"AWS_LAMBDA_RUNTIME_API=127.0.0.1:9001",
	}
	if readable {
		return env
	}
	return append(env,
		"AWS_ACCESS_KEY_ID=ASIA"+credentialCanary,
		"AWS_SECRET_ACCESS_KEY="+credentialCanary,
		"AWS_SESSION_TOKEN="+credentialCanary,
	)
}

// credentialProbe looks everywhere a code block could look for the runner's
// credentials: its own environment, every process's environment and memory,
// and every route on the runner's loopback listener.
const credentialProbe = `import os, urllib.request, urllib.error

CANARY = "` + credentialCanary + `".encode()

def scan_memory(pid):
    try:
        maps = open(f"/proc/{pid}/maps").read().splitlines()
        mem = open(f"/proc/{pid}/mem", "rb")
    except OSError:
        return False
    with mem:
        for line in maps:
            span, perms = line.split()[:2]
            if not perms.startswith("r"):
                continue
            start, end = (int(x, 16) for x in span.split("-"))
            if end - start > 64 << 20:
                continue
            try:
                mem.seek(start)
                if CANARY in mem.read(end - start):
                    return True
            except (OSError, OverflowError, ValueError):
                continue
    return False

def execute(router, harness):
    found = []
    for name, value in os.environ.items():
        if name.startswith("AWS_") or CANARY.decode() in value:
            found.append("own environment: " + name)
    for entry in os.listdir("/proc"):
        if not entry.isdigit() or int(entry) in (os.getpid(), harness):
            continue
        try:
            with open(f"/proc/{entry}/environ", "rb") as f:
                if CANARY in f.read():
                    found.append(f"/proc/{entry}/environ")
        except OSError:
            pass
        if scan_memory(entry):
            found.append(f"/proc/{entry}/mem")
    statuses = {}
    if router:
        for path in ("/env", "/debug/pprof/", "/debug/pprof/cmdline", "/metrics",
                     "/health", "/healthz", "/readyz", "/v1/models", "/go/version"):
            try:
                with urllib.request.urlopen(router + path, timeout=5) as resp:
                    status, body = resp.status, resp.read()
            except urllib.error.HTTPError as e:
                status, body = e.code, e.read()
            statuses[path] = status
            if CANARY in body:
                found.append("http " + path)
    return {"found": found, "statuses": statuses}
`

// requireUnprivilegedForExecOnly skips where an execute-only file proves
// nothing: root reads it anyway, so the kernel never marks the process
// non-dumpable.
func requireUnprivilegedForExecOnly(t *testing.T) {
	t.Helper()
	if os.Geteuid() == 0 {
		t.Skip("root reads an execute-only file, so it cannot stand in for the Lambda user")
	}
}

// execOnlyCopy copies an executable to a file the caller may run and not read,
// which is how the Lambda image ships the engine, the adapter and python.
func execOnlyCopy(t *testing.T, src string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(src)
	require.NoError(t, err)
	in, err := os.Open(resolved) //nolint:gosec // an executable this test resolved itself
	require.NoError(t, err)
	defer func() { _ = in.Close() }()
	dst := filepath.Join(t.TempDir(), filepath.Base(resolved))
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o700) //nolint:gosec // a copy of an executable this test runs
	require.NoError(t, err)
	_, err = io.Copy(out, in)
	require.NoError(t, err)
	require.NoError(t, out.Close())
	require.NoError(t, os.Chmod(dst, 0o111)) //nolint:gosec // execute-only is the point
	return dst
}

// lambdaSandbox is one Lambda execution environment as the tests build it.
type lambdaSandbox struct {
	// execOnly ships the engine and python execute-only, as the image does.
	execOnly bool
	// adapter starts a stand-in for the web adapter extension beside the
	// engine, holding the same credentials: "" none, "readable" or "exec-only".
	adapter string
	// wantExposure is the start of the reason code blocks are refused, or ""
	// when they must run.
	wantExposure string
}

// runInLambdaSandbox starts the adapter stand-in, then re-executes this test
// binary as the engine under the Lambda conditions, and fails with the
// engine's output when its assertions fail.
func runInLambdaSandbox(t *testing.T, name string, box lambdaSandbox) {
	t.Helper()
	requirePython(t)
	engineBinary, python := os.Args[0], mustLookPath(t, "python3")
	if box.execOnly {
		requireUnprivilegedForExecOnly(t)
		engineBinary, python = execOnlyCopy(t, engineBinary), execOnlyCopy(t, python)
	}
	if box.adapter != "" {
		sleep := mustLookPath(t, "sleep")
		if box.adapter == "exec-only" {
			requireUnprivilegedForExecOnly(t)
			sleep = execOnlyCopy(t, sleep)
		}
		adapter := exec.Command(sleep, "120")
		adapter.Env = lambdaInjected(box.adapter == "readable")
		require.NoError(t, adapter.Start())
		t.Cleanup(func() { _ = adapter.Process.Kill(); _, _ = adapter.Process.Wait() })
	}
	env := append(lambdaInjected(!box.execOnly), lambdaPythonEnv+"="+python, wantExposureEnv+"="+box.wantExposure)
	runChildBinary(t, engineBinary, name, env...)
}

func mustLookPath(t *testing.T, name string) string {
	t.Helper()
	path, err := exec.LookPath(name)
	require.NoError(t, err)
	return path
}

// @scenario "on AWS Lambda, user code finds no cloud credential in its own environment"
func TestLambdaCredentials_UserCodeEnvironmentCarriesNone(t *testing.T) {
	runInLambdaSandbox(t, "lambda-probe-env", lambdaSandbox{execOnly: true})
}

// @scenario "on AWS Lambda, user code cannot read the runner's process files"
func TestLambdaCredentials_UserCodeCannotReadTheRunnerProcess(t *testing.T) {
	runInLambdaSandbox(t, "lambda-probe-proc", lambdaSandbox{wantExposure: "the engine's own process files are readable by user code"})
}

// @scenario "on AWS Lambda, user code cannot read another process that holds the credentials"
func TestLambdaCredentials_UserCodeCannotReadTheAdapterProcess(t *testing.T) {
	runInLambdaSandbox(t, "lambda-probe-proc", lambdaSandbox{execOnly: true, adapter: "readable", wantExposure: "process "})
}

// @scenario "on AWS Lambda, the runner's loopback listener serves no credential and no debug route"
func TestLambdaCredentials_LoopbackListenerServesNone(t *testing.T) {
	runInLambdaSandbox(t, "lambda-probe-http", lambdaSandbox{execOnly: true})
}

// @scenario "a platform that refuses the hide step runs code blocks when the image ships the engine and python execute-only"
func TestLambdaCredentials_ExecOnlyImageRunsCodeBlocksHidden(t *testing.T) {
	runInLambdaSandbox(t, "lambda-probe-all", lambdaSandbox{execOnly: true, adapter: "exec-only"})
}

// leftBehind is user code that keeps a process running past its run: its own
// session, a scrubbed environment and a working directory outside the run.
// Where a session is refused it falls back to a double fork, which also loses
// its parent.
const leftBehind = `import os, subprocess, sys, time

def execute(spool):
    try:
        child = subprocess.Popen(
            [sys.executable, "-c", "import time; time.sleep(120)"],
            start_new_session=True, cwd="/", env={"PATH": "/usr/bin:/bin"},
        )
        pid, how = child.pid, "session"
    except PermissionError:
        read, write = os.pipe()
        if os.fork() == 0:
            grandchild = subprocess.Popen(
                [sys.executable, "-c", "import time; time.sleep(120)"],
                cwd="/", env={"PATH": "/usr/bin:/bin"},
            )
            os.write(write, str(grandchild.pid).encode())
            os._exit(0)
        pid, how = int(os.read(read, 32)), "double fork"
        time.sleep(0.2)
    with open(spool, "w") as handle:
        handle.write(str(pid))
    return {"how": how}
`

// @scenario "on AWS Lambda, nothing user code starts outlives its run"
func TestLambdaCredentials_NothingUserCodeStartsOutlivesItsRun(t *testing.T) {
	runInLambdaSandbox(t, "lambda-left-behind", lambdaSandbox{execOnly: true})
}

// @scenario "on AWS Lambda, nothing user code starts outlives its run"
func TestLambdaCredentials_ARunThatCannotBeConfinedDoesNotRun(t *testing.T) {
	runInLambdaSandbox(t, "lambda-cage-refused", lambdaSandbox{execOnly: true})
}

// runCageRefused is a platform that also refuses the seccomp filter: the run
// must fail before any user code, naming why.
func runCageRefused(t *testing.T) {
	t.Helper()
	exe, err := codeblock.New(codeblock.Options{Python: os.Getenv(lambdaPythonEnv)})
	require.NoError(t, err)
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            leftBehind,
		Inputs:          map[string]any{"spool": filepath.Join(t.TempDir(), "pid")},
		DeclaredOutputs: []string{"how"},
		Timeout:         30 * time.Second,
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error, "a run that cannot be confined must not run")
	assert.Contains(t, res.Error.Message, "cannot keep this run in its process group")
}

// runLeftBehind runs leftBehind on the Lambda image and requires the process
// it started to be gone once the run returns.
func runLeftBehind(t *testing.T) {
	t.Helper()
	exe, err := codeblock.New(codeblock.Options{Python: os.Getenv(lambdaPythonEnv)})
	require.NoError(t, err)
	spool := filepath.Join(t.TempDir(), "pid")
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            leftBehind,
		Inputs:          map[string]any{"spool": spool},
		DeclaredOutputs: []string{"how"},
		Timeout:         30 * time.Second,
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v\nstderr: %s", res.Error, res.Stderr)
	assert.Equal(t, "double fork", res.Outputs["how"], "a new session must be refused to user code")
	pid := spooledPid(t, spool)
	assert.Eventually(t, func() bool { return !processRunsNow(pid) }, 5*time.Second, 20*time.Millisecond,
		"pid %d (started by %v) was still running after its run returned", pid, res.Outputs["how"])
}

// probeCategories maps a case to the findings it is about.
var probeCategories = map[string][]string{
	"lambda-probe-env":  {"own environment"},
	"lambda-probe-proc": {"/proc/"},
	"lambda-probe-http": {"http "},
	"lambda-probe-all":  {"own environment", "/proc/", "http "},
}

// runLambdaProbe is the engine side: build the executor the way the Lambda image
// does, run the probe, and require that it either never ran or found nothing.
func runLambdaProbe(t *testing.T, name string) {
	t.Helper()
	router := ""
	if name == "lambda-probe-http" || name == "lambda-probe-all" {
		srv := httptest.NewServer(httpapi.NewRouter(httpapi.RouterDeps{Health: health.New("test"), Version: "test"}))
		defer srv.Close()
		router = srv.URL
	}
	codeblock.AlsoTreatAsAmbientCredential(roleSecretEnv)
	exe, err := codeblock.New(codeblock.Options{Python: os.Getenv(lambdaPythonEnv)})
	require.NoError(t, err)
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code: credentialProbe,
		// The test process that started this engine stands outside the sandbox
		// under test, and what it holds depends on which tests ran first.
		Inputs:          map[string]any{"router": router, "harness": os.Getppid()},
		DeclaredOutputs: []string{"found", "statuses"},
		Timeout:         60 * time.Second,
	})
	require.NoError(t, err)
	require.NotNil(t, res)
	if want := os.Getenv(wantExposureEnv); want != "" {
		require.NotNil(t, res.Error, "code blocks must refuse to run here; they ran and user code found %v", res.Outputs["found"])
		t.Logf("refused: %s", res.Error.Message)
		assert.True(t, strings.HasPrefix(res.Error.Message, "code blocks are disabled: "+want), "refused for the wrong reason: %s", res.Error.Message)
		return
	}
	require.Nil(t, res.Error, "code blocks must run here: %+v\nstderr: %s", res.Error, res.Stderr)
	found, _ := res.Outputs["found"].([]any)
	for _, entry := range found {
		for _, category := range probeCategories[name] {
			assert.NotContains(t, entry, category, "user code obtained a credential the runner holds: %v", found)
		}
	}
	if router != "" {
		statuses, _ := res.Outputs["statuses"].(map[string]any)
		for _, path := range []string{"/env", "/debug/pprof/", "/debug/pprof/cmdline", "/metrics"} {
			assert.EqualValues(t, 502, statuses[path], "%s must not be served", path)
		}
	}
	assert.NotContains(t, res.Stdout+res.Stderr, credentialCanary)
}

func init() {
	lambdaCases["lambda-left-behind"] = runLeftBehind
	lambdaCases["lambda-cage-refused"] = runCageRefused
	extraRefusals["lambda-cage-refused"] = []uint32{22} // PR_SET_SECCOMP
	for name := range probeCategories {
		lambdaCases[name] = func(t *testing.T) {
			t.Helper()
			runLambdaProbe(t, name)
		}
	}
}

// @scenario "on AWS Lambda, user code cannot read another process that holds the credentials"
func TestCarriesAmbientCredential(t *testing.T) {
	block := func(kv ...string) []byte { return []byte(strings.Join(kv, "\x00") + "\x00") }
	cases := []struct {
		name    string
		environ []byte
		want    string
	}{
		{"the role's secret", block("PATH=/bin", "AWS_SECRET_ACCESS_KEY=abc"), "AWS_SECRET_ACCESS_KEY"},
		{"a session token alone", block("AWS_SESSION_TOKEN=abc"), "AWS_SESSION_TOKEN"},
		{"an empty value holds nothing", block("AWS_SECRET_ACCESS_KEY="), ""},
		{"a name that only starts the same", block("AWS_SECRET_ACCESS_KEY_FILE=/x"), ""},
		{"nothing of the kind", block("PATH=/bin", "AWS_REGION=eu-central-1"), ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, found := codeblock.CarriesAmbientCredential(c.environ)
			assert.Equal(t, c.want, got)
			assert.Equal(t, c.want != "", found)
		})
	}
}

// @scenario "a run from an execute-only interpreter leaves nothing behind while an older run is live"
func TestCodeBlock_ExecOnlyInterpreterLeavesNothingBehindBesideALiveRun(t *testing.T) {
	requirePython(t)
	requireUnprivilegedForExecOnly(t)
	// The marks teardown reads are closed on an execute-only interpreter's
	// processes, and the older live run below keeps the age rule from
	// claiming an orphan, so only the process group can hold the run.
	exe, err := codeblock.New(codeblock.Options{Python: execOnlyCopy(t, mustLookPath(t, "python3"))})
	require.NoError(t, err)
	older := make(chan *codeblock.Result, 1)
	go func() {
		res, _ := exe.Execute(context.Background(), codeblock.Request{
			Code:            "import time\n\ndef execute():\n    time.sleep(3)\n    return {'ok': True}\n",
			DeclaredOutputs: []string{"ok"},
		})
		older <- res
	}()
	time.Sleep(300 * time.Millisecond)

	spool := filepath.Join(t.TempDir(), "pid")
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            leftBehind,
		Inputs:          map[string]any{"spool": spool},
		DeclaredOutputs: []string{"how"},
		Timeout:         30 * time.Second,
	})
	require.NoError(t, err)
	require.Nil(t, res.Error, "%+v\nstderr: %s", res.Error, res.Stderr)
	pid := spooledPid(t, spool)
	assert.Eventually(t, func() bool { return !processRunsNow(pid) }, 2*time.Second, 20*time.Millisecond,
		"pid %d (started by %v) was still running after its run returned", pid, res.Outputs["how"])
	select {
	case res := <-older:
		require.NotNil(t, res)
		assert.Nil(t, res.Error, "the older run must finish untouched")
	case <-time.After(10 * time.Second):
		t.Fatal("the older run never finished")
	}
}
