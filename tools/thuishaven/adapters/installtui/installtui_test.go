package installtui

import (
	"regexp"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

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

// The list is the decisions, and only those. Everything already installed
// used to be a row of its own, so a machine one thing short of ready showed
// nine rows to ask one question — and the satisfied majority dominated a
// screen whose whole purpose was the minority.
// @scenario "The picker lists what needs deciding, not the whole inventory"
func TestTheListHoldsOnlyTheThingsThatNeedAnswering(t *testing.T) {
	found := map[string]domain.Found{"brew": {Present: true}, "node": {Present: true}}
	m := newModel(domain.PlanPrereqs(found, nil, "darwin"))
	for _, r := range m.rows {
		if !r.st.State.Actionable() {
			t.Errorf("%q is on the list with nothing to decide about it", r.st.Key)
		}
		if r.st.Key == "brew" || r.st.Key == "node" {
			t.Errorf("%q is installed — it belongs in the line underneath, not the list", r.st.Key)
		}
	}
	// …and they are still named, so their absence is never a question.
	if len(m.installed) != 2 {
		t.Errorf("installed = %v, want the two that are there", m.installed)
	}
	view := m.View()
	for _, name := range []string{"Homebrew", "Node.js"} {
		if !strings.Contains(view, name) {
			t.Errorf("the view should still name %q as already here", name)
		}
	}
	if !strings.Contains(view, "already here") {
		t.Errorf("the view should say what it is not asking about, got:\n%s", view)
	}
}

// Every row is missing — that is what puts it on the screen — so the cursor
// can move freely and needs no skipping rule.
// @scenario "The picker lists what needs deciding, not the whole inventory"
func TestTheCursorMovesFreelyAcrossTheList(t *testing.T) {
	m := newModel(missingEverything())
	for range m.rows {
		m = press(m, "j")
	}
	if m.cursor != len(m.rows)-1 {
		t.Errorf("cursor = %d, want it to stop at the last row (%d)", m.cursor, len(m.rows)-1)
	}
	for range m.rows {
		m = press(m, "k")
	}
	if m.cursor != 0 {
		t.Errorf("cursor = %d, want it back at the top", m.cursor)
	}
}

// @scenario "Everything present reports ready and installs nothing"
func TestAPickerIsNotShownWhenThereIsNothingToDecide(t *testing.T) {
	everything := map[string]domain.Found{}
	for _, p := range domain.Prereqs {
		everything[p.Candidates[0].Key] = domain.Found{Present: true}
	}
	m := newModel(domain.PlanPrereqs(everything, nil, "darwin"))
	if len(m.rows) != 0 {
		t.Errorf("a machine with everything installed has nothing to pick, got %d rows", len(m.rows))
	}
}

// The regression that made the list look broken. lipgloss wraps styled text
// in escape codes, and fmt's `%-22s` counted those as characters — so the one
// row the cursor was on lost its padding and every column after it jumped,
// at exactly the place the eye was already looking.
// @scenario "Every column lines up, including the highlighted row"
func TestTheHighlightedRowKeepsItsColumns(t *testing.T) {
	m := newModel(missingEverything())
	m.cursor = 3

	var columns []int
	for i := range m.rows {
		plain := stripANSI(m.renderRow(i, m.rows[i]))
		at := strings.Index(plain, m.rows[i].st.Requirement.String())
		if at < 0 {
			t.Fatalf("row %d does not name its requirement: %q", i, plain)
		}
		// The DISPLAY column, not the byte offset: the cursor glyph is three
		// bytes wide and one column wide, and it is the cursor row this test
		// is about.
		columns = append(columns, lipgloss.Width(plain[:at]))
	}
	for i, at := range columns {
		if at != columns[0] {
			t.Errorf("row %d starts its requirement column at %d, the first row at %d — styling must not change a column's width",
				i, at, columns[0])
		}
	}
}

// A row that is satisfied is not on the screen, so nothing on the screen
// should offer to change something already settled. The runtime used to
// print "→ colima + docker CLI (←/→ to change)" against an installed colima.
// @scenario "The picker lists what needs deciding, not the whole inventory"
func TestNothingOffersAChoiceThatIsAlreadySettled(t *testing.T) {
	found := map[string]domain.Found{"colima": {Present: true}}
	view := newModel(domain.PlanPrereqs(found, nil, "darwin")).View()
	if strings.Contains(view, "←/→") {
		t.Errorf("the runtime is installed — nothing should offer to pick between runtimes:\n%s", view)
	}
}

// The view is the whole point of the command, so it is worth pinning what it
// says: every decision, and what enter will do.
// @scenario "Installs run with the terminal to themselves"
func TestViewNamesEveryDecisionAndWhatEnterDoes(t *testing.T) {
	view := newModel(missingEverything()).View()
	for _, p := range domain.Prereqs {
		if !strings.Contains(view, p.Name) {
			t.Errorf("the view omits %q — on a fresh machine every entry is a decision", p.Name)
		}
	}
	if !strings.Contains(view, "npm install -g") {
		t.Errorf("a ticked row should say what it will run, got:\n%s", view)
	}
	for _, want := range []string{"space tick", "never ask again", "enter install"} {
		if !strings.Contains(view, want) {
			t.Errorf("the view should mention %q", want)
		}
	}
}

// @scenario "Installs run with the terminal to themselves"
func TestBulkKeysTickAndUntickEverything(t *testing.T) {
	m := press(newModel(missingEverything()), "a")
	for _, r := range m.rows {
		if !r.ticked {
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

// ansiRE matches the colour escapes lipgloss wraps its output in, so a test
// can measure a row the way a terminal renders it rather than in bytes.
var ansiRE = regexp.MustCompile(`\x1b\[[0-9;]*m`)

func stripANSI(s string) string { return ansiRE.ReplaceAllString(s, "") }
