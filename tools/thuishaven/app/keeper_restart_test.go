package app_test

import (
	"context"
	"net"
	"os"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/system"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// serveRestartingDaemon is a daemon on its way out: it holds the record but
// answers the start route with 404 unknown stack, as one rebuilt mid-boot did.
func serveRestartingDaemon(t *testing.T, home string) (stop func()) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := l.Addr().(*net.TCPAddr).Port
	require.NoError(t, l.Close())
	o, store := realKeeperOrch(home)
	dash := dashboard.New(dashboard.Config{
		Stacks:    func() []domain.Stack { return nil },
		SharedURL: func(svc string) string { return "https://" + svc + ".langwatch.localhost" },
		Actions:   dashboard.Actions{StartKeeper: o.StartKeeper},
	})
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = dash.Serve(ctx, port) }()
	require.Eventually(t, func() bool { return system.System{}.PortInUse(port) }, 5*time.Second, 20*time.Millisecond)
	pid := os.Getpid()
	claimed, err := store.ClaimDaemon(app.DaemonInfo{PID: pid, Start: system.System{}.ProcessStart(pid), Port: port})
	require.NoError(t, err)
	require.True(t, claimed)
	return func() {
		store.ClearDaemon()
		cancel()
	}
}

// A daemon rebuilt mid-boot answers 404 until its successor serves; the up keeps asking.
// @scenario "Up's hand-over survives the daemon restarting after a rebuild"
func TestHandOverSurvivesADaemonRestart(t *testing.T) {
	home, wt := t.TempDir(), t.TempDir()
	t.Setenv("HAVEN_KEEPER_TEST_HOME", home)
	o, store := realKeeperOrch(home)
	self := os.Getpid()
	st := domain.Stack{Slug: keeperTestSlug, WorktreeDir: wt, LauncherPID: self, LauncherStart: system.System{}.ProcessStart(self), PortlessDisabled: true}
	require.NoError(t, store.SaveStack(st))

	stopOld := serveRestartingDaemon(t, home)
	go func() {
		time.Sleep(700 * time.Millisecond)
		stopOld()
	}()

	lanes := []app.Child{{Name: "lane", Dir: wt, Shell: "sleep 30"}}
	require.NoError(t, app.HandOver(o, context.Background(), st, app.KeeperPlanFor(o, lanes, false)))
	daemon, ok := store.Daemon()
	require.True(t, ok)
	got, ok := stackNamed(store, keeperTestSlug)
	require.True(t, ok)
	t.Cleanup(func() {
		_ = syscall.Kill(got.LauncherPID, syscall.SIGKILL)
		_ = syscall.Kill(daemon.PID, syscall.SIGKILL)
	})
	assert.NotEqual(t, self, daemon.PID, "the successor daemon, not the one that 404ed, started the keeper")
	assert.NotEqual(t, self, got.LauncherPID)
}
