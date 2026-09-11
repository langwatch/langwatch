package installtui

import (
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func key(s string) tea.KeyMsg {
	switch s {
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case " ":
		return tea.KeyMsg{Type: tea.KeySpace}
	case "right":
		return tea.KeyMsg{Type: tea.KeyRight}
	case "down":
		return tea.KeyMsg{Type: tea.KeyDown}
	default:
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
	}
}

func press(m model, keys ...string) model {
	for _, k := range keys {
		out, _ := m.Update(key(k))
		m = out.(model)
	}
	return m
}

// missingEverything is the fresh-machine report: nothing installed, so every
// entry is actionable and the picker has to make all of its choices.
func missingEverything() []domain.PrereqStatus {
	return domain.PlanPrereqs(map[string]domain.Found{}, nil, "darwin")
}

func rowFor(t *testing.T, m model, key string) row {
	t.Helper()
	for _, r := range m.rows {
		if r.st.Key == key {
			return r
		}
	}
	t.Fatalf("no %q row", key)
	return row{}
}

func cursorTo(t *testing.T, m model, key string) model {
	t.Helper()
	for i, r := range m.rows {
		if r.st.Key == key {
			m.cursor = i
			return m
		}
	}
	t.Fatalf("no %q row", key)
	return m
}

// What haven needs is pre-ticked; what is merely convenient is not. Pre-ticking
// a convenience is how a tool ends up installing things nobody asked for.
// @scenario "Installs run with the terminal to themselves"
func TestPreTicksWhatHavenNeedsAndNotTheConveniences(t *testing.T) {
	m := newModel(missingEverything())
	for _, key := range []string{"node", "pnpm", "portless", "postgres", "redis", "go"} {
		if !rowFor(t, m, key).ticked {
			t.Errorf("%s should start ticked — haven needs it", key)
		}
	}
	for _, key := range []string{"clickhouse-client", "runtime"} {
		if rowFor(t, m, key).ticked {
			t.Errorf("%s should start unticked — it is optional", key)
		}
	}
}

// @scenario "Installs run with the terminal to themselves"
func TestConfirmingReturnsTheTickedEntriesInInstallOrder(t *testing.T) {
	m := press(newModel(missingEverything()), "enter")
	res := m.result()
	if !res.Confirmed {
		t.Fatal("enter must confirm")
	}
	if len(res.Install) == 0 {
		t.Fatal("the pre-ticked entries must come back")
	}
	if res.Install[0].Key != "brew" {
		t.Errorf("first install = %q, want brew — the picker returns install order", res.Install[0].Key)
	}
	for _, c := range res.Install {
		if c.Key == "clickhouse-client" {
			t.Error("an unticked optional entry must not be installed")
		}
	}
}

// @scenario "Quitting the picker installs nothing"
func TestQuittingInstallsNothingAndRecordsNothing(t *testing.T) {
	m := press(newModel(missingEverything()), " ", "n", "esc")
	res := m.result()
	if res.Confirmed {
		t.Fatal("escape is not a confirmation")
	}
	if len(res.Install) != 0 || len(res.Never) != 0 {
		t.Errorf("quitting must decide nothing, got %v / %v", res.Install, res.Never)
	}
}

// @scenario "Declining with never is persisted"
func TestNeverMarksAnOptionalEntryAndUnticksIt(t *testing.T) {
	m := cursorTo(t, newModel(missingEverything()), "clickhouse-client")
	m = press(m, " ") // tick it first, so the two answers are in conflict
	m = press(m, "n")
	r := rowFor(t, m, "clickhouse-client")
	if !r.never || r.ticked {
		t.Errorf("never = %v, ticked = %v; the two answers contradict, so one must clear the other", r.never, r.ticked)
	}
	res := press(m, "enter").result()
	if len(res.Never) != 1 || res.Never[0] != "clickhouse-client" {
		t.Errorf("never = %v, want the one entry", res.Never)
	}
	for _, c := range res.Install {
		if c.Key == "clickhouse-client" {
			t.Error("an entry marked never must not also be installed")
		}
	}
}

// @scenario "Declining with never is persisted"
func TestNeverIsRefusedForARequiredEntry(t *testing.T) {
	m := cursorTo(t, newModel(missingEverything()), "portless")
	m = press(m, "n")
	if rowFor(t, m, "portless").never {
		t.Error("a required prerequisite must not be silenceable")
	}
	if !strings.Contains(m.note, "required") {
		t.Errorf("the refusal must say why, got %q", m.note)
	}
}

// @scenario "A missing runtime offers the alternatives as one pick"
func TestTheRuntimeChoiceCyclesAndTravelsWithTheResult(t *testing.T) {
	m := cursorTo(t, newModel(missingEverything()), "runtime")
	first := m.rows[m.cursor].st.Candidates[0].Key
	m = press(m, "right")
	second := m.rows[m.cursor].st.Candidates[m.rows[m.cursor].candidate].Key
	if first == second {
		t.Fatalf("←/→ must change the pick, still %q", second)
	}
	m = press(m, " ", "enter")
	for _, c := range m.result().Install {
		if c.Key == "runtime" {
			if c.Candidate != second {
				t.Errorf("chosen candidate = %q, want the one on screen (%q)", c.Candidate, second)
			}
			return
		}
	}
	t.Error("the ticked runtime must come back in the result")
}

// A satisfied entry is listed but not landed on: there is no key that does
// anything there, and a cursor that stops on one reads as the picker hanging.
// @scenario "Everything present reports ready and installs nothing"
func TestTheCursorSkipsEntriesThereIsNothingToDecideAbout(t *testing.T) {
	found := map[string]domain.Found{"brew": {Present: true}, "node": {Present: true}}
	m := newModel(domain.PlanPrereqs(found, nil, "darwin"))
	if m.rows[m.cursor].st.Key == "brew" || m.rows[m.cursor].st.Key == "node" {
		t.Errorf("the cursor starts on %q, which is already satisfied", m.rows[m.cursor].st.Key)
	}
	// Walking to the top must not land on them either.
	for i := 0; i < len(m.rows); i++ {
		m = press(m, "k")
		if !m.rows[m.cursor].actionable() {
			t.Fatalf("cursor landed on the non-actionable %q", m.rows[m.cursor].st.Key)
		}
	}
}

// @scenario "Everything present reports ready and installs nothing"
func TestAPickerIsNotShownWhenThereIsNothingToDecide(t *testing.T) {
	everything := map[string]domain.Found{}
	for _, p := range domain.Prereqs {
		everything[p.Candidates[0].Key] = domain.Found{Present: true}
	}
	m := newModel(domain.PlanPrereqs(everything, nil, "darwin"))
	if m.hasActionable() {
		t.Error("a machine with everything installed has nothing to pick")
	}
}

// The view is the whole point of the command, so it is worth pinning that it
// renders every entry and says what will happen on enter.
// @scenario "Installs run with the terminal to themselves"
func TestViewListsEveryEntryWithItsState(t *testing.T) {
	view := newModel(missingEverything()).View()
	for _, p := range domain.Prereqs {
		if !strings.Contains(view, p.Name) {
			t.Errorf("the view omits %q — the list is the same list every time", p.Name)
		}
	}
	for _, want := range []string{"not ready", "space tick", "never ask again", "enter install"} {
		if !strings.Contains(view, want) {
			t.Errorf("the view should mention %q", want)
		}
	}
}

// @scenario "Installs run with the terminal to themselves"
func TestBulkKeysTickAndUntickEverythingActionable(t *testing.T) {
	m := press(newModel(missingEverything()), "a")
	for _, r := range m.rows {
		if r.actionable() && !r.ticked {
			t.Errorf("a must tick %q too", r.st.Key)
		}
	}
	m = press(m, "d")
	for _, r := range m.rows {
		if r.ticked {
			t.Errorf("d must untick %q", r.st.Key)
		}
	}
	if len(press(m, "enter").result().Install) != 0 {
		t.Error("confirming with nothing ticked installs nothing")
	}
}
