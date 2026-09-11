// Package installtui is the picker `haven install` shows a developer with a
// terminal: every prerequisite haven checked, what the machine answered, and
// a tick next to the ones it is about to install.
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

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

var (
	accent      = lipgloss.AdaptiveColor{Light: "#ed8926", Dark: "#f59e3f"}
	styleTitle  = lipgloss.NewStyle().Bold(true).Foreground(accent)
	styleDim    = lipgloss.NewStyle().Faint(true)
	styleSel    = lipgloss.NewStyle().Foreground(accent).Bold(true)
	styleGood   = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	styleWarn   = lipgloss.NewStyle().Foreground(lipgloss.Color("203")).Bold(true)
	styleNever  = lipgloss.NewStyle().Foreground(lipgloss.Color("213"))
	styleDetail = lipgloss.NewStyle().Faint(true).PaddingLeft(2)
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

// Run shows the picker over the full report and returns the decision. Only
// actionable entries can be ticked; the satisfied ones are still listed,
// because a check that silently omits what it checked is not a check anyone
// can trust.
func Run(ctx context.Context, report []domain.PrereqStatus) (Result, error) {
	m := newModel(report)
	if !m.hasActionable() {
		// Nothing to decide. Showing a picker with no choices in it would be
		// a worse way of saying "you are ready" than saying it.
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

// row is one catalogue entry as the picker holds it.
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

func (r row) actionable() bool { return r.st.State.Actionable() }

type model struct {
	rows      []row
	cursor    int
	confirmed bool
	note      string // a one-line refusal, shown until the next keypress
	width     int
	height    int
}

func newModel(report []domain.PrereqStatus) model {
	m := model{}
	for _, st := range report {
		r := row{st: st}
		// Pre-ticked: what haven itself needs. An optional prerequisite is a
		// convenience, and pre-ticking a convenience is how a tool ends up
		// installing things nobody asked for.
		r.ticked = st.State.Actionable() && st.Requirement != domain.PrereqOptional
		// A satisfied entry starts on whichever candidate satisfied it, so the
		// list says what you have rather than what haven would have picked.
		for i, c := range st.Candidates {
			if c.Key == st.Via {
				r.candidate = i
			}
		}
		m.rows = append(m.rows, r)
	}
	m.cursor = m.firstActionable()
	return m
}

func (m model) firstActionable() int {
	for i, r := range m.rows {
		if r.actionable() {
			return i
		}
	}
	return 0
}

func (m model) hasActionable() bool {
	for _, r := range m.rows {
		if r.actionable() {
			return true
		}
	}
	return false
}

func (m model) Init() tea.Cmd { return nil }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
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
		m.cursor = m.move(1)
	case "up", "k":
		m.cursor = m.move(-1)
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

// move walks to the next row in a direction, stopping at the ends. Satisfied
// rows are skipped: they are shown for completeness, and landing on one with
// no key that does anything reads as the picker being stuck.
func (m model) move(delta int) int {
	for i := m.cursor + delta; i >= 0 && i < len(m.rows); i += delta {
		if m.rows[i].actionable() {
			return i
		}
	}
	return m.cursor
}

func (m model) toggleTick() model {
	r := &m.rows[m.cursor]
	if !r.actionable() {
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
	if !r.actionable() {
		return m
	}
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

// tickAll ticks or unticks every actionable row, leaving the "never" marks
// alone: a bulk tick is about this run, and never-ask-again is not.
func (m model) tickAll(on bool) model {
	for i := range m.rows {
		if !m.rows[i].actionable() {
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
		case r.ticked && r.actionable():
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
	b.WriteString(m.renderDetail())
	b.WriteString(m.renderFooter())
	return clampLines(b.String(), m.width)
}

// clampLines cuts every line to the terminal width, so one long row (the
// runtime's two candidate labels, a `brew install --cask` line) soft-wraps
// nowhere and the layout cannot shift under it.
func clampLines(s string, width int) string {
	if width <= 0 {
		return s
	}
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		if lipgloss.Width(line) > width {
			lines[i] = lipgloss.NewStyle().MaxWidth(width).Render(line)
		}
	}
	return strings.Join(lines, "\n")
}

func (m model) renderHeader() string {
	verdict := domain.ReadyLine(m.reportView())
	style := styleGood
	if strings.HasPrefix(verdict, "not ready") {
		style = styleWarn
	}
	return styleTitle.Render("haven install — what this machine has") + "\n" +
		styleDim.Render("  nothing is installed unless it is ticked") + "\n" +
		"  " + style.Render(verdict) + "\n\n"
}

func (m model) reportView() []domain.PrereqStatus {
	out := make([]domain.PrereqStatus, 0, len(m.rows))
	for _, r := range m.rows {
		out = append(out, r.st)
	}
	return out
}

func (m model) renderRow(i int, r row) string {
	cursor := "  "
	if i == m.cursor {
		cursor = styleSel.Render("▸ ")
	}
	name := r.st.Name
	if i == m.cursor {
		name = styleSel.Render(name)
	}
	line := fmt.Sprintf("%s%s %-22s %s", cursor, m.box(r), name, m.state(r))
	if choice := m.choiceLabel(r); choice != "" {
		line += " " + styleDim.Render(choice)
	}
	return line + "\n"
}

// box is the row's answer at a glance: what will happen when enter is pressed.
func (m model) box(r row) string {
	switch {
	case !r.actionable():
		return styleDim.Render("   ")
	case r.never:
		return styleNever.Render("[–]")
	case r.ticked:
		return styleSel.Render("[x]")
	default:
		return "[ ]"
	}
}

func (m model) state(r row) string {
	switch r.st.State {
	case domain.PrereqSatisfied:
		observed := r.st.Observed
		if observed == "" {
			observed = "installed"
		}
		return styleGood.Render("✓ " + observed)
	case domain.PrereqOutdated:
		return styleWarn.Render("outdated " + r.st.Observed)
	case domain.PrereqSkipped:
		return styleNever.Render("skipped earlier")
	case domain.PrereqNotApplicable:
		return styleDim.Render("not applicable here")
	default:
		return styleWarn.Render("missing") + " " + styleDim.Render("("+r.st.Requirement.String()+")")
	}
}

// choiceLabel names the candidate for an entry that offers more than one, so
// the pick is visible without opening anything.
func (m model) choiceLabel(r row) string {
	if len(r.st.Candidates) < 2 {
		return ""
	}
	return "→ " + r.st.Candidates[r.candidate].Label + "  (←/→ to change)"
}

// renderDetail is the pane under the list: what the highlighted entry is for,
// and the exact command that would install it. The command is shown because
// "what is this thing about to run on my machine" is the question a picker
// that installs software has to answer before it is trusted with an enter.
func (m model) renderDetail() string {
	if m.cursor >= len(m.rows) {
		return ""
	}
	r := m.rows[m.cursor]
	var b strings.Builder
	b.WriteString("\n" + styleDetail.Render(r.st.Summary) + "\n")
	// The catalogue indents its continuation lines for the plain-text
	// listings; here the padding is the style's job, so undo it rather than
	// have the two stack up.
	if para := strings.ReplaceAll(r.st.Prereq.Detail, "\n    ", "\n"); para != "" {
		b.WriteString(styleDetail.Render(para) + "\n")
	}
	if cmd := m.commandLine(r); cmd != "" {
		b.WriteString("\n" + styleDetail.Render(cmd) + "\n")
	}
	return b.String()
}

func (m model) commandLine(r row) string {
	if !r.actionable() || len(r.st.Candidates) == 0 {
		return ""
	}
	command, manual := r.st.Candidates[r.candidate].InstallOn(runtime.GOOS)
	if command == "" {
		return "haven will not run this one for you:\n" + manual
	}
	return "will run: " + command
}

func (m model) renderFooter() string {
	if m.note != "" {
		return "\n" + styleWarn.Render("  "+m.note) + "\n"
	}
	return "\n" + styleDim.Render(
		"  space tick · n never ask again · ←/→ choose · a all · d none · enter install · q quit",
	) + "\n"
}
