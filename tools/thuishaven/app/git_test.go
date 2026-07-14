package app

import (
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

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
		})
	})
}
