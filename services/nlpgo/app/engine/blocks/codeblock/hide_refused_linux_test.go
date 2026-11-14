//go:build linux

package codeblock_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
	"unsafe"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/httpblock"
	"github.com/langwatch/langwatch/services/nlpgo/app/engine/dsl"
)

// Lambda's seccomp answers EPERM to prctl(PR_SET_DUMPABLE). A filter cannot be
// removed, so each case runs in a re-executed copy of this test binary that
// installs one; the parent reports the child's verdict.

const (
	caseEnv      = "NLPGO_TEST_HIDE_CASE"
	hideModeEnv  = "NLPGO_CODE_BLOCK_HIDE"
	skipExitCode = 77
	childTimeout = 90 * time.Second
	trivialBlock = "def execute():\n    return {'answer': 42}\n"
)

// seccompNumbers returns the syscall numbers of seccomp(2) and prctl(2) and the
// audit architecture for this build; the standard library does not export
// seccomp's.
func seccompNumbers() (seccompNr, prctlNr, auditArch uint32, ok bool) {
	switch runtime.GOARCH {
	case "amd64":
		return 317, 157, 0xC000003E, true
	case "arm64":
		return 277, 167, 0xC00000B7, true
	}
	return 0, 0, 0, false
}

// refusePrSetDumpable makes every thread of this process answer the given errno
// to prctl(PR_SET_DUMPABLE) and nothing else: the one Lambda refusal the engine
// depends on (Lambda also refuses PR_SET_CHILD_SUBREAPER and PR_SET_PDEATHSIG,
// which the engine tolerates or does not use).
func refusePrSetDumpable(refusal syscall.Errno) error {
	seccompNr, prctlNr, arch, ok := seccompNumbers()
	if !ok {
		return fmt.Errorf("unsupported architecture %s", runtime.GOARCH)
	}
	const (
		ldAbs = 0x20 // BPF_LD | BPF_W | BPF_ABS
		jeq   = 0x15 // BPF_JMP | BPF_JEQ | BPF_K
		ret   = 0x06 // BPF_RET | BPF_K
		allow = 0x7fff0000
	)
	errnoRet := uint32(0x00050000) | uint32(refusal) // SECCOMP_RET_ERRNO | errno
	prog := []syscall.SockFilter{
		{Code: ldAbs, K: 4},                   // 0 arch
		{Code: jeq, Jt: 0, Jf: 4, K: arch},    // 1 other arch -> 6 allow
		{Code: ldAbs, K: 0},                   // 2 syscall number
		{Code: jeq, Jt: 0, Jf: 2, K: prctlNr}, // 3 not prctl -> 6 allow
		{Code: ldAbs, K: 16},                  // 4 args[0], the prctl option
		{Code: jeq, Jt: 1, Jf: 0, K: 4},       // 5 PR_SET_DUMPABLE -> 7 refuse
		{Code: ret, K: allow},                 // 6
		{Code: ret, K: errnoRet},              // 7
	}
	fprog := syscall.SockFprog{Len: uint16(len(prog)), Filter: &prog[0]}

	// no_new_privs is per thread: pin this goroutine so seccomp(2) runs on the
	// thread that set it. The child process exits after its case, so the thread
	// is never unlocked.
	runtime.LockOSThread()

	const prSetNoNewPrivs = 38
	if _, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, prSetNoNewPrivs, 1, 0, 0, 0, 0); errno != 0 {
		return fmt.Errorf("PR_SET_NO_NEW_PRIVS: %w", errno)
	}
	const setModeFilter, tsync = 1, 1
	if _, _, errno := syscall.Syscall(uintptr(seccompNr), setModeFilter, tsync, uintptr(unsafe.Pointer(&fprog))); errno != 0 {
		return fmt.Errorf("seccomp(SET_MODE_FILTER): %w", errno)
	}
	return nil
}

// childEnvFor builds one case's environment without leaking the settings of the
// machine running the tests.
func childEnvFor(name string, extra ...string) []string {
	env := []string{}
	for _, kv := range os.Environ() {
		switch strings.SplitN(kv, "=", 2)[0] {
		case caseEnv, hideModeEnv:
			continue
		}
		if strings.HasPrefix(kv, "NLPGO_") || strings.HasPrefix(kv, "AWS_LAMBDA_") {
			continue
		}
		env = append(env, kv)
	}
	env = append(env, caseEnv+"="+name)
	return append(env, extra...)
}

// runChild re-executes this test binary on the child entry point and fails the
// parent with the child's output when the child's assertions fail.
func runChild(t *testing.T, name string, extra ...string) {
	t.Helper()
	requirePython(t)
	ctx, cancel := context.WithTimeout(context.Background(), childTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestHideRefusedChild$", "-test.v", "-test.timeout=80s") //nolint:gosec // re-executes this test binary, no external input
	cmd.Env = childEnvFor(name, extra...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == skipExitCode {
		// CI logs are not verbose: a skip there would pass unseen.
		if os.Getenv("CI") != "" {
			t.Fatalf("child exited %d (cannot run this case here); CI must run it: %s", skipExitCode, out.String())
		}
		t.Skipf("cannot run this case on this host: %s", out.String())
	}
	require.NoError(t, err, "child case %s failed:\n%s", name, out.String())
}

// @scenario "a platform that lets the engine hide its process files runs code blocks in strict mode"
// @scenario "the engine reports its hide mode once at start-up"
func TestHideRefused_StrictWhenPlatformAllowsIt(t *testing.T) {
	runChild(t, "not-refused")
}

// @scenario "a platform that refuses the hide step runs code blocks when visible-process is allowed"
// @scenario "the engine reports its hide mode once at start-up"
func TestHideRefused_VisibleProcessWhenAllowed(t *testing.T) {
	runChild(t, "refused-allowed")
}

// @scenario "a platform that refuses the hide step serves no code blocks unless visible-process is allowed"
// @scenario "the engine reports its hide mode once at start-up"
func TestHideRefused_DisabledWhenNotAllowed(t *testing.T) {
	runChild(t, "refused-unset")
}

// @scenario "a platform that refuses the hide step with anything but EPERM serves no code blocks"
// @scenario "the engine reports its hide mode once at start-up"
func TestHideRefused_DisabledOnAnyOtherRefusal(t *testing.T) {
	runChild(t, "refused-eacces-allowed")
}

// @scenario "a platform that lets the engine hide its process files runs code blocks in strict mode"
func TestHideRefused_RunnerFailsWhenStrict(t *testing.T) {
	t.Run("given prctl is refused and NLPGO_CODE_BLOCK_HIDE is unset", func(t *testing.T) {
		t.Run("the runner exits 1 with the prctl message", func(t *testing.T) {
			runChild(t, "runner-strict")
		})
	})
}

// @scenario "a platform that refuses the hide step with anything but EPERM serves no code blocks"
func TestHideRefused_RunnerFailsOnOtherErrnoEvenWhenBestEffort(t *testing.T) {
	runChild(t, "runner-best-effort-other-errno")
}

// @scenario "a platform that refuses the hide step runs code blocks when visible-process is allowed"
func TestHideRefused_RunnerContinuesWhenBestEffort(t *testing.T) {
	runChild(t, "runner-best-effort")
}

// TestHideRefusedChild is the child entry point. It does nothing unless the
// parent set the case marker.
func TestHideRefusedChild(t *testing.T) {
	name := os.Getenv(caseEnv)
	if name == "" {
		t.Skip("entry point for the re-executed child; run through TestHideRefused_*")
	}
	if name == "not-refused" {
		exitSkippedIfHostRefusesHide()
	} else {
		if err := refusePrSetDumpable(refusalFor(name)); err != nil {
			fmt.Fprintf(os.Stderr, "seccomp install failed: %v\n", err)
			os.Exit(skipExitCode)
		}
	}
	if c := runnerCases[name]; c != nil {
		runRunnerCase(t, *c)
	} else {
		runExecutorCase(t, name)
	}
}

// runnerCase is one run of runner.py alone under a filter answering errno.
type runnerCase struct {
	bestEffort  bool
	wantFailure bool
}

var runnerCases = map[string]*runnerCase{
	"runner-strict":                  {bestEffort: false, wantFailure: true},
	"runner-best-effort":             {bestEffort: true, wantFailure: false},
	"runner-best-effort-other-errno": {bestEffort: true, wantFailure: true},
}

// refusals names the errno each case's filter answers; a case not listed is a
// typo, so refusalFor fails on it.
var refusals = map[string]syscall.Errno{
	"refused-allowed":                syscall.EPERM,
	"refused-unset":                  syscall.EPERM,
	"refused-eacces-allowed":         syscall.EACCES,
	"runner-strict":                  syscall.EPERM,
	"runner-best-effort":             syscall.EPERM,
	"runner-best-effort-other-errno": syscall.EACCES,
}

func refusalFor(name string) syscall.Errno {
	errno, ok := refusals[name]
	if !ok {
		fmt.Fprintf(os.Stderr, "unknown hide case %q\n", name)
		os.Exit(2)
	}
	return errno
}

// exitSkippedIfHostRefusesHide ends the child with the skip code when this host
// already refuses PR_SET_DUMPABLE, where strict mode cannot be expected.
func exitSkippedIfHostRefusesHide() {
	const prSetDumpable = 4
	if _, _, errno := syscall.Syscall6(syscall.SYS_PRCTL, prSetDumpable, 1, 0, 0, 0, 0); errno != 0 {
		fmt.Fprintf(os.Stderr, "this host already refuses PR_SET_DUMPABLE (%v), so strict mode cannot be asserted\n", errno)
		os.Exit(skipExitCode)
	}
}

func runExecutorCase(t *testing.T, name string) {
	t.Helper()
	core, logs := observer.New(zapcore.DebugLevel)
	opts := codeblock.Options{
		AllowVisibleProcess: name == "refused-allowed" || name == "refused-eacces-allowed",
		Logger:              zap.New(core),
	}
	exe, err := codeblock.New(opts)
	require.NoError(t, err, "codeblock.New must never abort the engine over PR_SET_DUMPABLE")

	assertHideModeLogged(t, logs, name)

	res, runErr := exe.Execute(context.Background(), codeblock.Request{
		Code:            trivialBlock,
		DeclaredOutputs: []string{"answer"},
		Timeout:         30 * time.Second,
	})

	switch name {
	case "refused-eacces-allowed":
		require.NoError(t, runErr)
		require.NotNil(t, res)
		require.NotNil(t, res.Error)
		assert.Contains(t, res.Error.Message, "code blocks are disabled")
		assert.Contains(t, res.Error.Message, syscall.EACCES.Error())
		assert.NotContains(t, res.Error.Message, codeblock.AllowVisibleProcessSetting)
	case "refused-unset":
		require.NoError(t, runErr)
		require.NotNil(t, res)
		require.NotNil(t, res.Error)
		assert.Contains(t, res.Error.Message, codeblock.AllowVisibleProcessSetting)
		assertOtherBlocksRunThroughEngine(t, exe)
	default:
		require.NoError(t, runErr)
		require.NotNil(t, res)
		require.Nil(t, res.Error, "expected success, got %+v", res.Error)
		assert.EqualValues(t, 42, res.Outputs["answer"])
	}
	if name == "refused-allowed" {
		assertRunnerDropsHideFlag(t, exe)
	}
}

// assertRunnerDropsHideFlag runs user code in visible-process mode, where the
// engine does set the flag, and checks neither the code nor a process it
// starts can see it.
func assertRunnerDropsHideFlag(t *testing.T, exe *codeblock.Executor) {
	t.Helper()
	const code = `import os, subprocess, sys

def execute():
    sub = subprocess.run(
        [sys.executable, "-c", "import os; print(os.environ.get('NLPGO_CODE_BLOCK_HIDE'))"],
        capture_output=True, text=True,
    ).stdout.strip()
    return {"own": os.environ.get("NLPGO_CODE_BLOCK_HIDE"), "sub": sub}
`
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            code,
		DeclaredOutputs: []string{"own", "sub"},
		Timeout:         30 * time.Second,
	})
	require.NoError(t, err)
	require.NotNil(t, res)
	require.Nil(t, res.Error, "expected success, got %+v", res.Error)
	assert.Nil(t, res.Outputs["own"], "user code must not see the hide flag")
	assert.Equal(t, "None", res.Outputs["sub"], "a process user code starts must not see the hide flag")
}

// assertOtherBlocksRunThroughEngine builds an engine around this refused
// executor and runs a code node and an HTTP node as Studio component runs: the
// code node carries the error that names the setting while the HTTP node
// still answers.
func assertOtherBlocksRunThroughEngine(t *testing.T, exe *codeblock.Executor) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"ok":"yes"}`))
	}))
	defer srv.Close()
	eng := engine.New(engine.Options{
		Code: exe,
		HTTP: httpblock.New(httpblock.Options{SSRF: httpblock.SSRFOptions{AllowedHosts: []string{"127.0.0.1"}}}),
	})
	field := func(id, typ string, value any) dsl.Field {
		raw, err := json.Marshal(value)
		require.NoError(t, err)
		return dsl.Field{Identifier: id, Type: dsl.FieldType(typ), Value: raw}
	}
	wf := &dsl.Workflow{
		WorkflowID: "hide-refused",
		Nodes: []dsl.Node{
			{ID: "code-1", Type: dsl.ComponentCode, Data: dsl.Component{
				Parameters: []dsl.Field{field("code", "code", trivialBlock)},
				Outputs:    []dsl.Field{{Identifier: "answer", Type: dsl.FieldTypeStr}},
			}},
			{ID: "http-1", Type: dsl.ComponentHTTP, Data: dsl.Component{
				Parameters: []dsl.Field{
					field("url", "str", srv.URL),
					field("method", "str", "GET"),
					field("output_path", "str", "$.ok"),
				},
			}},
		},
	}
	run := func(nodeID string) *engine.NodeState {
		res, err := eng.Execute(context.Background(), engine.ExecuteRequest{Workflow: wf, NodeID: nodeID, Inputs: map[string]any{}})
		require.NoError(t, err)
		require.Contains(t, res.Nodes, nodeID)
		return res.Nodes[nodeID]
	}

	httpState := run("http-1")
	require.Nil(t, httpState.Error, "node http-1 must not be touched by the disabled code executor")
	assert.Equal(t, "yes", httpState.Outputs["value"], "node http-1 output")

	codeState := run("code-1")
	require.NotNil(t, codeState.Error, "node code-1 must carry the error")
	assert.Contains(t, codeState.Error.Message, codeblock.AllowVisibleProcessSetting, "node code-1 error")
}

// assertHideModeLogged checks the one operator-facing record of the mode:
// info when strict, a warning when the platform refused the hide step.
func assertHideModeLogged(t *testing.T, logs *observer.ObservedLogs, name string) {
	t.Helper()
	want := map[string]struct {
		mode  string
		level zapcore.Level
	}{
		"not-refused":            {"strict", zapcore.InfoLevel},
		"refused-allowed":        {"visible-process", zapcore.WarnLevel},
		"refused-unset":          {"disabled", zapcore.WarnLevel},
		"refused-eacces-allowed": {"disabled", zapcore.WarnLevel},
	}[name]
	entries := logs.FilterMessage("nlpgo_code_block_hide_mode").All()
	require.Len(t, entries, 1, "the mode is logged exactly once")
	assert.Equal(t, want.level, entries[0].Level)
	assert.Equal(t, want.mode, entries[0].ContextMap()["mode"])
}

func runRunnerCase(t *testing.T, c runnerCase) {
	t.Helper()
	source, err := os.ReadFile("runner.py")
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "python3", "-c", string(source)) //nolint:gosec // fixed interpreter running the checked-in runner.py
	cmd.Env = []string{"PATH=" + os.Getenv("PATH")}
	if c.bestEffort {
		cmd.Env = append(cmd.Env, hideModeEnv+"=best-effort")
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	const hideFailure = "prctl(PR_SET_DUMPABLE) failed"
	if c.wantFailure {
		exitErr, ok := runErr.(*exec.ExitError)
		require.True(t, ok, "expected the runner to exit non-zero, got %v", runErr)
		assert.Equal(t, 1, exitErr.ExitCode())
		assert.Contains(t, stderr.String(), hideFailure)
		return
	}
	assert.NotContains(t, stderr.String(), hideFailure, "best-effort must continue past the refused prctl")
	// The next thing the runner does is ask for its payload; this harness has none.
	assert.Contains(t, stderr.String(), "runner: invalid JSON in the payload")
}
