package app

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

const keeperTestSlug = "keeper-handover"

func TestWriteKeeperPlanIsOwnerOnlyOverAWiderFileOrASymlink(t *testing.T) {
	wt := t.TempDir()
	path := keeperPlanPath(wt, keeperTestSlug)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
	require.NoError(t, os.WriteFile(path, []byte("old"), 0o644)) //nolint:gosec // the wider file the writer must replace
	plan := KeeperPlan{Env: []string{"SECRET=s3cret"}, OwnerPID: 7}
	require.NoError(t, writeKeeperPlan(path, plan))
	info, err := os.Stat(path)
	require.NoError(t, err)
	assert.Equal(t, os.FileMode(0o600), info.Mode().Perm())

	target := filepath.Join(t.TempDir(), "elsewhere")
	require.NoError(t, os.WriteFile(target, []byte("untouched"), 0o600))
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Symlink(target, path))
	require.NoError(t, writeKeeperPlan(path, plan))
	data, err := os.ReadFile(target)
	require.NoError(t, err)
	assert.Equal(t, "untouched", string(data))

	o := New(Deps{Store: &fakeStore{stacks: []domain.Stack{{Slug: keeperTestSlug, WorktreeDir: wt}}}})
	got, err := o.ReadKeeperPlan(keeperTestSlug)
	require.NoError(t, err)
	assert.Equal(t, plan.Env, got.Env)
	assert.Equal(t, 7, got.OwnerPID)

	removeKeeperPlan(wt, keeperTestSlug)
	_, err = os.Stat(path)
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestReadKeeperPlanNamesNoContentWhenUnreadable(t *testing.T) {
	wt := t.TempDir()
	path := keeperPlanPath(wt, keeperTestSlug)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
	require.NoError(t, os.WriteFile(path, []byte(`{"env":["SECRET=x"`), 0o600))
	o := New(Deps{Store: &fakeStore{stacks: []domain.Stack{{Slug: keeperTestSlug, WorktreeDir: wt}}}})
	_, err := o.ReadKeeperPlan(keeperTestSlug)
	require.Error(t, err)
	assert.NotContains(t, err.Error(), "SECRET")
}

func TestAwaitKeeperReturnsOnlyOnceAnotherLiveLauncherHoldsTheRecord(t *testing.T) {
	sys := &fakeSystem{alive: map[int]bool{1: true, 2: true}}
	held := New(Deps{Sys: sys, Store: &fakeStore{stacks: []domain.Stack{{Slug: keeperTestSlug, LauncherPID: 2}}}})
	require.NoError(t, held.awaitKeeper(within(t, time.Second), keeperTestSlug, 1))

	notYet := New(Deps{Sys: sys, Store: &fakeStore{stacks: []domain.Stack{{Slug: keeperTestSlug, LauncherPID: 1}}}})
	require.Error(t, notYet.awaitKeeper(within(t, 100*time.Millisecond), keeperTestSlug, 1))

	deadKeeper := New(Deps{Sys: sys, Store: &fakeStore{stacks: []domain.Stack{{Slug: keeperTestSlug, LauncherPID: 3}}}})
	require.Error(t, deadKeeper.awaitKeeper(within(t, 100*time.Millisecond), keeperTestSlug, 1))

	gone := New(Deps{Sys: sys, Store: &fakeStore{}})
	require.Error(t, gone.awaitKeeper(within(t, time.Second), keeperTestSlug, 1))
}

func TestKeeperTeardownLeavesARecordAnotherLauncherHolds(t *testing.T) {
	wt := t.TempDir()
	store := &fakeStore{stacks: []domain.Stack{{Slug: keeperTestSlug, WorktreeDir: wt, LauncherPID: 9, PortlessDisabled: true}}}
	require.NoError(t, writeKeeperPlan(keeperPlanPath(wt, keeperTestSlug), KeeperPlan{}))
	o := New(Deps{Store: store})

	o.dropKeptStack(domain.Stack{Slug: keeperTestSlug, LauncherPID: 1})
	assert.Empty(t, store.removed)
	_, err := os.Stat(keeperPlanPath(wt, keeperTestSlug))
	require.NoError(t, err)

	o.dropKeptStack(domain.Stack{Slug: keeperTestSlug, LauncherPID: 9})
	assert.Equal(t, []string{keeperTestSlug}, store.removed)
	_, err = os.Stat(keeperPlanPath(wt, keeperTestSlug))
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestKeeperTeardownRemovesItsPlanWhenTheRecordIsAlreadyGone(t *testing.T) {
	wt := t.TempDir()
	require.NoError(t, writeKeeperPlan(keeperPlanPath(wt, keeperTestSlug), KeeperPlan{}))
	New(Deps{Store: &fakeStore{}}).dropKeptStack(domain.Stack{Slug: keeperTestSlug, WorktreeDir: wt, LauncherPID: 9})
	_, err := os.Stat(keeperPlanPath(wt, keeperTestSlug))
	assert.ErrorIs(t, err, os.ErrNotExist)
}

func TestReadKeeperPlanRefusesAWiderFileOrASymlink(t *testing.T) {
	wt := t.TempDir()
	path := keeperPlanPath(wt, keeperTestSlug)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o700))
	require.NoError(t, os.WriteFile(path, []byte(`{"env":["INJECTED=x"]}`), 0o600))
	require.NoError(t, os.Chmod(path, 0o644)) //nolint:gosec // the wider file the reader must refuse
	o := New(Deps{Store: &fakeStore{stacks: []domain.Stack{{Slug: keeperTestSlug, WorktreeDir: wt}}}})
	_, err := o.ReadKeeperPlan(keeperTestSlug)
	require.Error(t, err)

	planted := filepath.Join(t.TempDir(), "planted.json")
	require.NoError(t, os.WriteFile(planted, []byte(`{"env":["INJECTED=x"]}`), 0o600))
	require.NoError(t, os.Remove(path))
	require.NoError(t, os.Symlink(planted, path))
	_, err = o.ReadKeeperPlan(keeperTestSlug)
	require.Error(t, err)
}

func TestIgnoreHavenStateKeepsTheWholeDirectoryOutOfGit(t *testing.T) {
	wt := t.TempDir()
	require.NoError(t, ignoreHavenState(wt))
	require.NoError(t, ignoreHavenState(wt))
	data, err := os.ReadFile(filepath.Join(wt, ".haven", ".gitignore"))
	require.NoError(t, err)
	assert.Equal(t, "*\n", string(data))
}

// within is a context that ends after d, as the daemon's hand-over wait does.
func within(t *testing.T, d time.Duration) context.Context {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), d)
	t.Cleanup(cancel)
	return ctx
}
