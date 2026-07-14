// Package hubtui is the interactive hub: one screen showing every stack with
// its health and footprint, and actions on the selected one — open its git
// view, shut it down, or destroy the worktree entirely. Like the dashboard
// adapter it never imports the app core: it reads state and performs actions
// through the callbacks it is constructed with, so the composition root stays
// the only place that knows both sides.
package hubtui

import (
	"context"
	"fmt"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// Row is one stack as the hub shows it.
type Row struct {
	Slug, Branch, Dir string
	IsLive            bool
	RSS               uint64
	ServicesUp        int
	ServicesTotal     int
	AppURL            string
}

// Actions wires the hub to the world. Rows is re-read on every refresh tick;
// Down and Destroy run against the selected row when the user confirms.
type Actions struct {
	Rows    func() []Row
	Down    func(ctx context.Context, slug string) error
	Destroy func(ctx context.Context, dir string) error
}

// Run blocks in the hub TUI. It returns a non-empty directory when the user
// chose to open the git view for a stack — the caller runs that and re-enters
// the hub — and "" when the user quit.
func Run(ctx context.Context, a Actions) (openDir string, err error) {
	p := tea.NewProgram(newModel(ctx, a), tea.WithAltScreen(), tea.WithContext(ctx))
	out, err := p.Run()
	if err != nil {
		if ctx.Err() != nil { // Ctrl-C via signal context is a clean quit
			return "", nil
		}
		return "", err
	}
	m := out.(model)
	return m.openDir, nil
}

type mode int

const (
	modeBrowse mode = iota
	modeConfirmDown
	modeConfirmDestroy
)

type tickMsg struct{}

// actionDoneMsg reports a Down/Destroy result back to the update loop.
type actionDoneMsg struct {
	verb string
	slug string
	err  error
}

type model struct {
	ctx     context.Context
	actions Actions
	rows    []Row
	cursor  int
	mode    mode
	typed   string // the name typed to confirm a destroy
	flash   string // last action's outcome, shown until the next keypress
	openDir string
	busy    bool
}

func newModel(ctx context.Context, a Actions) model {
	return model{ctx: ctx, actions: a, rows: a.Rows()}
}

func (m model) Init() tea.Cmd { return tick() }

func tick() tea.Cmd {
	return tea.Tick(2*time.Second, func(time.Time) tea.Msg { return tickMsg{} })
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tickMsg:
		m.rows = m.actions.Rows()
		if m.cursor >= len(m.rows) {
			m.cursor = max(0, len(m.rows)-1)
		}
		return m, tick()
	case actionDoneMsg:
		m.busy = false
		if msg.err != nil {
			m.flash = fmt.Sprintf("%s %s failed: %v", msg.verb, msg.slug, msg.err)
		} else {
			m.flash = fmt.Sprintf("%s %s — done", msg.verb, msg.slug)
		}
		m.rows = m.actions.Rows()
		if m.cursor >= len(m.rows) {
			m.cursor = max(0, len(m.rows)-1)
		}
		return m, nil
	case tea.KeyMsg:
		if m.busy {
			return m, nil
		}
		switch m.mode {
		case modeConfirmDown:
			return m.updateConfirmDown(msg)
		case modeConfirmDestroy:
			return m.updateConfirmDestroy(msg)
		default:
			return m.updateBrowse(msg)
		}
	}
	return m, nil
}

func (m model) updateBrowse(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	m.flash = ""
	switch msg.String() {
	case "q", "esc", "ctrl+c":
		return m, tea.Quit
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
	case "down", "j":
		if m.cursor < len(m.rows)-1 {
			m.cursor++
		}
	case "enter", "g":
		if r, ok := m.selected(); ok {
			m.openDir = r.Dir
			return m, tea.Quit
		}
	case "d":
		if _, ok := m.selected(); ok {
			m.mode = modeConfirmDown
		}
	case "x":
		if _, ok := m.selected(); ok {
			m.mode = modeConfirmDestroy
			m.typed = ""
		}
	}
	return m, nil
}

func (m model) updateConfirmDown(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "y", "Y":
		r, ok := m.selected()
		if !ok {
			m.mode = modeBrowse
			return m, nil
		}
		m.mode = modeBrowse
		m.busy = true
		return m, func() tea.Msg {
			return actionDoneMsg{verb: "down", slug: r.Slug, err: m.actions.Down(m.ctx, r.Slug)}
		}
	default:
		m.mode = modeBrowse
		m.flash = "down cancelled"
	}
	return m, nil
}

func (m model) updateConfirmDestroy(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	r, ok := m.selected()
	if !ok {
		m.mode = modeBrowse
		return m, nil
	}
	switch msg.String() {
	case "esc", "ctrl+c":
		m.mode = modeBrowse
		m.flash = "destroy cancelled"
	case "backspace":
		if len(m.typed) > 0 {
			m.typed = m.typed[:len(m.typed)-1]
		}
	case "enter":
		m.mode = modeBrowse
		if m.typed != r.Slug {
			m.flash = "name did not match — nothing destroyed"
			m.typed = ""
			return m, nil
		}
		m.typed = ""
		m.busy = true
		return m, func() tea.Msg {
			return actionDoneMsg{verb: "destroy", slug: r.Slug, err: m.actions.Destroy(m.ctx, r.Dir)}
		}
	default:
		if msg.Type == tea.KeyRunes {
			m.typed += string(msg.Runes)
		}
	}
	return m, nil
}

func (m model) selected() (Row, bool) {
	if m.cursor < 0 || m.cursor >= len(m.rows) {
		return Row{}, false
	}
	return m.rows[m.cursor], true
}

// --- view --------------------------------------------------------------------

var (
	accent     = lipgloss.AdaptiveColor{Light: "#ed8926", Dark: "#f59e3f"}
	styleTitle = lipgloss.NewStyle().Bold(true).Foreground(accent)
	styleDim   = lipgloss.NewStyle().Faint(true)
	styleSel   = lipgloss.NewStyle().Foreground(accent).Bold(true)
	styleLive  = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	styleStale = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	styleWarn  = lipgloss.NewStyle().Foreground(lipgloss.Color("203")).Bold(true)
)

func (m model) View() string {
	var b strings.Builder
	b.WriteString(styleTitle.Render(" thuishaven hub "))
	b.WriteString(styleDim.Render("— every stack, and what to do with it\n\n"))

	if len(m.rows) == 0 {
		b.WriteString(styleDim.Render("  no stacks running — run `pnpm dev:haven` in a worktree\n"))
	}
	for i, r := range m.rows {
		marker, style := "  ", lipgloss.NewStyle()
		if i == m.cursor {
			marker, style = "▸ ", styleSel
		}
		badge := styleLive.Render("live ")
		if !r.IsLive {
			badge = styleStale.Render("stale")
		}
		facts := fmt.Sprintf("%s · %d/%d services", r.Branch, r.ServicesUp, r.ServicesTotal)
		if r.RSS > 0 {
			facts += " · " + humanBytes(r.RSS)
		}
		b.WriteString(fmt.Sprintf("%s%s %s  %s\n", marker, style.Render(fmt.Sprintf("%-18s", r.Slug)), badge, styleDim.Render(facts)))
		b.WriteString(styleDim.Render("      "+r.Dir) + "\n")
	}

	b.WriteString("\n")
	switch {
	case m.busy:
		b.WriteString(styleWarn.Render("  working…") + "\n")
	case m.mode == modeConfirmDown:
		r, _ := m.selected()
		b.WriteString(styleWarn.Render(fmt.Sprintf("  shut %q down? Its databases are kept. y/n", r.Slug)) + "\n")
	case m.mode == modeConfirmDestroy:
		r, _ := m.selected()
		b.WriteString(styleWarn.Render(fmt.Sprintf("  DESTROY %q — stops the stack, drops its databases, deletes the worktree.", r.Slug)) + "\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  type the name to confirm: %s▏", m.typed)) + "\n")
	case m.flash != "":
		b.WriteString("  " + m.flash + "\n")
	default:
		b.WriteString(styleDim.Render("  ↑↓ select · enter/g git · d down · x destroy · q quit") + "\n")
	}
	return b.String()
}

func humanBytes(b uint64) string {
	const unit = 1024
	if b < unit {
		return fmt.Sprintf("%dB", b)
	}
	div, exp := uint64(unit), 0
	for n := b / unit; n >= unit; n /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f%cB", float64(b)/float64(div), "KMGTPE"[exp])
}
