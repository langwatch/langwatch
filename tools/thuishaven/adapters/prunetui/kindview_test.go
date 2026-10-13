package prunetui

import (
	"context"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// jobActions is a picker over agent job scratch: one kind, rows that arrive
// already classified, and their own pre-ticks — the shape cmd builds.
func jobActions(rows []Row) Actions {
	return Actions{
		Kind:        domain.JobScratchKind,
		ConfirmNote: "each job keeps its record and loses its scratch.",
		Rows:        rows,
		DeleteAll: func(_ context.Context, dirs []string, onDone func(string, error)) {
			for _, dir := range dirs {
				onDone(dir, nil)
			}
		},
	}
}

func jobRows() []Row {
	return []Row{
		{
			Dir: "/jobs/oldest", Branch: "lane oldest", Kind: KindJob, Deletable: true, Preselect: true,
			MetaKnown: true, RedisDB: -1, StaleKnown: true, StaleFor: 20 * day, SizeKnown: true, DiskBytes: 3000,
			Reason: "untouched 20d",
		},
		{
			Dir: "/jobs/newest", Branch: "lane newest", Kind: KindJob, Deletable: true, Preselect: true,
			MetaKnown: true, RedisDB: -1, StaleKnown: true, StaleFor: 3 * day, SizeKnown: true, DiskBytes: 1000,
			Reason: "finished (done)",
		},
		{
			Dir: "/jobs/middle", Branch: "lane middle", Kind: KindJob, Deletable: true, Preselect: true,
			MetaKnown: true, RedisDB: -1, StaleKnown: true, StaleFor: 9 * day, SizeKnown: true, DiskBytes: 2000,
			Reason: "untouched 9d",
		},
	}
}

// @scenario "Progress names the kind it is actually reclaiming"
func TestProgressNamesTheKindItReclaims(t *testing.T) {
	t.Run("given a picker reclaiming agent job scratch", func(t *testing.T) {
		m := newModel(context.Background(), jobActions(jobRows()))
		m = update(m, tea.WindowSizeMsg{Width: 100, Height: 30})
		m = update(m, key("enter"))
		m = typeWord(m, confirmWord)

		t.Run("when the reclaim is underway, the headline counts job scratch", func(t *testing.T) {
			next, _ := m.Update(key("enter")) // -> deleting; drop the listen cmd so it stays there
			v := next.(model).View()
			if !strings.Contains(v, "3 job scratch dirs") {
				t.Errorf("the progress line must count job scratch dirs, got:\n%s", v)
			}
			if strings.Contains(v, "worktree") {
				t.Errorf("the progress line must not call job scratch a worktree, got:\n%s", v)
			}
		})

		t.Run("when it finishes, the tally counts job scratch too", func(t *testing.T) {
			next, cmd := m.Update(key("enter"))
			done := drain(next.(model), cmd)
			v := done.View()
			if !strings.Contains(v, "3 job scratch dirs") {
				t.Errorf("the finished line must count job scratch dirs, got:\n%s", v)
			}
			if strings.Contains(v, "worktree") {
				t.Errorf("the finished line must not say worktree, got:\n%s", v)
			}
		})
	})
}

// @scenario "The confirmation shows the count, the size and the newest of what is ticked"
func TestConfirmationSummarisesWhatWillGo(t *testing.T) {
	t.Run("given three ticked job rows of differing ages", func(t *testing.T) {
		m := newModel(context.Background(), jobActions(jobRows()))
		m = update(m, tea.WindowSizeMsg{Width: 100, Height: 30})

		t.Run("when the confirmation screen is shown", func(t *testing.T) {
			m = update(m, key("enter"))
			if m.mode != modeConfirm {
				t.Fatalf("enter with a selection opens the confirmation, mode=%v", m.mode)
			}
			v := m.View()

			if !strings.Contains(v, "3 job scratch dirs") {
				t.Errorf("the confirmation must count the kind, got:\n%s", v)
			}
			if !strings.Contains(v, domain.HumanBytes(6000)) {
				t.Errorf("the confirmation must total the size that will be freed, got:\n%s", v)
			}
			if !strings.Contains(v, "lane newest") {
				t.Errorf("the newest ticked row must be named where it is read, got:\n%s", v)
			}
			if !strings.Contains(v, confirmWord) {
				t.Errorf("the confirmation must still ask for the typed word, got:\n%s", v)
			}
			if strings.Contains(v, "space toggle") {
				t.Errorf("the browse list must be gone on the confirmation screen, got:\n%s", v)
			}
		})

		t.Run("the preview is ordered newest first, whatever the list sort", func(t *testing.T) {
			names := []string{}
			for _, r := range m.newestSelected(3) {
				names = append(names, displayName(r))
			}
			want := []string{"lane newest", "lane middle", "lane oldest"}
			if strings.Join(names, ",") != strings.Join(want, ",") {
				t.Errorf("preview order = %v, want %v", names, want)
			}
		})
	})
}

// A row whose classification is complete on arrival carries its own pre-tick;
// nothing else in the picker ticks it, because no meta scan will ever land for it.
func TestRowsThatArriveClassifiedCarryTheirOwnPreTick(t *testing.T) {
	rows := jobRows()
	rows[1].Preselect = false
	m := newModel(context.Background(), jobActions(rows))
	if !m.selected["/jobs/oldest"] {
		t.Error("a pre-ticked row must be selected the moment the picker opens")
	}
	if m.selected["/jobs/newest"] {
		t.Error("a row the composition root did not pre-tick must stay unticked")
	}
}
