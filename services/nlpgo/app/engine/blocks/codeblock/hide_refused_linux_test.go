//go:build linux

package codeblock_test

import (
	"bytes"
	"context"
	"fmt"
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

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// Lambda's seccomp answers EPERM to prctl(PR_SET_DUMPABLE). A filter cannot be
// removed, so each case runs in a re-executed copy of this test binary that
// installs one; the parent reports the child's verdict.

const (
	caseEnv      = "NLPGO_TEST_HIDE_CASE"
	settingName  = "NLPGO_ENGINE_CODE_BLOCK_ALLOW_VISIBLE_PROCESS"
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

// refusePrSetDumpable makes every thread of this process answer EPERM to
// prctl(PR_SET_DUMPABLE) and nothing else, as Lambda's filter does.
func refusePrSetDumpable() error {
	seccompNr, prctlNr, arch, ok := seccompNumbers()
	if !ok {
		return fmt.Errorf("unsupported architecture %s", runtime.GOARCH)
	}
	const (
		ldAbs = 0x20 // BPF_LD | BPF_W | BPF_ABS
		jeq   = 0x15 // BPF_JMP | BPF_JEQ | BPF_K
		ret   = 0x06 // BPF_RET | BPF_K
		allow = 0x7fff0000
		eperm = 0x00050000 | 1 // SECCOMP_RET_ERRNO | EPERM
	)
	prog := []syscall.SockFilter{
		{Code: ldAbs, K: 4},                   // 0 arch
		{Code: jeq, Jt: 0, Jf: 4, K: arch},    // 1 other arch -> 6 allow
		{Code: ldAbs, K: 0},                   // 2 syscall number
		{Code: jeq, Jt: 0, Jf: 2, K: prctlNr}, // 3 not prctl -> 6 allow
		{Code: ldAbs, K: 16},                  // 4 args[0], the prctl option
		{Code: jeq, Jt: 1, Jf: 0, K: 4},       // 5 PR_SET_DUMPABLE -> 7 EPERM
		{Code: ret, K: allow},                 // 6
		{Code: ret, K: eperm},                 // 7
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
		env = append(env, kv)
	}
	env = append(env, caseEnv+"="+name)
	return append(env, extra...)
}

// runChild re-executes this test binary on the child entry point and fails the
// parent with the child's output when the child's assertions fail.
func runChild(t *testing.T, name string, extra ...string) {
	t.Helper()
	if _, err := exec.LookPath("python3"); err != nil {
		t.Skip("python3 not installed; the case runs a real code block")
	}
	ctx, cancel := context.WithTimeout(context.Background(), childTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestHideRefusedChild$", "-test.v", "-test.timeout=80s") //nolint:gosec // re-executes this test binary, no external input
	cmd.Env = childEnvFor(name, extra...)
	var out bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &out
	err := cmd.Run()
	if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() == skipExitCode {
		t.Skipf("cannot install the seccomp filter here, so Lambda's refusal cannot be reproduced: %s", out.String())
	}
	require.NoError(t, err, "child case %s failed:\n%s", name, out.String())
}

/** @scenario "a platform that lets the engine hide its process files runs code blocks in strict mode" */
func TestHideRefused_StrictWhenPlatformAllowsIt(t *testing.T) {
	runChild(t, "not-refused")
}

/** @scenario "a platform that refuses the hide step runs code blocks when visible-process is allowed" */
func TestHideRefused_VisibleProcessWhenAllowed(t *testing.T) {
	runChild(t, "refused-allowed")
}

/** @scenario "a platform that refuses the hide step serves no code blocks unless visible-process is allowed" */
func TestHideRefused_DisabledWhenNotAllowed(t *testing.T) {
	runChild(t, "refused-unset")
}

func TestHideRefused_RunnerHideStep(t *testing.T) {
	t.Run("given prctl is refused and NLPGO_CODE_BLOCK_HIDE is unset", func(t *testing.T) {
		t.Run("the runner exits 1 with the prctl message", func(t *testing.T) {
			runChild(t, "runner-strict")
		})
	})
	t.Run("given prctl is refused and NLPGO_CODE_BLOCK_HIDE is best-effort", func(t *testing.T) {
		t.Run("the runner gets past the hide step", func(t *testing.T) {
			runChild(t, "runner-best-effort", hideModeEnv+"=best-effort")
		})
	})
}

// TestHideRefusedChild is the child entry point. It does nothing unless the
// parent set the case marker.
func TestHideRefusedChild(t *testing.T) {
	name := os.Getenv(caseEnv)
	if name == "" {
		t.Skip("entry point for the re-executed child; run through TestHideRefused_*")
	}
	if name != "not-refused" {
		if err := refusePrSetDumpable(); err != nil {
			fmt.Fprintf(os.Stderr, "seccomp install failed: %v\n", err)
			os.Exit(skipExitCode)
		}
	}
	switch name {
	case "runner-strict", "runner-best-effort":
		runRunnerCase(t, name)
	default:
		runExecutorCase(t, name)
	}
}

func runExecutorCase(t *testing.T, name string) {
	t.Helper()
	exe, err := codeblock.New(codeblock.Options{
		AllowVisibleProcess:        name == "refused-allowed",
		AllowVisibleProcessSetting: settingName,
	})
	require.NoError(t, err, "codeblock.New must never abort the engine over PR_SET_DUMPABLE")

	res, runErr := exe.Execute(context.Background(), codeblock.Request{
		Code:            trivialBlock,
		DeclaredOutputs: []string{"answer"},
		Timeout:         30 * time.Second,
	})

	switch name {
	case "refused-unset":
		require.NoError(t, runErr)
		require.NotNil(t, res)
		require.NotNil(t, res.Error)
		assert.Contains(t, res.Error.Message, settingName)
	default:
		require.NoError(t, runErr)
		require.NotNil(t, res)
		require.Nil(t, res.Error, "expected success, got %+v", res.Error)
		assert.EqualValues(t, 42, res.Outputs["answer"])
	}
}

func runRunnerCase(t *testing.T, name string) {
	t.Helper()
	source, err := os.ReadFile("runner.py")
	require.NoError(t, err)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "python3", "-c", string(source)) //nolint:gosec // fixed interpreter running the checked-in runner.py
	cmd.Env = []string{"PATH=" + os.Getenv("PATH")}
	if name == "runner-best-effort" {
		cmd.Env = append(cmd.Env, hideModeEnv+"=best-effort")
	}
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	runErr := cmd.Run()

	const hideFailure = "prctl(PR_SET_DUMPABLE) failed"
	if name == "runner-strict" {
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
