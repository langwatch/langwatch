//go:build linux

package codeblock_test

import (
	"context"
	"fmt"
	"io"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
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

// credentialProbe looks where a code block could look for the runner's
// credentials: its own environment, every process's environment, and the
// routes on the runner's loopback listener. Process memory is the runner's to
// refuse, so the probe reports what opening the control process's memory gave.
const credentialProbe = `import os, urllib.request, urllib.error

CANARY = "` + credentialCanary + `".encode()

def execute(router, harness, control):
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
    control_memory = ""
    if control:
        try:
            open(f"/proc/{control}/mem", "rb").close()
            control_memory = "opened"
        except OSError as e:
            control_memory = str(e)
    statuses = {}
    if router:
        for path in ("/env", "/debug/pprof/", "/debug/pprof/cmdline", "/metrics",
                     "/healthz", "/readyz", "/startupz", "/go/version"):
            try:
                with urllib.request.urlopen(router + path, timeout=5) as resp:
                    status, body = resp.status, resp.read()
            except urllib.error.HTTPError as e:
                status, body = e.code, e.read()
            statuses[path] = status
            if CANARY in body:
                found.append("http " + path)
    return {"found": found, "statuses": statuses, "control_memory": control_memory}
`

// controlSecretEnv carries the canary in the control process under a name the
// exposure check does not look for, so code blocks still run beside it and the
// probe must find it: proof the probe can see a readable process.
const (
	controlSecretEnv = "NLPGO_TEST_CONTROL_SECRET"
	controlPidEnv    = "NLPGO_TEST_CONTROL_PID"
)

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
	// control starts a readable process holding the canary under controlSecretEnv.
	control bool
	// wantExposure is the start of the reason code blocks are refused, or ""
	// when they must run. wantAdapterNamed refuses naming the adapter instead.
	wantExposure     string
	wantAdapterNamed bool
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
	want := box.wantExposure
	if box.adapter != "" {
		sleep := mustLookPath(t, "sleep")
		if box.adapter == "exec-only" {
			requireUnprivilegedForExecOnly(t)
			sleep = execOnlyCopy(t, sleep)
		}
		pid := startSleeper(t, sleep, lambdaInjected(box.adapter == "readable"))
		if box.wantAdapterNamed {
			want = fmt.Sprintf("process %d holds %s and its environment is readable by user code; ship its binary execute-only", pid, roleSecretEnv)
		}
	}
	env := append(lambdaInjected(!box.execOnly), lambdaPythonEnv+"="+python, wantExposureEnv+"="+want)
	if box.control {
		pid := startSleeper(t, mustLookPath(t, "sleep"), []string{controlSecretEnv + "=" + credentialCanary})
		env = append(env, controlPidEnv+"="+strconv.Itoa(pid))
	}
	runChildBinary(t, engineBinary, name, env...)
}

// startSleeper starts sleep from the given binary with only env, for the life
// of the test, and returns its pid.
func startSleeper(t *testing.T, sleep string, env []string) int {
	t.Helper()
	cmd := exec.Command(sleep, "120")
	cmd.Env = env
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() })
	return cmd.Process.Pid
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
	runInLambdaSandbox(t, "lambda-probe-proc", lambdaSandbox{execOnly: true, adapter: "readable", wantAdapterNamed: true})
}

// @scenario "on AWS Lambda, the runner's loopback listener serves no credential and no debug route"
func TestLambdaCredentials_LoopbackListenerServesNone(t *testing.T) {
	runInLambdaSandbox(t, "lambda-probe-http", lambdaSandbox{execOnly: true})
}

// @scenario "a platform that refuses the hide step runs code blocks when the image ships the engine and python execute-only"
func TestLambdaCredentials_ExecOnlyImageRunsCodeBlocksHidden(t *testing.T) {
	runInLambdaSandbox(t, "lambda-probe-all", lambdaSandbox{execOnly: true, adapter: "exec-only", control: true})
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

// leftBehindByFork is leftBehind for a run that may start no other program,
// as on AWS Lambda: the process it leaves is a fork of the interpreter.
const leftBehindByFork = `import os, time

def execute(spool):
    read, write = os.pipe()
    if os.fork() == 0:
        try:
            os.setsid()
            how = "session"
        except PermissionError:
            how = "double fork"
        if os.fork() == 0:
            os.chdir("/")
            os.write(write, f"{how}:{os.getpid()}".encode())
            time.sleep(120)
            os._exit(0)
        os._exit(1)  # the intermediate child: its exit code is never read
    how, pid = os.read(read, 64).decode().split(":")
    time.sleep(0.2)
    with open(spool, "w") as handle:
        handle.write(pid)
    return {"how": how}
`

// @scenario "on AWS Lambda, nothing user code starts outlives its run"
func TestLambdaCredentials_NothingUserCodeStartsOutlivesItsRun(t *testing.T) {
	runInLambdaSandbox(t, "lambda-left-behind", lambdaSandbox{execOnly: true})
}

// @scenario "on AWS Lambda, a run the platform will not confine still leaves nothing behind"
func TestLambdaCredentials_ARunThatCannotBeConfinedLeavesNothingBehind(t *testing.T) {
	runInLambdaSandbox(t, "lambda-cage-refused", lambdaSandbox{execOnly: true})
}

// @scenario "on AWS Lambda, a run the platform will not confine still leaves nothing behind"
func TestLambdaCredentials_ARunThatCannotBeConfinedLeavesNothingBehindOnTimeout(t *testing.T) {
	runInLambdaSandbox(t, "lambda-cage-refused-timeout", lambdaSandbox{execOnly: true})
}

// @scenario "on AWS Lambda, a run the platform will not confine still leaves nothing behind"
func TestLambdaCredentials_ARunThatCannotBeConfinedReadsNoCredential(t *testing.T) {
	runInLambdaSandbox(t, "lambda-probe-all-unconfined", lambdaSandbox{execOnly: true, adapter: "exec-only", control: true})
}

// runCageRefused is a platform that also refuses PR_SET_NO_NEW_PRIVS and the
// seccomp filter, as AWS Lambda does: user code runs, its new session is
// allowed, and the process in it is gone once the run returns or times out.
func runCageRefused(t *testing.T, timesOut bool) {
	t.Helper()
	exe, err := codeblock.New(codeblock.Options{Python: os.Getenv(lambdaPythonEnv)})
	require.NoError(t, err)
	spool := filepath.Join(t.TempDir(), "pid")
	code, timeout := leftBehindByFork, 30*time.Second
	if timesOut {
		code, timeout = leftBehindThenHang, 3*time.Second
	}
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            code,
		Inputs:          map[string]any{"spool": spool},
		DeclaredOutputs: []string{"how"},
		Timeout:         timeout,
	})
	require.NoError(t, err)
	if timesOut {
		require.True(t, res.TimedOut, "the run must time out: %+v", res)
	} else {
		require.Nil(t, res.Error, "a run the platform will not confine must still run: %+v\nstderr: %s", res.Error, res.Stderr)
		assert.Equal(t, "session", res.Outputs["how"], "with no filter to refuse it, user code gets its new session")
	}
	pid := spooledPid(t, spool)
	assert.Eventually(t, func() bool { return !processRunsNow(pid) }, 5*time.Second, 20*time.Millisecond,
		"pid %d, in a session of its own, was still running after its run returned", pid)
}

// leftBehindThenHang is leftBehindByFork that then runs past its timeout.
const leftBehindThenHang = leftBehindByFork + `
_left_behind = execute

def execute(spool):
    _left_behind(spool)
    import time
    time.sleep(120)
`

// runLeftBehind runs leftBehind on the Lambda image and requires the process
// it started to be gone once the run returns.
func runLeftBehind(t *testing.T) {
	t.Helper()
	exe, err := codeblock.New(codeblock.Options{Python: os.Getenv(lambdaPythonEnv)})
	require.NoError(t, err)
	spool := filepath.Join(t.TempDir(), "pid")
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            leftBehindByFork,
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
	// lambda-probe-all on a platform that also refuses the run's filter.
	"lambda-probe-all-unconfined": {"own environment", "/proc/", "http "},
}

// runLambdaProbe is the engine side: build the executor the way the Lambda image
// does, run the probe, and require that it either never ran or found nothing.
func runLambdaProbe(t *testing.T, name string) {
	t.Helper()
	router := ""
	if name == "lambda-probe-http" || strings.HasPrefix(name, "lambda-probe-all") {
		srv := httptest.NewServer(httpapi.NewRouter(httpapi.RouterDeps{Health: health.New("test"), Version: "test"}))
		defer srv.Close()
		router = srv.URL
	}
	control, _ := strconv.Atoi(os.Getenv(controlPidEnv))
	exe, err := codeblock.New(codeblock.Options{Python: os.Getenv(lambdaPythonEnv)})
	require.NoError(t, err)
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code: credentialProbe,
		// The test process that started this engine stands outside the sandbox
		// under test, and what it holds depends on which tests ran first.
		Inputs:          map[string]any{"router": router, "harness": os.Getppid(), "control": control},
		DeclaredOutputs: []string{"found", "statuses", "control_memory"},
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
	if control != 0 {
		found = assertProbeSeesTheControl(t, found, control, res.Outputs["control_memory"])
	}
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
		for _, path := range []string{"/healthz", "/readyz", "/startupz", "/go/version"} {
			status, probed := statuses[path]
			assert.True(t, probed && fmt.Sprint(status) != "502", "%s is mounted and must be probed at its handler, got %v", path, status)
		}
	}
	assert.NotContains(t, res.Stdout+res.Stderr, credentialCanary)
}

// assertProbeSeesTheControl requires the probe to have found the control
// process's environment and to have been refused its memory by the runner, and
// returns the other findings.
func assertProbeSeesTheControl(t *testing.T, found []any, control int, memory any) []any {
	t.Helper()
	entry := fmt.Sprintf("/proc/%d/environ", control)
	assert.Contains(t, found, entry, "the probe must find the canary a readable process holds under a name the check ignores")
	assert.Contains(t, memory, "code blocks cannot open process memory", "the runner must refuse the control process's memory")
	return slices.DeleteFunc(slices.Clone(found), func(f any) bool { return f == entry })
}

func init() {
	lambdaCases["lambda-left-behind"] = runLeftBehind
	for name, timesOut := range map[string]bool{"lambda-cage-refused": false, "lambda-cage-refused-timeout": true} {
		lambdaCases[name] = func(t *testing.T) { t.Helper(); runCageRefused(t, timesOut) }
		extraRefusals[name] = []uint32{38, 22} // PR_SET_NO_NEW_PRIVS, PR_SET_SECCOMP
	}
	extraRefusals["lambda-probe-all-unconfined"] = []uint32{38, 22}
	lambdaCases["lambda-runtime-api"] = runRuntimeAPIFence
	lambdaCases["lambda-runtime-api-unconfined"] = runRuntimeAPIFence
	extraRefusals["lambda-runtime-api-unconfined"] = []uint32{38, 22}
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
