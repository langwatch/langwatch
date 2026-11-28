//go:build linux

package codeblock_test

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/codeblock"
)

// A readable process holding a credential disables code blocks, and the reason
// says what to do about that process: a shell that started the engine and a
// process in another PID namespace are not fixed by an execute-only binary.

const holderPidEnv = "NLPGO_TEST_HOLDER_PID"

// @scenario "a credential in the environment that starts the engine disables code blocks with advice to unset it"
func TestCredentialHolder_TheProcessThatStartedTheEngine(t *testing.T) {
	// sh stays the engine's parent: the command after it keeps it from exec'ing.
	starter := []string{"/bin/sh", "-c", `"$0" "$@"; exit $?`, os.Args[0]}
	runChildCommand(t, starter, "holder-started-the-engine", roleSecretEnv+"="+credentialCanary)
}

// @scenario "a credential held in another PID namespace disables code blocks with advice that fits it"
func TestCredentialHolder_AProcessInAnotherPIDNamespace(t *testing.T) {
	unshare := []string{"unshare", "--user", "--pid", "--fork"}
	if err := exec.Command(unshare[0], append(unshare[1:], "true")...).Run(); err != nil { //nolint:gosec // fixed arguments
		t.Skipf("this host cannot start a process in a PID namespace of its own: %v", err)
	}
	cmd := exec.Command(unshare[0], append(unshare[1:], "env", roleSecretEnv+"="+credentialCanary, "sleep", "120")...) //nolint:gosec // fixed arguments
	cmd.Env = []string{"PATH=" + os.Getenv("PATH")}
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _, _ = cmd.Process.Wait() })
	holder := 0
	require.Eventually(t, func() bool {
		holder = childHolding(cmd.Process.Pid, credentialCanary)
		return holder != 0
	}, 5*time.Second, 20*time.Millisecond, "the process in the new namespace never took the credential")
	runChild(t, "holder-in-another-pid-namespace", holderPidEnv+"="+strconv.Itoa(holder))
}

// childHolding returns the child of parent whose environment holds value, or 0.
func childHolding(parent int, value string) int {
	entries, _ := os.ReadDir("/proc")
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil {
			continue
		}
		stat, err := os.ReadFile("/proc/" + entry.Name() + "/stat")
		if err != nil {
			continue
		}
		fields := strings.Fields(string(stat[bytes.LastIndexByte(stat, ')')+1:]))
		if len(fields) < 2 || fields[1] != strconv.Itoa(parent) {
			continue
		}
		if environ, err := os.ReadFile("/proc/" + entry.Name() + "/environ"); err == nil && bytes.Contains(environ, []byte(value)) {
			return pid
		}
	}
	return 0
}

// runHolderCase builds the executor and requires code blocks to be refused
// naming holder, with the advice that fits it.
func runHolderCase(t *testing.T, holder int, advice string) {
	t.Helper()
	exe, err := codeblock.New(codeblock.Options{Python: casePython()})
	require.NoError(t, err)
	res, err := exe.Execute(context.Background(), codeblock.Request{
		Code:            trivialBlock,
		DeclaredOutputs: []string{"answer"},
		Timeout:         30 * time.Second,
	})
	require.NoError(t, err)
	require.NotNil(t, res.Error, "code blocks must refuse to run beside a readable holder")
	want := fmt.Sprintf("code blocks are disabled: process %d holds %s and its environment is readable by user code; %s", holder, roleSecretEnv, advice)
	assert.Equal(t, want, res.Error.Message)
}

func init() {
	acceptsHide["holder-started-the-engine"] = true
	lambdaCases["holder-started-the-engine"] = func(t *testing.T) {
		t.Helper()
		runHolderCase(t, os.Getppid(), "it started the engine, so unset "+roleSecretEnv+" in the environment the engine is started from")
	}
	acceptsHide["holder-in-another-pid-namespace"] = true
	lambdaCases["holder-in-another-pid-namespace"] = func(t *testing.T) {
		t.Helper()
		holder, err := strconv.Atoi(os.Getenv(holderPidEnv))
		require.NoError(t, err)
		runHolderCase(t, holder, "it runs in another PID namespace, so stop it or run the engine in a PID namespace of its own")
	}
}
