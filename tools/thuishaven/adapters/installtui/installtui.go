// Package installtui is the picker `haven self install` shows a developer with a
// terminal: what this machine is missing, and a tick beside the ones it is
// about to install.
//
// It shows the DECISIONS, not the inventory. The first version listed all
// nine catalogue entries with their state against each, which meant reading
// nine rows to find the one that needed answering — the satisfied majority
// dominating a screen whose whole purpose was the minority. What is already
// installed is one line at the bottom, and the full per-entry report is what
// `haven self install --list` is for.
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
	"github.com/charmbracelet/lipgloss"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/havenui"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
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
	// expanded shows the highlighted entry's long explanation (the ? key).
	expanded bool
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
	for i, c := range st.Candidates {
		if c.Key == st.Via {
			r.candidate = i
		}
	}
	r.ticked = st.Requirement != domain.PrereqOptional && !isManual(r)
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
	case "?":
		m.expanded = !m.expanded
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
	if isManual(*r) {
		m.note = fmt.Sprintf("haven cannot install %s for you, so there is nothing to tick: run its command yourself. It is printed again when this screen closes.", r.st.Name)
		return m
	}
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
		if isManual(m.rows[i]) {
			continue
		}
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
		// A manual entry is handed on untouched by a tick: installing it
		// prints its command after the picker closes, where it can be copied.
		case r.ticked && !isManual(r), isManual(r) && !r.never:
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
	b.WriteString(m.renderFooter())
	return b.String()
}

// rowIndent is where a row's text starts: past the cursor and the mark column.
const rowIndent = 9

// wrap fits plain text to the screen after an indent, then styles each line,
// so no line is ever cut off and the styling never counts towards the width.
func (m model) wrap(text string, indent int, s lipgloss.Style) string {
	pad := strings.Repeat(" ", indent)
	var out []string
	for _, para := range strings.Split(text, "\n") {
		if m.width > 0 {
			para = lipgloss.NewStyle().Width(max(m.width-indent, 20)).Render(para)
		}
		for _, line := range strings.Split(para, "\n") {
			out = append(out, pad+s.Render(strings.TrimRight(line, " ")))
		}
	}
	return strings.Join(out, "\n") + "\n"
}

func (m model) renderHeader() string {
	missing := fmt.Sprintf("%d things this machine is missing", len(m.rows))
	if len(m.rows) == 1 {
		missing = "one thing this machine is missing"
	}
	return havenui.Title.Render("haven self install") + "\n" +
		m.wrap(missing+" "+havenui.Bullet+" enter installs what is ticked", 2, havenui.Muted) + "\n"
}

// renderRow is one missing entry as a block: its mark, name and requirement,
// one sentence of why, and what enter does about it. The long explanation
// shows only under the cursor, and only after ?.
func (m model) renderRow(i int, r row) string {
	cursor := "  "
	name := havenui.Pad(r.st.Name, m.nameWidth())
	if i == m.cursor {
		cursor = havenui.Selected.Render(havenui.Cursor + " ")
		name = havenui.Selected.Render(name)
	}
	var b strings.Builder
	b.WriteString(cursor + m.mark(r) + name + havenui.Muted.Render(r.st.Requirement.String()) + "\n")
	if r.st.Summary != "" {
		b.WriteString(m.wrap(r.st.Summary, rowIndent, havenui.Muted))
	}
	b.WriteString(m.outcome(r))
	if i == m.cursor && m.expanded {
		// The catalogue indents its continuation lines for the plain-text
		// listings; wrap does the indenting here, so undo it.
		if para := strings.ReplaceAll(r.st.Detail, "\n    ", "\n"); para != "" {
			b.WriteString(m.wrap(para, rowIndent, havenui.Muted))
		}
	}
	return b.String() + "\n"
}

// mark is the row's answer at a glance, padded as plain text before styling
// (havenui.Pad). A manual entry gets a word, not a box: there is nothing to tick.
func (m model) mark(r row) string {
	const width = rowIndent - 2
	switch {
	case r.never:
		return havenui.Absent.Render(havenui.Pad("["+havenui.Skip+"]", width))
	case isManual(r):
		return havenui.Aging.Render(havenui.Pad("manual", width))
	case r.ticked:
		return havenui.Selected.Render(havenui.Pad("[x]", width))
	default:
		return havenui.Pad("[ ]", width)
	}
}

// isManual reports whether haven cannot run the row's chosen candidate here.
func isManual(r row) bool {
	c := r.st.Candidates[r.candidate]
	command, _ := c.InstallOn(platform(r))
	return !c.Declines && command == ""
}

// platform is the GOOS the row was planned for, so the picker and the plan agree.
func platform(r row) string {
	if r.st.Platform != "" {
		return r.st.Platform
	}
	return runtime.GOOS
}

// outcome is what enter does with this row, in the words of what will run. A
// manual command sits alone on its own line, wrapped and never cut.
func (m model) outcome(r row) string {
	if r.never {
		return m.wrap("never ask again", rowIndent, havenui.Absent)
	}
	// An upgrade is the one case where the state is news: the thing is there,
	// and installing it replaces it rather than adding it.
	prefix := ""
	if r.st.State == domain.PrereqOutdated {
		prefix = "have " + r.st.Observed + " " + havenui.Bullet + " "
	}
	candidate := r.st.Candidates[r.candidate]
	command, manual := candidate.InstallOn(platform(r))
	choices := ""
	if len(r.st.Candidates) > 1 {
		choices = "  (←/→ other choices)"
	}
	switch {
	case candidate.Declines:
		return m.wrap(prefix+"enter records this choice; nothing is installed"+choices, rowIndent, havenui.Absent)
	case command == "":
		return m.wrap(prefix+"you run this (printed again when this screen closes):"+choices, rowIndent, havenui.Aging) +
			m.wrap(manual, rowIndent+2, lipgloss.NewStyle())
	case !r.ticked:
		return m.wrap(prefix+"not now (space to tick)"+choices, rowIndent, havenui.Muted)
	}
	// A missing entry's Observed is empty for everything probed by looking,
	// so this only ever carries the shell config the PATH row appends to.
	if r.st.Observed != "" && r.st.State != domain.PrereqOutdated {
		command += " in " + r.st.Observed
	}
	return m.wrap(prefix+"haven installs it: "+command+choices, rowIndent, lipgloss.NewStyle())
}

// renderSettled names what needed no answer: a count, then the names dimmed
// and wrapped. Reassurance, not a decision.
func (m model) renderSettled() string {
	var b strings.Builder
	if len(m.installed) > 0 {
		b.WriteString(havenui.Good.Render("  "+havenui.Yes) + fmt.Sprintf(" %d already here\n", len(m.installed)))
		b.WriteString(m.wrap(strings.Join(m.installed, ", "), 4, havenui.Muted))
	}
	if len(m.skipped) > 0 {
		b.WriteString(havenui.Muted.Render("  "+havenui.Skip) + fmt.Sprintf(" %d not asked about\n", len(m.skipped)))
		b.WriteString(m.wrap(strings.Join(m.skipped, ", "), 4, havenui.Muted))
	}
	return b.String()
}

func (m model) renderFooter() string {
	if m.note != "" {
		return "\n" + m.wrap(m.note, 2, havenui.Warn)
	}
	more := "? why"
	if m.expanded {
		more = "? less"
	}
	hints := []string{"space tick", "n never ask again", more, "a all", "d none", "enter install ticked", "q quit"}
	return "\n" + m.wrap(strings.Join(hints, " "+havenui.Bullet+" "), 2, havenui.Muted)
}

// nameWidth is the longest row name plus a two-space gutter.
func (m model) nameWidth() int {
	w := 0
	for i := range m.rows {
		w = max(w, lipgloss.Width(m.rows[i].st.Name))
	}
	return w + 2
}
