package prunetui

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

const day = 24 * time.Hour

func key(s string) tea.KeyMsg {
	switch s {
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "space":
		return tea.KeyMsg{Type: tea.KeySpace}
	case "backspace":
		return tea.KeyMsg{Type: tea.KeyBackspace}
	default:
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
	}
}

func update(m model, msg tea.Msg) model {
	next, _ := m.Update(msg)
	return next.(model)
}

// drain runs a command and every command its result message produces, so a
// sequential delete queue runs to completion the way the bubbletea runtime would.
func drain(m model, cmd tea.Cmd) model {
	for cmd != nil {
		msg := cmd()
		if msg == nil {
			return m
		}
		if _, quit := msg.(tea.QuitMsg); quit {
			return m
		}
		var next tea.Model
		next, cmd = m.Update(msg)
		m = next.(model)
	}
	return m
}

func typeWord(m model, word string) model {
	for _, ch := range word {
		m = update(m, key(string(ch)))
	}
	return m
}

func testActions(deleted *[]string) Actions {
	return Actions{
		Rows: []Row{
			{Dir: "/wt/a", Slug: "a", Deletable: true},
			{Dir: "/wt/b", Slug: "b", Deletable: true},
			{Dir: "/wt/primary", Slug: "main", IsPrimary: true},
		},
		Threshold: 5 * day,
		DeleteAll: func(_ context.Context, dirs []string, onDone func(string, error)) {
			for _, dir := range dirs {
				*deleted = append(*deleted, dir)
				onDone(dir, nil)
			}
		},
		SharedNote: "shared servers are never removed",
	}
}

func staleMeta() MetaResult { return MetaResult{StaleFor: 6 * day, StaleKnown: true} }
func freshMeta() MetaResult { return MetaResult{StaleFor: 1 * day, StaleKnown: true} }

// @scenario "Worktrees idle for five days or more are pre-selected"
// @scenario "A recently-touched worktree is left unselected"
func TestPruneModelPreselect(t *testing.T) {
	t.Run("given rows whose meta lands before their size", func(t *testing.T) {
		t.Run("when a stale, safe worktree's meta lands, it is pre-selected", func(t *testing.T) {
			var deleted []string
			m := newModel(context.Background(), testActions(&deleted))
			m = update(m, metaDoneMsg{index: 0, meta: staleMeta()})
			if !m.selected["/wt/a"] {
				t.Error("a stale, safe worktree should be pre-selected from its meta alone")
			}
		})

		t.Run("when a recently-touched worktree's meta lands, it is left unselected", func(t *testing.T) {
			var deleted []string
			m := newModel(context.Background(), testActions(&deleted))
			m = update(m, metaDoneMsg{index: 1, meta: freshMeta()})
			if m.selected["/wt/b"] {
				t.Error("a fresh worktree should not be pre-selected")
			}
		})

		t.Run("when a live worktree's meta lands, it is left unselected", func(t *testing.T) {
			var deleted []string
			acts := testActions(&deleted)
			acts.Rows[0].IsLive = true
			m := newModel(context.Background(), acts)
			m = update(m, metaDoneMsg{index: 0, meta: staleMeta()})
			if m.selected["/wt/a"] {
				t.Error("a live worktree must never be pre-selected")
			}
		})

		t.Run("when a dirty worktree's meta lands, it is left unselected", func(t *testing.T) {
			var deleted []string
			m := newModel(context.Background(), testActions(&deleted))
			dirty := staleMeta()
			dirty.IsDirty = true
			m = update(m, metaDoneMsg{index: 0, meta: dirty})
			if m.selected["/wt/a"] {
				t.Error("a dirty worktree must never be pre-selected")
			}
		})

		t.Run("when a protected worktree's meta lands, it is left unselected", func(t *testing.T) {
			var deleted []string
			m := newModel(context.Background(), testActions(&deleted))
			m = update(m, metaDoneMsg{index: 2, meta: staleMeta()})
			if m.selected["/wt/primary"] {
				t.Error("the primary checkout must never be selected")
			}
		})
	})
}

// @scenario "A live or dirty worktree is never pre-selected"
func TestPruneModelManualToggleWins(t *testing.T) {
	t.Run("given a worktree the user deselected by hand", func(t *testing.T) {
		t.Run("when a later stale meta lands, it is not re-selected", func(t *testing.T) {
			var deleted []string
			m := newModel(context.Background(), testActions(&deleted))
			m = update(m, metaDoneMsg{index: 0, meta: staleMeta()}) // auto-selected
			m = update(m, key("space"))                             // user deselects row 0
			if m.selected["/wt/a"] {
				t.Fatal("space should have deselected the pre-ticked row")
			}
			m = update(m, metaDoneMsg{index: 0, meta: staleMeta()}) // a re-scan
			if m.selected["/wt/a"] {
				t.Error("a hand-toggled row must not be re-selected by a later scan")
			}
		})
	})

	t.Run("given a protected worktree", func(t *testing.T) {
		t.Run("when the user presses space on it, nothing is selected", func(t *testing.T) {
			var deleted []string
			m := newModel(context.Background(), testActions(&deleted))
			m = update(m, key("j")) // -> row 1
			m = update(m, key("j")) // -> row 2 (primary, protected)
			m = update(m, key("space"))
			if m.selected["/wt/primary"] {
				t.Error("a protected worktree cannot be ticked")
			}
		})
	})
}

// @scenario "Deleting the ticked worktrees"
func TestPruneModelConfirmAndDelete(t *testing.T) {
	t.Run("given two worktrees ticked for deletion, sized 1000 each", func(t *testing.T) {
		selectBoth := func(deleted *[]string) model {
			m := newModel(context.Background(), testActions(deleted))
			m = update(m, metaDoneMsg{index: 0, meta: staleMeta()})
			m = update(m, metaDoneMsg{index: 1, meta: staleMeta()})
			m = update(m, sizeDoneMsg{index: 0, bytes: 1000})
			m = update(m, sizeDoneMsg{index: 1, bytes: 1000})
			return m
		}

		t.Run("when confirmed by typing the word, each is deleted and the total is reported", func(t *testing.T) {
			var deleted []string
			m := selectBoth(&deleted)
			if m.countSelected() != 2 {
				t.Fatalf("expected 2 selected, got %d", m.countSelected())
			}
			m = update(m, key("enter")) // browse -> confirm
			if m.mode != modeConfirm {
				t.Fatalf("enter with a selection should open the confirm prompt, mode=%v", m.mode)
			}
			m = typeWord(m, confirmWord)
			next, cmd := m.Update(key("enter")) // confirm -> start deleting
			m = drain(next.(model), cmd)
			if len(deleted) != 2 {
				t.Fatalf("both worktrees should be deleted, got %v", deleted)
			}
			if m.mode != modeDone || m.deletedOK != 2 {
				t.Errorf("expected done with 2 deleted, mode=%v ok=%d", m.mode, m.deletedOK)
			}
			if m.reclaimed != 2000 {
				t.Errorf("reclaimed should sum both disks (2000), got %d", m.reclaimed)
			}
		})

		t.Run("when the wrong word is typed, nothing is deleted", func(t *testing.T) {
			var deleted []string
			m := selectBoth(&deleted)
			m = update(m, key("enter"))
			m = typeWord(m, "nope")
			m = update(m, key("enter"))
			if len(deleted) != 0 {
				t.Errorf("a wrong confirmation must delete nothing, got %v", deleted)
			}
			if m.mode != modeBrowse {
				t.Errorf("a wrong confirmation should return to browse, mode=%v", m.mode)
			}
		})

		t.Run("when the confirm is cancelled with esc, nothing is deleted", func(t *testing.T) {
			var deleted []string
			m := selectBoth(&deleted)
			m = update(m, key("enter"))
			m = update(m, key("esc"))
			if m.mode != modeBrowse || len(deleted) != 0 {
				t.Errorf("esc should cancel with nothing deleted, mode=%v deleted=%v", m.mode, deleted)
			}
		})
	})
}

func TestPruneModelNothingSelected(t *testing.T) {
	t.Run("given no worktree is ticked", func(t *testing.T) {
		t.Run("when enter is pressed, the confirm prompt does not open", func(t *testing.T) {
			var deleted []string
			m := newModel(context.Background(), testActions(&deleted))
			m = update(m, metaDoneMsg{index: 1, meta: freshMeta()}) // nothing auto-ticked
			m = update(m, key("enter"))
			if m.mode != modeBrowse {
				t.Errorf("enter with no selection should stay in browse, mode=%v", m.mode)
			}
		})
	})

	t.Run("given only protected worktrees", func(t *testing.T) {
		t.Run("when rendered, the footer says there is nothing to prune", func(t *testing.T) {
			m := newModel(context.Background(), Actions{
				Rows: []Row{{Dir: "/wt/primary", Slug: "main", IsPrimary: true}},
			})
			if !strings.Contains(m.View(), "no other worktrees") {
				t.Error("a fleet of only-protected worktrees should say there is nothing to prune")
			}
		})
	})
}

// The reported complaint: with many worktrees the list must never push the header
// off the top — it has to window and scroll within the terminal height.
//
// @scenario "The list never overflows the terminal"
func TestPruneViewportNeverOverflows(t *testing.T) {
	rows := make([]Row, 50)
	for i := range rows {
		// zero-padded so the default name-order tiebreak is also numeric
		rows[i] = Row{Dir: fmt.Sprintf("/wt/wt-%02d", i), Slug: fmt.Sprintf("wt-%02d", i), Deletable: true}
	}
	m := newModel(context.Background(), Actions{Rows: rows, Threshold: 5 * day, SharedNote: "shared note"})
	m = update(m, tea.WindowSizeMsg{Width: 80, Height: 20})

	t.Run("given 50 worktrees in a 20-row terminal", func(t *testing.T) {
		t.Run("when rendered at the top, the view fits the height", func(t *testing.T) {
			if got := countLines(m.View()); got > 20 {
				t.Errorf("view is %d lines, exceeds the 20-row terminal", got)
			}
		})

		t.Run("when scrolled to the bottom, it still fits and shows the cursor row", func(t *testing.T) {
			for range 49 {
				m = update(m, key("j"))
			}
			if m.cursor != 49 {
				t.Fatalf("cursor = %d, want 49", m.cursor)
			}
			v := m.View()
			if got := countLines(v); got > 20 {
				t.Errorf("view overflows after scrolling: %d lines", got)
			}
			last, _ := m.selectedRow()
			if !strings.Contains(v, last.Slug) {
				t.Errorf("the cursor row (%s) should be visible after scrolling to the bottom", last.Slug)
			}
			if !strings.Contains(v, "of 50") {
				t.Error("a scroll indicator should show which slice of the list is visible")
			}
		})

		t.Run("when very wide rows meet a narrow terminal, no line exceeds the width", func(t *testing.T) {
			m = update(m, tea.WindowSizeMsg{Width: 40, Height: 20})
			for _, ln := range strings.Split(m.View(), "\n") {
				if lipgloss.Width(ln) > 40 {
					t.Errorf("line %q is %d cells wide, exceeds 40", ln, lipgloss.Width(ln))
				}
			}
		})
	})
}

// @scenario "The list can be re-sorted"
func TestPruneSort(t *testing.T) {
	rows := []Row{
		{Dir: "/wt/big-fresh", Slug: "big-fresh", Deletable: true, MetaKnown: true, StaleKnown: true, StaleFor: 1 * day, SizeKnown: true, DiskBytes: 9000},
		{Dir: "/wt/small-stale", Slug: "small-stale", Deletable: true, MetaKnown: true, StaleKnown: true, StaleFor: 30 * day, SizeKnown: true, DiskBytes: 100},
		{Dir: "/wt/gone-one", Slug: "gone-one", Deletable: true, MetaKnown: true, StaleKnown: true, StaleFor: 5 * day, SizeKnown: true, DiskBytes: 500, OriginGone: true},
		{Dir: "/wt/primary", Slug: "main", IsPrimary: true},
	}
	top := func(m model) string { return m.rows[m.order[0]].Slug }

	t.Run("given a mix of worktrees", func(t *testing.T) {
		m := newModel(context.Background(), Actions{Rows: rows, Threshold: 5 * day})

		t.Run("when sorted by most idle, the stalest is on top", func(t *testing.T) {
			// default is sortStale
			if got := top(m); got != "small-stale" {
				t.Errorf("stale sort top = %q, want small-stale", got)
			}
		})
		t.Run("when sorted by size, the largest is on top", func(t *testing.T) {
			m = update(m, key("s")) // stale -> size
			if got := top(m); got != "big-fresh" {
				t.Errorf("size sort top = %q, want big-fresh", got)
			}
		})
		t.Run("when cycled to origin-gone, the merged-and-deleted one is on top", func(t *testing.T) {
			m = update(m, key("s")) // size -> name
			m = update(m, key("s")) // name -> uncommitted
			m = update(m, key("s")) // uncommitted -> origin-gone
			if got := top(m); got != "gone-one" {
				t.Errorf("origin-gone sort top = %q, want gone-one", got)
			}
		})
		t.Run("the protected worktree is always last regardless of sort", func(t *testing.T) {
			last := m.rows[m.order[len(m.order)-1]].Slug
			if last != "main" {
				t.Errorf("protected worktree should sort last, got %q", last)
			}
		})
	})
}
