package app

import (
	"strings"
	"testing"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func switchOrchestrator(store *fakeStore, sys *fakeSystem, hyg *fakeHygiene) *Orchestrator {
	return &Orchestrator{
		cfg:   Config{Naming: domain.DefaultNaming("")},
		store: store, sys: sys, hyg: hyg,
		log: zap.NewNop(),
	}
}

// `haven switch` is what the shell function from `haven shell-init` cd's to, so
// what it resolves has to be a directory or a refusal — never a guess. Typing
// enough to be unique is the contract; typing less than that must say so rather
// than pick whichever worktree sorted first.
//
// @scenario "Switching to a worktree by name"
func TestResolveSwitchFindsAWorktreeByName(t *testing.T) {
	store := &fakeStore{stacks: []domain.Stack{
		{Slug: "otel-haven", WorktreeDir: "/repo/worktrees/otel-haven", LauncherPID: 7},
	}}
	sys := &fakeSystem{alive: map[int]bool{7: true}}
	hyg := &fakeHygiene{worktrees: []Worktree{
		{Dir: "/repo"},
		{Dir: "/repo/worktrees/otel-haven"},
		{Dir: "/repo/worktrees/share-redesign"},
	}}
	o := switchOrchestrator(store, sys, hyg)

	t.Run("given several worktrees, one registered as a stack", func(t *testing.T) {
		t.Run("when a unique prefix is given", func(t *testing.T) {
			dir, err := o.ResolveSwitch("/repo", "otel")
			if err != nil {
				t.Fatalf("ResolveSwitch: %v", err)
			}
			if dir != "/repo/worktrees/otel-haven" {
				t.Errorf("dir = %q, want the otel worktree", dir)
			}
		})

		t.Run("when an exact name is given", func(t *testing.T) {
			dir, err := o.ResolveSwitch("/repo", "share-redesign")
			if err != nil {
				t.Fatalf("ResolveSwitch: %v", err)
			}
			if dir != "/repo/worktrees/share-redesign" {
				t.Errorf("dir = %q, want the share-redesign worktree", dir)
			}
		})

		// A substring is the last resort, after exact and prefix — so "haven
		// switch redesign" still lands rather than failing on a leading word.
		t.Run("when a unique substring is given", func(t *testing.T) {
			dir, err := o.ResolveSwitch("/repo", "redesign")
			if err != nil {
				t.Fatalf("ResolveSwitch: %v", err)
			}
			if dir != "/repo/worktrees/share-redesign" {
				t.Errorf("dir = %q, want the share-redesign worktree", dir)
			}
		})

		t.Run("when the query is a worktree with no registered stack", func(t *testing.T) {
			dir, err := o.ResolveSwitch("/repo", "share")
			if err != nil {
				t.Fatalf("ResolveSwitch: %v", err)
			}
			if dir != "/repo/worktrees/share-redesign" {
				t.Errorf("dir = %q, want a worktree that was never up to still be reachable", dir)
			}
		})
	})

	t.Run("given a prefix several worktrees share", func(t *testing.T) {
		ambiguous := switchOrchestrator(store, sys, &fakeHygiene{worktrees: []Worktree{
			{Dir: "/repo/worktrees/feat-a"},
			{Dir: "/repo/worktrees/feat-b"},
		}})

		t.Run("when it is given", func(t *testing.T) {
			_, err := ambiguous.ResolveSwitch("/repo", "feat")
			if err == nil {
				t.Fatal("an ambiguous prefix resolved; the shell would have cd'd somewhere arbitrary")
			}
			for _, want := range []string{"feat-a", "feat-b"} {
				if !strings.Contains(err.Error(), want) {
					t.Errorf("error %q does not name %q, so there is nothing to type instead", err, want)
				}
			}
			// Failing is not enough: an ambiguous prefix that falls through to the
			// no-match message tells the developer nothing matched when two did,
			// and the fix it implies — type more — is the opposite of the truth.
			if strings.Contains(err.Error(), "no worktree matches") {
				t.Errorf("error %q reports a miss, but two worktrees matched", err)
			}
		})
	})

	t.Run("given a name nothing matches", func(t *testing.T) {
		t.Run("when it is given", func(t *testing.T) {
			_, err := o.ResolveSwitch("/repo", "nope")
			if err == nil {
				t.Fatal("a name matching nothing resolved to a directory")
			}
			if !strings.Contains(err.Error(), "otel-haven") {
				t.Errorf("error %q does not list what there is to switch to", err)
			}
		})
	})

	t.Run("given no worktrees or stacks at all", func(t *testing.T) {
		empty := switchOrchestrator(&fakeStore{}, sys, &fakeHygiene{})

		t.Run("when a name is given", func(t *testing.T) {
			if _, err := empty.ResolveSwitch("/repo", "anything"); err == nil {
				t.Error("resolved against nothing")
			}
		})
	})
}

// A directory that is both a git worktree and a registered stack is one place,
// and switch offers it once — under the stack's slug, which is the name the
// developer sees everywhere else in haven.
//
// @scenario "Switching to a worktree without knowing its name"
func TestSwitchTargetsDeduplicateAndPreferRunningStacks(t *testing.T) {
	store := &fakeStore{stacks: []domain.Stack{
		{Slug: "otel-haven", WorktreeDir: "/repo/worktrees/otel-haven", LauncherPID: 7},
	}}
	sys := &fakeSystem{alive: map[int]bool{7: true}}
	hyg := &fakeHygiene{worktrees: []Worktree{
		{Dir: "/repo/worktrees/otel-haven"},
		{Dir: "/repo/worktrees/share-redesign"},
	}}

	t.Run("given a worktree that also has a registered stack", func(t *testing.T) {
		t.Run("when the targets are listed", func(t *testing.T) {
			targets := switchOrchestrator(store, sys, hyg).SwitchTargets("/repo")

			if len(targets) != 2 {
				t.Fatalf("targets = %+v, want the shared directory listed once", targets)
			}
			// Up first: completion offers the stack you are working in before the
			// ones you are not.
			if !targets[0].IsUp || targets[0].Name != "otel-haven" {
				t.Errorf("first target = %+v, want the running stack under its slug", targets[0])
			}
			if targets[1].Name != "share-redesign" || targets[1].IsUp {
				t.Errorf("second target = %+v, want the idle worktree under its directory name", targets[1])
			}
		})
	})
}
