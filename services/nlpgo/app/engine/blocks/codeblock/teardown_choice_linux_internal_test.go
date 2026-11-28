//go:build linux

package codeblock

import (
	"os/exec"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/sys/unix"
)

// @scenario "off AWS Lambda, teardown never sweeps for strays"
func TestChooseTeardownSweepsForStraysOnlyOnLambda(t *testing.T) {
	refused := func() bool { return false }
	allowed := func() bool { return true }
	cases := []struct {
		name       string
		groupHolds bool
		confinable func() bool
		onLambda   bool
		want       runTeardown
	}{
		{"the group holds", true, refused, true, teardownGroup},
		{"confinement holds", false, allowed, true, teardownConfined},
		{"on Lambda with neither", false, refused, true, teardownStrays},
		{"elsewhere with neither", false, refused, false, teardownGroup},
		{"elsewhere with confinement", false, allowed, false, teardownConfined},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			assert.Equal(t, c.want, chooseTeardown(c.groupHolds, c.confinable, c.onLambda))
		})
	}
}

// @scenario "teardown signals a swept process only while its pid still names it"
func TestKillClaimedSparesAPidThatNamesAnotherProcess(t *testing.T) {
	cmd := exec.Command("sleep", "30")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	entry, ok := readProcEntry(cmd.Process.Pid)
	require.True(t, ok)

	stale := entry
	stale.startTicks++
	killClaimed(stale)
	time.Sleep(50 * time.Millisecond)
	after, ok := readProcEntry(entry.pid)
	require.True(t, ok)
	require.False(t, after.zombie, "a pid whose start time changed must not be killed")

	killClaimed(entry)
	state, err := cmd.Process.Wait()
	require.NoError(t, err)
	status, ok := state.Sys().(syscall.WaitStatus)
	require.True(t, ok)
	assert.Equal(t, syscall.SIGKILL, status.Signal())
}

// @scenario "teardown signals a swept process only while its pid still names it"
func TestKillClaimedFallsBackWhenThePidfdSignalIsRefused(t *testing.T) {
	refuse := func(int, syscall.Signal, *unix.Siginfo, int) error { return unix.EPERM }
	saved := pidfdSendSignal
	pidfdSendSignal = refuse
	t.Cleanup(func() { pidfdSendSignal = saved })
	cmd := exec.Command("sleep", "30")
	require.NoError(t, cmd.Start())
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	entry, ok := readProcEntry(cmd.Process.Pid)
	require.True(t, ok)

	killClaimed(entry)
	state, err := cmd.Process.Wait()
	require.NoError(t, err)
	status, ok := state.Sys().(syscall.WaitStatus)
	require.True(t, ok)
	assert.Equal(t, syscall.SIGKILL, status.Signal(), "a refused pidfd signal falls back to kill")
}

// @scenario "the start-up record names what the platform refused"
func TestPlatformRefusalsNameEachPrctl(t *testing.T) {
	enableProcessHardening()
	keys := map[string]bool{}
	for _, field := range platformRefusals() {
		keys[field.Key] = field.String != ""
	}
	assert.Equal(t, map[string]bool{"prctl": true, "subreaper": true, "confinement": true}, keys)
}
