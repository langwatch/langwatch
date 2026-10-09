package app_test

import (
	"context"
	"os"
	"os/signal"
	"syscall"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

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
			KeepArgv: []string{os.Args[0], "-test.run=^TestKeeperHelperProcess$"},
		},
		Store: store, Sys: system.System{}, Sup: procsupervisor.New(true),
	}), store
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

func TestHandOverGivesTheStackToARealKeeper(t *testing.T) {
	home, wt := t.TempDir(), t.TempDir()
	t.Setenv("HAVEN_KEEPER_TEST_HOME", home)
	o, store := realKeeperOrch(home)
	self := os.Getpid()
	st := domain.Stack{Slug: keeperTestSlug, WorktreeDir: wt, LauncherPID: self, PortlessDisabled: true}
	require.NoError(t, store.SaveStack(st))

	lanes := []app.Child{{Name: "lane", Dir: wt, Shell: "sleep 30"}}
	require.NoError(t, app.HandOver(o, st, lanes, true))
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
