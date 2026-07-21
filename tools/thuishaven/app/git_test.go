package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// gitTestHygiene is a local fake for GitTargetDir tests with a settable
// Worktrees error. Deliberately separate from hub_test.go's fakeHygiene.
type gitTestHygiene struct {
	worktrees    []Worktree
	worktreesErr error
}

func (f *gitTestHygiene) Worktrees(string) ([]Worktree, error)  { return f.worktrees, f.worktreesErr }
func (f *gitTestHygiene) Dirty(string) bool                     { return false }
func (f *gitTestHygiene) DirSize(string) (int64, bool)          { return 0, false }
func (f *gitTestHygiene) DiskUsage(string) (int64, bool)        { return 0, false }
func (f *gitTestHygiene) Remove(string) error                   { return nil }
func (f *gitTestHygiene) PruneGitWorktrees(string)              {}
func (f *gitTestHygiene) RemoveWorktree(string, string) error   { return nil }
func (f *gitTestHygiene) LastActivity(string) (time.Time, bool) { return time.Time{}, false }
func (f *gitTestHygiene) UpstreamGone(string, string) bool      { return false }

// @scenario "Opening the git UI for another stack by slug"
// @scenario "Unknown target is rejected with the available choices"
func TestResolveGitTarget(t *testing.T) {
	stacks := []domain.Stack{
		{Slug: "portless", WorktreeDir: "/repos/worktrees/portless"},
		{Slug: "langy", WorktreeDir: "/repos/worktrees/langy-rework"},
	}
	worktrees := []Worktree{
		{Dir: "/repos/langwatch", Branch: "main"},
		{Dir: "/repos/worktrees/portless", Branch: "feat/portless"},
		{Dir: "/repos/worktrees/quiet", Branch: "fix/quiet"},
	}

	t.Run("given running stacks and worktrees", func(t *testing.T) {
		t.Run("when the target is a stack slug, it resolves to that stack's worktree", func(t *testing.T) {
			dir, err := ResolveGitTarget(stacks, worktrees, "langy")
			if err != nil || dir != "/repos/worktrees/langy-rework" {
				t.Errorf("got (%q, %v), want the langy stack's worktree", dir, err)
			}
		})

		t.Run("when the target matches only a worktree basename, it resolves to that worktree", func(t *testing.T) {
			dir, err := ResolveGitTarget(stacks, worktrees, "quiet")
			if err != nil || dir != "/repos/worktrees/quiet" {
				t.Errorf("got (%q, %v), want the quiet worktree", dir, err)
			}
		})

		t.Run("when a slug and a basename collide, the stack slug wins", func(t *testing.T) {
			dir, err := ResolveGitTarget(stacks, worktrees, "portless")
			if err != nil || dir != "/repos/worktrees/portless" {
				t.Errorf("got (%q, %v), want the registered stack's dir", dir, err)
			}
		})

		t.Run("when the target is unknown, the error lists the valid choices", func(t *testing.T) {
			_, err := ResolveGitTarget(stacks, worktrees, "nosuch")
			if err == nil {
				t.Fatal("expected an error for an unknown target")
			}
			for _, want := range []string{"portless", "langy", "quiet"} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q should list %q", err.Error(), want)
				}
			}
			if got := strings.Count(err.Error(), "portless"); got != 1 {
				t.Errorf("error %q should list %q exactly once (deduped), got %d occurrences", err.Error(), "portless", got)
			}
		})
	})
}

func TestGitTargetDir(t *testing.T) {
	stacks := []domain.Stack{
		{Slug: "portless", WorktreeDir: "/repos/worktrees/portless"},
	}

	t.Run("given the worktree listing fails", func(t *testing.T) {
		o := &Orchestrator{
			store: &fakeStore{stacks: stacks},
			hyg:   &gitTestHygiene{worktreesErr: errors.New("git worktree list: boom")},
		}

		t.Run("when the target is a registered stack slug, it still resolves", func(t *testing.T) {
			dir, err := o.GitTargetDir("/repos/langwatch", "portless")
			if err != nil || dir != "/repos/worktrees/portless" {
				t.Errorf("got (%q, %v), want the registered stack's dir despite the listing failure", dir, err)
			}
		})

		t.Run("when the target is unknown, the error surfaces the listing failure", func(t *testing.T) {
			_, err := o.GitTargetDir("/repos/langwatch", "nosuch")
			if err == nil {
				t.Fatal("expected an error for an unknown target")
			}
			if !strings.Contains(err.Error(), "nosuch") {
				t.Errorf("error %q should name the unknown target", err.Error())
			}
			if !strings.Contains(err.Error(), "git worktree list: boom") {
				t.Errorf("error %q should surface the worktree-listing failure", err.Error())
			}
		})
	})

	t.Run("given no hygiene adapter is wired", func(t *testing.T) {
		o := &Orchestrator{store: &fakeStore{stacks: stacks}}

		t.Run("when the target is a registered stack slug, it resolves from stacks alone", func(t *testing.T) {
			dir, err := o.GitTargetDir("/repos/langwatch", "portless")
			if err != nil || dir != "/repos/worktrees/portless" {
				t.Errorf("got (%q, %v), want the registered stack's dir", dir, err)
			}
		})
	})
}
