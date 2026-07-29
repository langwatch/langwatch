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
	case "ctrl+c":
		return tea.KeyMsg{Type: tea.KeyCtrlC}
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
			if _, isQuitting := msg.(tea.QuitMsg); !isQuitting {
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

// mutableActions reads rows through a caller-owned slice pointer so a test can
// reorder or shrink the row set between keypresses, mimicking a refresh tick.
func mutableActions(rows *[]Row, downed, destroyed *[]string) Actions {
	return Actions{
		Rows: func() []Row { return *rows },
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

// @scenario "Jumping into a stack's git view from the hub"
// @scenario "Destruction requires typing the name"
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
			if !strings.Contains(m.View(), "haven up") {
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

func TestHubConfirmationFreezesSelectedRow(t *testing.T) {
	t.Run("given a down prompt open for the top stack", func(t *testing.T) {
		t.Run("when a refresh reorders the rows before y is pressed, the originally-selected stack is downed", func(t *testing.T) {
			rows := []Row{
				{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true},
				{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"},
			}
			var downed, destroyed []string
			m := newModel(context.Background(), mutableActions(&rows, &downed, &destroyed))
			m = press(t, m, "d") // confirm-down for alpha (cursor 0)
			// a refresh reorders rows so the cursor now points at beta
			rows = []Row{
				{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"},
				{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true},
			}
			next, _ := m.Update(tickMsg{})
			m = next.(model)
			m = press(t, m, "y")
			if len(downed) != 1 || downed[0] != "alpha" {
				t.Errorf("downed = %v, want [alpha] (the stack the prompt was shown for)", downed)
			}
		})

		t.Run("when the selected stack disappears before y is pressed, nothing is downed", func(t *testing.T) {
			rows := []Row{
				{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true},
				{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"},
			}
			var downed, destroyed []string
			m := newModel(context.Background(), mutableActions(&rows, &downed, &destroyed))
			m = press(t, m, "d")
			rows = []Row{{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"}}
			next, _ := m.Update(tickMsg{})
			m = next.(model)
			m = press(t, m, "y")
			if len(downed) != 0 {
				t.Errorf("downed = %v, want none — the stack vanished before confirm", downed)
			}
			if !strings.Contains(m.View(), "stack changed") {
				t.Error("the user should be told the stack changed")
			}
		})
	})

	t.Run("given a destroy prompt open for the top stack", func(t *testing.T) {
		t.Run("when a refresh reorders the rows before the name is confirmed, the originally-selected worktree is destroyed", func(t *testing.T) {
			rows := []Row{
				{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true},
				{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"},
			}
			var downed, destroyed []string
			m := newModel(context.Background(), mutableActions(&rows, &downed, &destroyed))
			m = press(t, m, "x") // confirm-destroy for alpha (cursor 0)
			// a refresh reorders rows so the cursor now points at beta
			rows = []Row{
				{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"},
				{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true},
			}
			next, _ := m.Update(tickMsg{})
			m = next.(model)
			for _, ch := range "alpha" { // the name shown when the prompt opened
				m = press(t, m, string(ch))
			}
			m = press(t, m, "enter")
			if len(destroyed) != 1 || destroyed[0] != "/wt/alpha" {
				t.Errorf("destroyed = %v, want [/wt/alpha] (the stack the prompt was shown for)", destroyed)
			}
		})
	})
}

func TestHubBusyGate(t *testing.T) {
	t.Run("given a down action is in flight", func(t *testing.T) {
		// setup opens a down prompt and confirms it WITHOUT executing the returned
		// command, so the action stays in flight and busy remains set.
		setup := func(t *testing.T) (model, *[]string) {
			t.Helper()
			rows := []Row{
				{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true},
				{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"},
			}
			var downed, destroyed []string
			m := newModel(context.Background(), mutableActions(&rows, &downed, &destroyed))
			m = press(t, m, "d")
			next, cmd := m.Update(key("y"))
			m = next.(model)
			if !m.busy {
				t.Fatal("model should be busy after confirming an action")
			}
			if cmd == nil {
				t.Fatal("confirming should return the action command")
			}
			return m, &downed
		}

		t.Run("when other keys are pressed, they are swallowed and no further action runs", func(t *testing.T) {
			m, downed := setup(t)
			before := m.cursor
			for _, k := range []string{"j", "k", "d", "x", "enter"} {
				next, cmd := m.Update(key(k))
				m = next.(model)
				if cmd != nil {
					t.Errorf("key %q should be swallowed while busy, got a command", k)
				}
			}
			if m.cursor != before {
				t.Errorf("cursor moved while busy: %d -> %d", before, m.cursor)
			}
			if m.mode != modeBrowse {
				t.Errorf("mode changed while busy: %v", m.mode)
			}
			if len(*downed) != 0 {
				t.Errorf("no callback should fire from swallowed keys, got downed=%v", *downed)
			}
		})

		t.Run("when q is pressed, the quit drains: no immediate exit, but the hub exits once the action completes", func(t *testing.T) {
			m, _ := setup(t)
			next, cmd := m.Update(key("q"))
			m = next.(model)
			if cmd != nil {
				t.Fatal("q while busy must not quit immediately — the in-flight action would be abandoned half-way")
			}
			if !m.isQuitting {
				t.Fatal("q while busy should arm the drain")
			}
			next, cmd = m.Update(actionDoneMsg{verb: "down", slug: "alpha"})
			m = next.(model)
			if cmd == nil {
				t.Fatal("the armed drain should quit once the action completes")
			}
			if _, ok := cmd().(tea.QuitMsg); !ok {
				t.Error("action completion with a drain armed should return tea.Quit")
			}
		})

		t.Run("when ctrl+c is pressed twice, the second force-quits a hung action", func(t *testing.T) {
			m, _ := setup(t)
			next, cmd := m.Update(key("ctrl+c"))
			m = next.(model)
			if cmd != nil {
				t.Fatal("first ctrl+c while busy should only arm the drain")
			}
			_, cmd = m.Update(key("ctrl+c"))
			if cmd == nil {
				t.Fatal("second ctrl+c should force-quit")
			}
			if _, ok := cmd().(tea.QuitMsg); !ok {
				t.Error("second ctrl+c while busy should return tea.Quit")
			}
		})
	})
}

func TestHubTickRefresh(t *testing.T) {
	t.Run("given the cursor is on the last of two stacks", func(t *testing.T) {
		t.Run("when a refresh tick drops a stack, the cursor clamps and View does not panic", func(t *testing.T) {
			rows := []Row{
				{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true},
				{Slug: "beta", Dir: "/wt/beta", Branch: "feat/b"},
			}
			var downed, destroyed []string
			m := newModel(context.Background(), mutableActions(&rows, &downed, &destroyed))
			m = press(t, m, "j") // cursor -> 1 (beta, last row)
			if m.cursor != 1 {
				t.Fatalf("cursor = %d, want 1", m.cursor)
			}
			rows = []Row{{Slug: "alpha", Dir: "/wt/alpha", Branch: "feat/a", IsLive: true}}
			next, _ := m.Update(tickMsg{})
			m = next.(model)
			if len(m.rows) != 1 {
				t.Errorf("rows = %d, want 1 after refresh", len(m.rows))
			}
			if m.cursor != 0 {
				t.Errorf("cursor = %d, want clamped to 0", m.cursor)
			}
			_ = m.View() // must not panic with the shrunk row set
		})
	})
}
