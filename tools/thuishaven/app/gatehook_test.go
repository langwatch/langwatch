package app

import (
	"os"
	"strings"
	"testing"
)

type hookSettingsRecorder struct {
	roots     []string
	commands  []string
	offRoots  []string
	offResult bool
	offErr    error
}

func (r *hookSettingsRecorder) EnsureHook(root, command string) (bool, error) {
	r.roots = append(r.roots, root)
	r.commands = append(r.commands, command)
	return true, nil
}

func (r *hookSettingsRecorder) Off(root string) (bool, error) {
	r.offRoots = append(r.offRoots, root)
	return r.offResult, r.offErr
}

func TestGateSetupSelectsOnlyTheRequestedAgent(t *testing.T) {
	claude := &hookSettingsRecorder{}
	codex := &hookSettingsRecorder{}
	root := t.TempDir()
	o := New(Deps{Cfg: Config{RepoRoot: root}, Claude: claude, Codex: codex})
	if _, err := o.InstallFeature("codex-gate-hook"); err != nil {
		t.Fatal(err)
	}
	if len(claude.commands) != 0 || len(codex.commands) != 1 || codex.roots[0] != root || !strings.HasSuffix(codex.commands[0], " gate --client codex") {
		t.Fatalf("wrong writer selected: claude=%+v codex=%+v", claude, codex)
	}
	if _, err := o.InstallFeature("gate-hook"); err != nil {
		t.Fatal(err)
	}
	if len(claude.commands) != 1 || len(codex.commands) != 1 || claude.commands[0] != strings.TrimSuffix(codex.commands[0], " --client codex") {
		t.Fatalf("agent clients did not receive the same gate: claude=%+v codex=%+v", claude, codex)
	}
}

func TestGateSetupRequiresAWriterAndRepository(t *testing.T) {
	for _, cfg := range []Deps{{}, {Cfg: Config{RepoRoot: t.TempDir()}}} {
		changed, err := New(cfg).InstallFeature("codex-gate-hook")
		if err == nil || changed {
			t.Fatalf("incomplete setup accepted: changed=%v err=%v", changed, err)
		}
	}
}

// @scenario "haven up registers the Claude gate in the worktree it starts"
func TestUpRegistersTheGateHookAutomatically(t *testing.T) {
	t.Run("given a worktree with no gate registered", func(t *testing.T) {
		claude := &hookSettingsRecorder{}
		worktree := t.TempDir()
		o := New(Deps{Cfg: Config{RepoRoot: worktree}, Claude: claude})

		t.Run("when the developer runs haven up", func(t *testing.T) {
			o.EnsureGateHookForUp(worktree)

			t.Run("the gate is registered in that worktree's Claude settings, the same way haven setup gate-hook would", func(t *testing.T) {
				if len(claude.roots) != 1 || claude.roots[0] != worktree || !strings.HasSuffix(claude.commands[0], " gate") {
					t.Fatalf("expected a registration in the started worktree, got roots=%+v commands=%+v", claude.roots, claude.commands)
				}
				if _, err := o.InstallFeature("gate-hook"); err != nil {
					t.Fatal(err)
				}
				if claude.commands[0] != claude.commands[1] {
					t.Fatalf("haven up and haven setup gate-hook must write the identical command: %+v", claude.commands)
				}
			})

			t.Run("and a later haven up calls EnsureHook again rather than skipping it", func(t *testing.T) {
				// EnsureHook's own idempotency (adapters/claudesettings) is what
				// keeps this a no-op on disk; haven up must still ask every time,
				// since that is the only way a worktree opted back in ever gets
				// caught up again.
				before := len(claude.commands)
				o.EnsureGateHookForUp(worktree)
				if len(claude.commands) != before+1 {
					t.Fatalf("expected haven up to call EnsureHook again, got %d calls", len(claude.commands))
				}
			})
		})
	})

	t.Run("given a worktree opted out with haven setup gate-hook --off", func(t *testing.T) {
		claude := &hookSettingsRecorder{offResult: true}
		worktree := t.TempDir()
		o := New(Deps{Cfg: Config{RepoRoot: worktree}, Claude: claude})

		t.Run("when haven setup gate-hook --off runs", func(t *testing.T) {
			turnedOff, err := o.OptOutFeature("gate-hook")

			t.Run("it removes the registration through the same writer haven up uses", func(t *testing.T) {
				if err != nil || !turnedOff || len(claude.offRoots) != 1 || claude.offRoots[0] != worktree {
					t.Fatalf("expected Off(%q), got turnedOff=%v err=%v offRoots=%+v", worktree, turnedOff, err, claude.offRoots)
				}
			})
		})

		// From here on, whether a later haven up leaves the worktree alone is
		// EnsureHook's own contract (adapters/hooksettings honors the opt-out
		// marker Off writes) - proven at that layer in
		// adapters/claudesettings/settings_test.go, where the same writer both
		// features and haven up share is exercised end to end without a Go test
		// binary's own path standing in for haven's.
	})
}

// @scenario "haven up registers the Claude gate in the worktree it starts"
func TestEnsureGateHookForUpIsBestEffort(t *testing.T) {
	t.Run("given no Claude settings writer is wired in", func(t *testing.T) {
		o := New(Deps{Cfg: Config{RepoRoot: t.TempDir()}})

		t.Run("when haven up starts a worktree", func(t *testing.T) {
			t.Run("it does not panic or block the stack from starting", func(t *testing.T) {
				o.EnsureGateHookForUp(t.TempDir())
			})
		})
	})

	t.Run("given the writer fails", func(t *testing.T) {
		failing := &failingHookSettings{}
		o := New(Deps{Cfg: Config{RepoRoot: t.TempDir()}, Claude: failing})

		t.Run("when haven up starts a worktree", func(t *testing.T) {
			t.Run("the failure is swallowed rather than failing up", func(t *testing.T) {
				o.EnsureGateHookForUp(t.TempDir())
				if !failing.called {
					t.Fatal("expected the writer to have been asked")
				}
			})
		})
	})
}

// failingHookSettings always refuses, so EnsureGateHookForUp's best-effort
// contract can be exercised without a real write failure.
type failingHookSettings struct{ called bool }

func (f *failingHookSettings) EnsureHook(string, string) (bool, error) {
	f.called = true
	return false, os.ErrPermission
}

func (f *failingHookSettings) Off(string) (bool, error) { return false, os.ErrPermission }
