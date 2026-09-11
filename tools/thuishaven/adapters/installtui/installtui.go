// Package installtui is the picker `haven install` shows a developer with a
// terminal: what this machine is missing, and a tick beside the ones it is
// about to install.
//
// It shows the DECISIONS, not the inventory. The first version listed all
// nine catalogue entries with their state against each, which meant reading
// nine rows to find the one that needed answering — the satisfied majority
// dominating a screen whose whole purpose was the minority. What is already
// installed is one line at the bottom, and the full per-entry report is what
// `haven install --list` is for.
//
// It chooses and nothing more. The installs run AFTER it closes, with the
// terminal to themselves — an installer that asks for a password cannot do
// that from inside an alt-screen program, and one whose progress bar is
// swallowed looks like a hang. So Run returns the decision and the caller
// acts on it.
package installtui

import (
	"context"
	"fmt"
	"runtime"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/havenui"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Column widths, padded as plain text and styled afterwards — see
// havenui.Pad for why that order is not a preference.
const (
	nameWidth        = 22
	requirementWidth = 13
)

// Result is what the developer decided.
type Result struct {
	// Install is what to install, in the order the caller should install it
	// (domain.OrderPrereqs is applied before returning).
	Install []domain.Chosen
	// Never is the prerequisites to record as "do not ask again".
	Never []string
	// Confirmed is false when the picker was quit. Quitting means nothing:
	// nothing installed and nothing recorded, which is the safe reading of
	// someone pressing escape.
	Confirmed bool
}

// Run shows the picker over the full report and returns the decision.
func Run(ctx context.Context, report []domain.PrereqStatus) (Result, error) {
	m := newModel(report)
	if len(m.rows) == 0 {
		// Nothing to decide. A picker with no choices in it would be a worse
		// way of saying "you are ready" than saying it.
		return Result{Confirmed: true}, nil
	}
	out, err := tea.NewProgram(m, tea.WithAltScreen(), tea.WithContext(ctx)).Run()
	if err != nil {
		if ctx.Err() != nil { // Ctrl-C through the signal context is a clean quit
			return Result{}, nil
		}
		return Result{}, err
	}
	return out.(model).result(), nil
}

// row is one entry that needs an answer.
type row struct {
	st domain.PrereqStatus
	// ticked: install it when the picker is confirmed.
	ticked bool
	// never: record it as do-not-ask-again. Mutually exclusive with ticked —
	// the two answers contradict each other, so setting one clears the other.
	never bool
	// candidate indexes st.Candidates for the entries that offer a choice.
	candidate int
}

type model struct {
	// rows are the actionable entries and only those: this screen is a
	// question, so everything on it is part of the question.
	rows []row
	// installed and skipped are what needed no answer, kept for the line
	// under the list — so their absence from it never has to be wondered at.
	installed []string
	skipped   []string

	cursor    int
	confirmed bool
	note      string // a one-line refusal, shown until the next keypress
	width     int
}

func newModel(report []domain.PrereqStatus) model {
	m := model{}
	for _, st := range report {
		switch {
		case st.State.Actionable():
			m.rows = append(m.rows, newRow(st))
		case st.State == domain.PrereqSkipped:
			m.skipped = append(m.skipped, st.Name)
		case st.State == domain.PrereqSatisfied:
			m.installed = append(m.installed, st.Name)
		}
		// Not-applicable entries are left out entirely: on a machine that
		// cannot have them, they are not news.
	}
	return m
}

func newRow(st domain.PrereqStatus) row {
	r := row{st: st}
	// Pre-ticked: what haven itself needs. An optional prerequisite is a
	// convenience, and pre-ticking a convenience is how a tool ends up
	// installing things nobody asked for.
	r.ticked = st.Requirement != domain.PrereqOptional
	for i, c := range st.Candidates {
		if c.Key == st.Via {
			r.candidate = i
		}
	}
	return r
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		return m, nil
	case tea.KeyMsg:
		return m.onKey(msg)
	}
	return m, nil
}

func (m model) onKey(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	m.note = ""
	switch msg.String() {
	case "q", "esc", "ctrl+c":
		return m, tea.Quit
	case "enter":
		m.confirmed = true
		return m, tea.Quit
	case "down", "j":
		if m.cursor < len(m.rows)-1 {
			m.cursor++
		}
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
	case " ":
		return m.toggleTick(), nil
	case "n":
		return m.toggleNever(), nil
	case "left", "h":
		return m.cycleCandidate(-1), nil
	case "right", "l", "tab":
		return m.cycleCandidate(1), nil
	case "a":
		return m.tickAll(true), nil
	case "d":
		return m.tickAll(false), nil
	}
	return m, nil
}

func (m model) toggleTick() model {
	r := &m.rows[m.cursor]
	r.ticked = !r.ticked
	if r.ticked {
		r.never = false
	}
	return m
}

func (m model) toggleNever() model {
	r := &m.rows[m.cursor]
	if r.st.Requirement == domain.PrereqRequired {
		// Silencing a required prerequisite only moves the failure to the
		// first `haven up`, with nothing left to explain it.
		m.note = fmt.Sprintf("%s is required — haven cannot bring a stack up without it, so it cannot be silenced.", r.st.Name)
		return m
	}
	r.never = !r.never
	if r.never {
		r.ticked = false
	}
	return m
}

func (m model) cycleCandidate(delta int) model {
	r := &m.rows[m.cursor]
	if n := len(r.st.Candidates); n > 1 {
		r.candidate = ((r.candidate+delta)%n + n) % n
	}
	return m
}

// tickAll ticks or unticks every row, leaving the "never" marks alone: a bulk
// tick is about this run, and never-ask-again is not.
func (m model) tickAll(on bool) model {
	for i := range m.rows {
		m.rows[i].ticked = on
		if on {
			m.rows[i].never = false
		}
	}
	return m
}

func (m model) result() Result {
	if !m.confirmed {
		return Result{}
	}
	res := Result{Confirmed: true}
	for _, r := range m.rows {
		switch {
		case r.ticked:
			res.Install = append(res.Install, domain.Chosen{
				Key:       r.st.Key,
				Candidate: r.st.Candidates[r.candidate].Key,
			})
		case r.never:
			res.Never = append(res.Never, r.st.Key)
		}
	}
	res.Install = domain.OrderPrereqs(res.Install)
	return res
}

func (m model) View() string {
	var b strings.Builder
	b.WriteString(m.renderHeader())
	for i, r := range m.rows {
		b.WriteString(m.renderRow(i, r))
	}
	b.WriteString(m.renderSettled())
	b.WriteString(m.renderDetail())
	b.WriteString(m.renderFooter())
	return havenui.Clamp(b.String(), m.width)
}

func (m model) renderHeader() string {
	missing := fmt.Sprintf("%d things this machine is missing", len(m.rows))
	if len(m.rows) == 1 {
		missing = "one thing this machine is missing"
	}
	return havenui.Title.Render("haven install") + "\n" +
		havenui.Muted.Render("  "+missing+" — nothing is installed unless it is ticked") + "\n\n"
}

// renderRow is cursor, checkbox, name, requirement, and what will happen to
// it. Not what STATE it is in: every row here is missing, which is why it is
// on the screen, so repeating that against each one is nine words that
// distinguish nothing.
func (m model) renderRow(i int, r row) string {
	cursor := "  "
	name := havenui.Pad(r.st.Name, nameWidth)
	if i == m.cursor {
		cursor = havenui.Selected.Render(havenui.Cursor + " ")
		name = havenui.Selected.Render(name)
	}
	return cursor + m.box(r) + " " + name +
		havenui.Muted.Render(havenui.Pad(r.st.Requirement.String(), requirementWidth)) +
		m.outcome(r) + "\n"
}

// box is the row's answer at a glance: what happens when enter is pressed.
func (m model) box(r row) string {
	switch {
	case r.never:
		return havenui.Absent.Render("[" + havenui.Skip + "]")
	case r.ticked:
		return havenui.Selected.Render("[x]")
	default:
		return "[ ]"
	}
}

// outcome is the consequence of this row's current answer, in the words of
// what will actually run.
func (m model) outcome(r row) string {
	if r.never {
		return havenui.Absent.Render("never ask again")
	}
	// An upgrade is the one case where the state is news: the thing is there,
	// and installing it replaces it rather than adding it.
	prefix := ""
	if r.st.State == domain.PrereqOutdated {
		prefix = havenui.Aging.Render("have "+r.st.Observed) + havenui.Muted.Render(" "+havenui.Bullet+" ")
	}
	candidate := r.st.Candidates[r.candidate]
	if candidate.Declines {
		// Not an install and not a refusal to install — a decision, which
		// enter records.
		return prefix + havenui.Absent.Render("record this choice")
	}
	command, _ := candidate.InstallOn(runtime.GOOS)
	switch {
	case command == "":
		return prefix + havenui.Muted.Render("install it yourself")
	case !r.ticked:
		return prefix + havenui.Muted.Render("not now")
	case len(r.st.Candidates) > 1:
		return prefix + command + havenui.Muted.Render("  ←/→")
	}
	return prefix + command
}

// renderSettled names what needed no answer. One line, quiet, and never a
// list of rows: it is reassurance, not a decision.
func (m model) renderSettled() string {
	var b strings.Builder
	if len(m.installed) > 0 {
		b.WriteString("\n" + havenui.Muted.Render("  "+havenui.Yes+" already here: "+strings.Join(m.installed, ", ")) + "\n")
	}
	if len(m.skipped) > 0 {
		b.WriteString(havenui.Muted.Render("  "+havenui.Skip+" not asking about: "+strings.Join(m.skipped, ", ")) + "\n")
	}
	return b.String()
}

// renderDetail is the pane under the list: what the highlighted entry is for.
// The command is already on its row, so this is the why, not the how.
func (m model) renderDetail() string {
	if m.cursor >= len(m.rows) {
		return ""
	}
	r := m.rows[m.cursor]
	detail := havenui.Muted.PaddingLeft(6)

	var b strings.Builder
	b.WriteString("\n" + detail.Render(r.st.Summary) + "\n")
	// The catalogue indents its continuation lines for the plain-text
	// listings; here the padding is the style's job, so undo it rather than
	// let the two stack up.
	if para := strings.ReplaceAll(r.st.Prereq.Detail, "\n    ", "\n"); para != "" {
		b.WriteString(detail.Render(para) + "\n")
	}
	if c := r.st.Candidates[r.candidate]; c.Declines {
		b.WriteString("\n" + detail.Render("nothing is installed; haven records the choice and stops asking.") + "\n")
	} else if command, manual := c.InstallOn(runtime.GOOS); command == "" {
		b.WriteString("\n" + detail.Render("haven will not run this one for you:\n"+manual) + "\n")
	}
	return b.String()
}

func (m model) renderFooter() string {
	if m.note != "" {
		return "\n" + havenui.Warn.Render("  "+m.note) + "\n"
	}
	return "\n" + havenui.Keys(
		"space tick", "n never ask again", "a all", "d none", "enter install", "q quit",
	) + "\n"
}
