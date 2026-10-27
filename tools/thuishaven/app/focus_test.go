package app

import (
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func focusOrchestrator(store *fakeStore) *Orchestrator {
	return &Orchestrator{cfg: Config{Naming: domain.DefaultNaming("")}, store: store, log: zap.NewNop()}
}

func TestFocusMovesOnlyOnExplicitEvents(t *testing.T) {
	store := &fakeStore{stacks: []domain.Stack{
		{Slug: "feat-a", WorktreeDir: "/w/a"}, {Slug: "feat-b", WorktreeDir: "/w/b"},
	}}
	o := focusOrchestrator(store)

	t.Run("given no focus was ever set, it reads as none", func(t *testing.T) {
		if got := o.FocusedSlug(); got != "" {
			t.Fatalf("focus = %q", got)
		}
	})

	t.Run("when haven focus names a stack, it becomes the focus", func(t *testing.T) {
		if _, err := o.SetFocus("feat-a"); err != nil || o.FocusedSlug() != "feat-a" {
			t.Fatalf("focus = %q err = %v", o.FocusedSlug(), err)
		}
	})

	t.Run("when a heartbeat refreshes the other stack, the focus stays", func(t *testing.T) {
		store.stacks[1].UpdatedAt = store.stacks[1].UpdatedAt.Add(1)
		store.stacks[0], store.stacks[1] = store.stacks[1], store.stacks[0]
		if got := o.FocusedSlug(); got != "feat-a" {
			t.Fatalf("focus = %q", got)
		}
	})

	t.Run("when haven switch lands in another stack's worktree, the focus follows", func(t *testing.T) {
		o.FocusWorktree("/w/b")
		if got := o.FocusedSlug(); got != "feat-b" {
			t.Fatalf("focus = %q", got)
		}
	})

	t.Run("when switch lands in a worktree with no stack, the focus stays", func(t *testing.T) {
		o.FocusWorktree("/w/none")
		if got := o.FocusedSlug(); got != "feat-b" {
			t.Fatalf("focus = %q", got)
		}
	})

	t.Run("when a prefix matches two stacks or none, focus is refused and unchanged", func(t *testing.T) {
		if _, err := o.SetFocus("feat"); err == nil {
			t.Error("ambiguous prefix accepted")
		}
		if _, err := o.SetFocus("zzz"); err == nil {
			t.Error("unknown stack accepted")
		}
		if got := o.FocusedSlug(); got != "feat-b" {
			t.Fatalf("focus = %q", got)
		}
	})

	t.Run("when the focused stack goes, focus is none and stays none", func(t *testing.T) {
		store.RemoveStack("feat-b")
		if got := o.FocusedSlug(); got != "" {
			t.Fatalf("focus = %q", got)
		}
		if store.focus != "" {
			t.Errorf("persisted focus = %q, want cleared", store.focus)
		}
	})
}
