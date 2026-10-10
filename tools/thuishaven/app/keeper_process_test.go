package app_test

import (
	"context"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/dashboard"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/fileregistry"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/procsupervisor"
	"github.com/langwatch/langwatch/tools/thuishaven/adapters/system"
	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const keeperTestSlug = "keeper-handover"

func stackNamed(store *fileregistry.Store, slug string) (domain.Stack, bool) {
	stacks := store.Stacks()
	for i := range stacks {
		if stacks[i].Slug == slug {
			return stacks[i], true
		}
	}
	return domain.Stack{}, false
}

func realKeeperOrch(home string) (*app.Orchestrator, *fileregistry.Store) {
	store := fileregistry.New(home)
	return app.New(app.Deps{
		Cfg: app.Config{
			PortlessDisabled: true, HeartbeatEvery: time.Hour,
			KeepArgv:   []string{os.Args[0], "-test.run=^TestKeeperHelperProcess$"},
			DaemonArgv: []string{os.Args[0], "-test.run=^TestDaemonHelperProcess$"},
		},
		Store: store, Sys: system.System{}, Sup: procsupervisor.New(true), Daemon: dashboard.Client{},
	}), store
}

// serveDaemon serves the daemon's start route for o and claims the daemon
// record, as `haven daemon` does, until the returned stop.
func serveDaemon(t *testing.T, o *app.Orchestrator, store *fileregistry.Store) (stop func()) {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	require.NoError(t, err)
	port := l.Addr().(*net.TCPAddr).Port
	require.NoError(t, l.Close())
	dash := dashboard.New(dashboard.Config{
		Stacks:    store.Stacks,
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

// TestDaemonHelperProcess is the daemon an up with none running starts.
func TestDaemonHelperProcess(t *testing.T) {
	home := os.Getenv("HAVEN_KEEPER_TEST_HOME")
	if home == "" {
		t.Skip("helper process for TestUpStartsTheDaemonWhenNoneRuns")
	}
	o, store := realKeeperOrch(home)
	defer serveDaemon(t, o, store)()
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
}

// TestKeeperHelperProcess is the keeper TestHandOverGivesTheStackToARealKeeper starts.
func TestKeeperHelperProcess(t *testing.T) {
	home := os.Getenv("HAVEN_KEEPER_TEST_HOME")
	if home == "" {
		t.Skip("helper process for TestHandOverGivesTheStackToARealKeeper")
	}
	o, _ := realKeeperOrch(home)
	plan, err := o.ReadKeeperPlan(keeperTestSlug)
	require.NoError(t, err)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM)
	defer stop()
	require.NoError(t, o.Keep(ctx, keeperTestSlug, plan))
}

// @scenario "Up hands its stack to a keeper the daemon starts"
func TestHandOverGivesTheStackToARealKeeper(t *testing.T) {
	home, wt := t.TempDir(), t.TempDir()
	t.Setenv("HAVEN_KEEPER_TEST_HOME", home)
	o, store := realKeeperOrch(home)
	t.Cleanup(serveDaemon(t, o, store))
	self := os.Getpid()
	st := domain.Stack{Slug: keeperTestSlug, WorktreeDir: wt, LauncherPID: self, PortlessDisabled: true}
	require.NoError(t, store.SaveStack(st))

	lanes := []app.Child{{Name: "lane", Dir: wt, Shell: "sleep 30"}}
	require.NoError(t, app.HandOver(o, context.Background(), st, app.KeeperPlanFor(o, lanes, true)))
	got, ok := stackNamed(store, keeperTestSlug)
	require.True(t, ok)
	keeper := got.LauncherPID
	t.Cleanup(func() { _ = syscall.Kill(keeper, syscall.SIGKILL) })
	assert.NotEqual(t, self, keeper)
	assert.NotEmpty(t, got.LauncherStart)
	assert.Equal(t, self, got.OwnerPID)
	info, err := os.Stat(app.KeeperPlanPath(wt, keeperTestSlug))
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	require.NoError(t, syscall.Kill(keeper, syscall.SIGTERM))
	require.Eventually(t, func() bool {
		_, ok := stackNamed(store, keeperTestSlug)
		return !ok
	}, 10*time.Second, 50*time.Millisecond)
	_, err = os.Stat(app.KeeperPlanPath(wt, keeperTestSlug))
	assert.ErrorIs(t, err, os.ErrNotExist)
}

// A keeper SIGKILLed under a live owner is respawned by the daemon tick from
// its plan: a new keeper takes the record (section 11.6, D3).
func TestDaemonRespawnsAKilledKeeper(t *testing.T) {
	home, wt := t.TempDir(), t.TempDir()
	t.Setenv("HAVEN_KEEPER_TEST_HOME", home)
	o, store := realKeeperOrch(home)
	t.Cleanup(serveDaemon(t, o, store))
	self := os.Getpid()
	st := domain.Stack{Slug: keeperTestSlug, WorktreeDir: wt, LauncherPID: self, PortlessDisabled: true}
	require.NoError(t, store.SaveStack(st))
	lanes := []app.Child{{Name: "lane", Dir: wt, Shell: "sleep 30"}}
	require.NoError(t, app.HandOver(o, context.Background(), st, app.KeeperPlanFor(o, lanes, true)))
	got, _ := stackNamed(store, keeperTestSlug)
	first := got.LauncherPID
	require.NoError(t, syscall.Kill(first, syscall.SIGKILL))
	require.Eventually(t, func() bool { return syscall.Kill(first, 0) != nil }, 5*time.Second, 20*time.Millisecond)

	app.ReapDeadStacks(o)
	var second int
	require.Eventually(t, func() bool {
		cur, ok := stackNamed(store, keeperTestSlug)
		second = cur.LauncherPID
		return ok && second != first && second != self
	}, 10*time.Second, 50*time.Millisecond)
	t.Cleanup(func() { _ = syscall.Kill(second, syscall.SIGKILL) })
	cur, _ := stackNamed(store, keeperTestSlug)
	assert.Equal(t, self, cur.OwnerPID)

	require.NoError(t, syscall.Kill(second, syscall.SIGTERM))
	require.Eventually(t, func() bool {
		_, ok := stackNamed(store, keeperTestSlug)
		return !ok
	}, 10*time.Second, 50*time.Millisecond)
}

// @scenario "Up starts the daemon first when none is running"
func TestUpStartsTheDaemonWhenNoneRuns(t *testing.T) {
	home, wt := t.TempDir(), t.TempDir()
	t.Setenv("HAVEN_KEEPER_TEST_HOME", home)
	o, store := realKeeperOrch(home)
	self := os.Getpid()
	st := domain.Stack{Slug: keeperTestSlug, WorktreeDir: wt, LauncherPID: self, LauncherStart: system.System{}.ProcessStart(self), PortlessDisabled: true}
	require.NoError(t, store.SaveStack(st))
	_, running := store.Daemon()
	require.False(t, running)

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
	assert.NotEqual(t, self, daemon.PID)
	assert.NotEqual(t, self, got.LauncherPID)
	ppid, err := exec.Command("ps", "-o", "ppid=", "-p", strconv.Itoa(got.LauncherPID)).Output() //nolint:gosec // G204: fixed argv, a pid this test started
	require.NoError(t, err)
	assert.Equal(t, strconv.Itoa(daemon.PID), strings.TrimSpace(string(ppid)), "the daemon, not the up, starts the keeper")
}
