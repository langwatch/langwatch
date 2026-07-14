package hubtui

import (
	"context"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func key(s string) tea.KeyMsg {
	switch s {
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "backspace":
		return tea.KeyMsg{Type: tea.KeyBackspace}
	default:
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
	}
}

// press runs one key through Update and executes any returned command so
// action callbacks fire, feeding their result message back like the runtime.
func press(t *testing.T, m model, s string) model {
	t.Helper()
	next, cmd := m.Update(key(s))
	out := next.(model)
	if cmd != nil {
		if msg := cmd(); msg != nil {
			if _, quitting := msg.(tea.QuitMsg); !quitting {
				n2, _ := out.Update(msg)
				out = n2.(model)
			}
		}
	}
	return out
}

func testActions(downed, destroyed *[]string) Actions {
	return Actions{
		Rows: func() []Row {
			return []Row{
				{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true},
				{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"},
			}
		},
		Down: func(_ context.Context, slug string) error {
			*downed = append(*downed, slug)
			return nil
		},
		Destroy: func(_ context.Context, dir string) error {
			*destroyed = append(*destroyed, dir)
			return nil
		},
	}
}

func TestHubModel(t *testing.T) {
	t.Run("given two stacks", func(t *testing.T) {
		t.Run("when enter is pressed on the second row, it opens that worktree's git view", func(t *testing.T) {
			var downed, destroyed []string
			m := newModel(context.Background(), testActions(&downed, &destroyed))
			m = press(t, m, "j")
			next, cmd := m.Update(key("enter"))
			m = next.(model)
			if m.openDir != "/wt/beta" {
				t.Errorf("openDir = %q, want /wt/beta", m.openDir)
			}
			if cmd == nil {
				t.Fatal("enter should quit the hub so the git view can take the terminal")
			}
		})

		t.Run("when d is confirmed with y, the selected stack is downed", func(t *testing.T) {
			var downed, destroyed []string
			m := newModel(context.Background(), testActions(&downed, &destroyed))
			m = press(t, m, "d")
			m = press(t, m, "y")
			if len(downed) != 1 || downed[0] != "alpha" {
				t.Errorf("downed = %v, want [alpha]", downed)
			}
			if len(destroyed) != 0 {
				t.Errorf("nothing should be destroyed, got %v", destroyed)
			}
		})

		t.Run("when d is answered with anything else, nothing happens", func(t *testing.T) {
			var downed, destroyed []string
			m := newModel(context.Background(), testActions(&downed, &destroyed))
			m = press(t, m, "d")
			m = press(t, m, "n")
			if len(downed) != 0 {
				t.Errorf("downed = %v, want none", downed)
			}
		})

		t.Run("when x is confirmed by typing the exact name, the worktree is destroyed", func(t *testing.T) {
			var downed, destroyed []string
			m := newModel(context.Background(), testActions(&downed, &destroyed))
			m = press(t, m, "x")
			for _, ch := range "alpha" {
				m = press(t, m, string(ch))
			}
			m = press(t, m, "enter")
			if len(destroyed) != 1 || destroyed[0] != "/wt/alpha" {
				t.Errorf("destroyed = %v, want [/wt/alpha]", destroyed)
			}
		})

		t.Run("when x is confirmed with the wrong name, nothing is destroyed", func(t *testing.T) {
			var downed, destroyed []string
			m := newModel(context.Background(), testActions(&downed, &destroyed))
			m = press(t, m, "x")
			for _, ch := range "beta" {
				m = press(t, m, string(ch))
			}
			m = press(t, m, "enter")
			if len(destroyed) != 0 {
				t.Errorf("destroyed = %v, want none", destroyed)
			}
			if !strings.Contains(m.View(), "did not match") {
				t.Error("the user should be told the name did not match")
			}
		})

		t.Run("when x is cancelled with esc, nothing is destroyed", func(t *testing.T) {
			var downed, destroyed []string
			m := newModel(context.Background(), testActions(&downed, &destroyed))
			m = press(t, m, "x")
			m = press(t, m, "esc")
			m = press(t, m, "enter") // enter back in browse mode opens git, not destroy
			if len(destroyed) != 0 {
				t.Errorf("destroyed = %v, want none", destroyed)
			}
		})
	})

	t.Run("given no stacks", func(t *testing.T) {
		empty := Actions{Rows: func() []Row { return nil }}

		t.Run("when rendered, it explains how to start one", func(t *testing.T) {
			m := newModel(context.Background(), empty)
			if !strings.Contains(m.View(), "pnpm dev:haven") {
				t.Error("empty hub should say how to start a stack")
			}
		})

		t.Run("when action keys are pressed, nothing panics and nothing runs", func(t *testing.T) {
			m := newModel(context.Background(), empty)
			for _, k := range []string{"enter", "g", "d", "x", "j", "k"} {
				m = press(t, m, k)
			}
			if m.openDir != "" {
				t.Errorf("openDir = %q, want empty", m.openDir)
			}
		})
	})
}
