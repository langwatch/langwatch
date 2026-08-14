// Package hubtui is the interactive hub: one screen showing the whole machine
// — every stack with its health and footprint, every worktree (running or
// not), the shared servers, agents and tooling beside them, and the daemon's
// recent reaping — with actions on the selected row and one-key handoffs to
// cleanup and the web dashboard. Like the dashboard adapter it never imports
// the app core: it reads state and performs actions through the callbacks it
// is constructed with, so the composition root stays the only place that knows
// both sides.
package hubtui

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

// ServiceRow is one service of a stack, as the detail panel shows it.
type ServiceRow struct {
	Name       string
	Port       int
	URL        string
	IsUp       bool
	IsFallback bool
}

// Row is one stack as the hub shows it.
type Row struct {
	Slug, Branch, Dir string
	IsLive            bool
	RSS               uint64
	ServicesUp        int
	ServicesTotal     int
	AppURL            string
	Services          []ServiceRow
}

// WorktreeRow is a worktree with nothing running from it — visible so the hub
// answers "what is on this machine", not just "what is up".
type WorktreeRow struct {
	Slug, Branch, Dir    string
	IsPrimary, IsCurrent bool
}

// Name is what the worktree is called on screen and what a destroy
// confirmation must type: the haven slug when one is known, the directory's
// base name otherwise.
func (w WorktreeRow) Name() string {
	if w.Slug != "" {
		return w.Slug
	}
	return filepath.Base(w.Dir)
}

// Protected reports whether the row may never be destroyed (the primary
// checkout and the worktree haven runs from — the same guards the app layer
// enforces again).
func (w WorktreeRow) Protected() bool { return w.IsPrimary || w.IsCurrent }

// Summary is the machine header: the RAM picture with every dev-work process
// attributed once, plus the daemon's pressure reading.
type Summary struct {
	TotalRAM   uint64
	StacksRSS  uint64
	ServerRSS  map[string]uint64
	AgentRSS   uint64
	AgentCount int
	ToolingRSS uint64
	Pressure   string // the daemon's pressure level ("green" hidden, others shown)
}

// DevRSS is everything attributed to dev work, summed.
func (s Summary) DevRSS() uint64 {
	total := s.StacksRSS + s.AgentRSS + s.ToolingRSS
	for _, rss := range s.ServerRSS {
		total += rss
	}
	return total
}

// Event is one daemon reclamation, newest first, as the monitor panel shows it.
type Event struct {
	At                   time.Time
	Kind, Target, Reason string
}

// View is everything one refresh shows.
type View struct {
	Stacks    []Row
	Worktrees []WorktreeRow
	Summary   Summary
	Events    []Event
}

// Actions wires the hub to the world. Refresh is re-read on every tick; Down
// and Destroy run against the selected row when the user confirms. Restart
// bounces the selected stack's supervised services in place; OpenURL opens a
// URL in the browser (the stack's app, or WebURL for the machine dashboard).
// Any action may be nil (hidden).
type Actions struct {
	Refresh func() View
	Down    func(ctx context.Context, slug string) error
	Destroy func(ctx context.Context, dir string) error
	Restart func(ctx context.Context, slug string) error
	OpenURL func(url string) error
	// WebURL is the machine dashboard ("w" opens it via OpenURL).
	WebURL string
	// HasCleanup advertises the cleanup handoff ("c"): the hub quits with
	// Outcome.RunCleanup set and the caller runs the picker in the terminal.
	HasCleanup bool
}

// Outcome is what the hub wants the caller to do after it closed: open a git
// view, hand the terminal to cleanup, or nothing (a plain quit). The caller
// re-enters the hub after either handoff.
type Outcome struct {
	OpenGitDir string
	RunCleanup bool
}

// Run blocks in the hub TUI and returns what to do next.
func Run(ctx context.Context, a Actions) (Outcome, error) {
	p := tea.NewProgram(newModel(ctx, a), tea.WithAltScreen(), tea.WithContext(ctx))
	out, err := p.Run()
	if err != nil {
		if ctx.Err() != nil {
			return Outcome{}, nil //nolint:nilerr // Ctrl-C via signal context is a clean quit, not an error
		}
		return Outcome{}, err
	}
	m := out.(model)
	return m.outcome, nil
}

type mode int

const (
	modeBrowse mode = iota
	modeConfirmDown
	modeConfirmDestroy
)

// item is one selectable line: a stack or a worktree.
type item struct {
	stack *Row
	wt    *WorktreeRow
}

func (it item) dir() string {
	if it.stack != nil {
		return it.stack.Dir
	}
	return it.wt.Dir
}

func (it item) name() string {
	if it.stack != nil {
		return it.stack.Slug
	}
	return it.wt.Name()
}

type tickMsg struct{}

// actionDoneMsg reports a Down/Destroy/Restart result back to the update loop.
type actionDoneMsg struct {
	verb string
	slug string
	err  error
}

type model struct {
	ctx     context.Context
	actions Actions
	view    View
	items   []item
	cursor  int
	mode    mode
	pending *item  // the row a confirmation prompt is acting on, frozen at open time
	typed   string // the name typed to confirm a destroy
	flash   string // last action's outcome, shown until the next keypress
	// isQuitting means quit was requested while an action was in flight: the hub
	// exits when the action completes (a second ctrl+c force-quits).
	isQuitting  bool
	outcome     Outcome
	busy        bool
	showMonitor bool
}

func newModel(ctx context.Context, a Actions) model {
	m := model{ctx: ctx, actions: a}
	m.refresh()
	return m
}

func (m *model) refresh() {
	m.view = m.actions.Refresh()
	m.items = m.items[:0]
	for i := range m.view.Stacks {
		m.items = append(m.items, item{stack: &m.view.Stacks[i]})
	}
	for i := range m.view.Worktrees {
		m.items = append(m.items, item{wt: &m.view.Worktrees[i]})
	}
	if m.cursor >= len(m.items) {
		m.cursor = max(0, len(m.items)-1)
	}
}

func (m model) Init() tea.Cmd { return tick() }

func tick() tea.Cmd {
	return tea.Tick(2*time.Second, func(time.Time) tea.Msg { return tickMsg{} })
}

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tickMsg:
		m.refresh()
		return m, tick()
	case actionDoneMsg:
		m.busy = false
		if msg.err != nil {
			m.flash = fmt.Sprintf("%s %s failed: %v", msg.verb, msg.slug, msg.err)
		} else {
			m.flash = fmt.Sprintf("%s %s — done", msg.verb, msg.slug)
		}
		m.refresh()
		if m.isQuitting {
			return m, tea.Quit
		}
		return m, nil
	case tea.KeyMsg:
		if m.busy {
			// Quitting mid-action would abandon a confirmed Down/Destroy half-way
			// (stack downed, databases or worktree still in place), so the first
			// q/ctrl+c only arms a drain: the hub exits as soon as the in-flight
			// action reports back. A second ctrl+c force-quits, so a truly hung
			// callback still can't hold the terminal hostage.
			switch msg.String() {
			case "ctrl+c":
				if m.isQuitting {
					return m, tea.Quit
				}
				m.isQuitting = true
			case "q":
				m.isQuitting = true
			}
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
		if m.cursor < len(m.items)-1 {
			m.cursor++
		}
	case "enter", "g":
		if it, ok := m.selected(); ok {
			m.outcome.OpenGitDir = it.dir()
			return m, tea.Quit
		}
	case "d":
		if it, ok := m.selected(); ok && it.stack != nil {
			m.mode = modeConfirmDown
			m.pending = &it
		}
	case "r":
		if it, ok := m.selected(); ok && it.stack != nil && m.actions.Restart != nil && it.stack.IsLive {
			m.busy = true
			slug := it.stack.Slug
			return m, func() tea.Msg {
				return actionDoneMsg{verb: "restart", slug: slug, err: m.actions.Restart(m.ctx, slug)}
			}
		}
	case "o":
		if it, ok := m.selected(); ok && it.stack != nil && m.actions.OpenURL != nil && it.stack.AppURL != "" {
			m.open(it.stack.AppURL)
		}
	case "w":
		if m.actions.OpenURL != nil && m.actions.WebURL != "" {
			m.open(m.actions.WebURL)
		}
	case "c":
		if m.actions.HasCleanup {
			m.outcome.RunCleanup = true
			return m, tea.Quit
		}
	case "m":
		m.showMonitor = !m.showMonitor
	case "x":
		if it, ok := m.selected(); ok {
			if it.wt != nil && it.wt.Protected() {
				m.flash = fmt.Sprintf("%s is protected — the primary checkout and the current worktree are never destroyed", it.name())
				return m, nil
			}
			m.mode = modeConfirmDestroy
			m.pending = &it
			m.typed = ""
		}
	}
	return m, nil
}

func (m *model) open(url string) {
	if err := m.actions.OpenURL(url); err != nil {
		m.flash = fmt.Sprintf("open %s failed: %v", url, err)
	} else {
		m.flash = "opened " + url
	}
}

func (m model) updateConfirmDown(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "y", "Y":
		it := m.pending
		m.mode = modeBrowse
		m.pending = nil
		if it == nil || it.stack == nil || !m.itemStillPresent(*it) {
			m.flash = "down canceled — stack changed"
			return m, nil
		}
		m.busy = true
		slug := it.stack.Slug
		return m, func() tea.Msg {
			return actionDoneMsg{verb: "down", slug: slug, err: m.actions.Down(m.ctx, slug)}
		}
	default:
		m.mode = modeBrowse
		m.pending = nil
		m.flash = "down canceled"
	}
	return m, nil
}

func (m model) updateConfirmDestroy(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	it := m.pending
	if it == nil {
		m.mode = modeBrowse
		return m, nil
	}
	switch msg.String() {
	case "esc", "ctrl+c":
		m.mode = modeBrowse
		m.pending = nil
		m.flash = "destroy canceled"
	case "backspace":
		if len(m.typed) > 0 {
			m.typed = m.typed[:len(m.typed)-1]
		}
	case "enter":
		m.mode = modeBrowse
		m.pending = nil
		if m.typed != it.name() {
			m.flash = "name did not match — nothing destroyed"
			m.typed = ""
			return m, nil
		}
		m.typed = ""
		if !m.itemStillPresent(*it) {
			m.flash = "destroy canceled — the row changed"
			return m, nil
		}
		m.busy = true
		dir, name := it.dir(), it.name()
		return m, func() tea.Msg {
			return actionDoneMsg{verb: "destroy", slug: name, err: m.actions.Destroy(m.ctx, dir)}
		}
	default:
		if msg.Type == tea.KeyRunes {
			m.typed += string(msg.Runes)
		}
	}
	return m, nil
}

// itemStillPresent reports whether the frozen confirmation row is still in the
// freshly-read view — a refresh tick may have removed it while the prompt was
// open, in which case the destructive action must not fire.
func (m model) itemStillPresent(it item) bool {
	for _, x := range m.items {
		if x.dir() == it.dir() && x.name() == it.name() && (x.stack != nil) == (it.stack != nil) {
			return true
		}
	}
	return false
}

func (m model) selected() (item, bool) {
	if m.cursor < 0 || m.cursor >= len(m.items) {
		return item{}, false
	}
	return m.items[m.cursor], true
}

// --- view --------------------------------------------------------------------

var (
	accent       = lipgloss.AdaptiveColor{Light: "#ed8926", Dark: "#f59e3f"}
	styleTitle   = lipgloss.NewStyle().Bold(true).Foreground(accent)
	styleDim     = lipgloss.NewStyle().Faint(true)
	styleSel     = lipgloss.NewStyle().Foreground(accent).Bold(true)
	styleLive    = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	styleStale   = lipgloss.NewStyle().Foreground(lipgloss.Color("214"))
	styleWarn    = lipgloss.NewStyle().Foreground(lipgloss.Color("203")).Bold(true)
	styleSection = lipgloss.NewStyle().Bold(true).Faint(true)
	styleBarOn   = lipgloss.NewStyle().Foreground(accent)
)

const hubWidth = 72

func (m model) View() string {
	var b strings.Builder
	m.viewHeader(&b)
	m.viewStacks(&b)
	m.viewWorktrees(&b)
	if m.showMonitor {
		m.viewMonitor(&b)
	}
	m.viewFooter(&b)
	return b.String()
}

func (m model) viewHeader(b *strings.Builder) {
	live := 0
	for i := range m.view.Stacks {
		if m.view.Stacks[i].IsLive {
			live++
		}
	}
	title := " ⌂ haven "
	right := fmt.Sprintf("%d stack(s) · %d live", len(m.view.Stacks), live)
	if p := m.view.Summary.Pressure; p != "" && p != "green" {
		right += " · pressure " + styleWarn.Render(p)
	}
	pad := max(1, hubWidth-lipgloss.Width(title)-lipgloss.Width(right))
	b.WriteString(styleTitle.Render(title) + strings.Repeat(" ", pad) + styleDim.Render(right) + "\n")
	b.WriteString(styleDim.Render(" "+strings.Repeat("─", hubWidth)) + "\n")

	s := m.view.Summary
	if s.TotalRAM > 0 && s.DevRSS() > 0 {
		bar := memBar(s.DevRSS(), s.TotalRAM, 24)
		fmt.Fprintf(b, " %s %s  dev work ~%s of %s\n",
			styleSection.Render("machine"), bar, humanBytes(s.DevRSS()), humanBytes(s.TotalRAM))
		b.WriteString(styleDim.Render("         "+strings.Join(summaryParts(s), " · ")) + "\n")
	}
	b.WriteString("\n")
}

// summaryParts is the machine breakdown: only the buckets that hold anything.
func summaryParts(s Summary) []string {
	var parts []string
	if s.StacksRSS > 0 {
		parts = append(parts, "stacks ~"+humanBytes(s.StacksRSS))
	}
	if servers := sumValues(s.ServerRSS); servers > 0 {
		parts = append(parts, "servers ~"+humanBytes(servers))
	}
	if s.AgentRSS > 0 {
		parts = append(parts, fmt.Sprintf("agents ~%s (%d)", humanBytes(s.AgentRSS), s.AgentCount))
	}
	if s.ToolingRSS > 0 {
		parts = append(parts, "tooling ~"+humanBytes(s.ToolingRSS))
	}
	return parts
}

func (m model) viewStacks(b *strings.Builder) {
	b.WriteString(styleSection.Render(" stacks") + "\n")
	if len(m.view.Stacks) == 0 {
		b.WriteString(styleDim.Render("   none running — `haven up` in a worktree starts one") + "\n")
	}
	for i := range m.view.Stacks {
		r := &m.view.Stacks[i]
		isSelected := m.itemSelected(item{stack: r})
		renderStackRow(b, r, isSelected)
		// The selected stack unfolds: where it lives, and each service's health +
		// hostname — the detail you'd otherwise dig out of `haven list`.
		if isSelected {
			renderStackDetail(b, r)
		}
	}
}

func renderStackRow(b *strings.Builder, r *Row, isSelected bool) {
	marker, style := "  ", lipgloss.NewStyle()
	if isSelected {
		marker, style = " ▸", styleSel
	}
	dot := styleLive.Render("●")
	if !r.IsLive {
		dot = styleStale.Render("○")
	}
	facts := fmt.Sprintf("%-26s %d/%d up", truncate(r.Branch, 26), r.ServicesUp, r.ServicesTotal)
	if r.RSS > 0 {
		facts += fmt.Sprintf("  %7s", humanBytes(r.RSS))
	}
	fmt.Fprintf(b, "%s %s %s  %s\n", marker, dot, style.Render(fmt.Sprintf("%-18s", truncate(r.Slug, 18))), styleDim.Render(facts))
}

func renderStackDetail(b *strings.Builder, r *Row) {
	b.WriteString(styleDim.Render("       "+r.Dir) + "\n")
	for _, svc := range r.Services {
		sdot := styleLive.Render("●")
		if !svc.IsUp {
			sdot = styleStale.Render("○")
		}
		note := svc.URL
		if svc.IsFallback {
			note += styleDim.Render("  (baseline)")
		}
		fmt.Fprintf(b, "       %s %-12s %s\n", sdot, svc.Name, styleDim.Render(note))
	}
}

func (m model) viewWorktrees(b *strings.Builder) {
	if len(m.view.Worktrees) == 0 {
		return
	}
	b.WriteString("\n" + styleSection.Render(" worktrees — nothing running") + "\n")
	for i := range m.view.Worktrees {
		w := &m.view.Worktrees[i]
		isSelected := m.itemSelected(item{wt: w})
		marker, style := "  ", styleDim
		if isSelected {
			marker, style = " ▸", styleSel
		}
		note := truncate(w.Branch, 30)
		switch {
		case w.IsPrimary:
			note += "  (primary — protected)"
		case w.IsCurrent:
			note += "  (current — protected)"
		}
		fmt.Fprintf(b, "%s ○ %s  %s\n", marker, style.Render(fmt.Sprintf("%-18s", truncate(w.Name(), 18))), styleDim.Render(note))
		if isSelected {
			b.WriteString(styleDim.Render("       "+w.Dir) + "\n")
		}
	}
}

func (m model) viewMonitor(b *strings.Builder) {
	b.WriteString("\n" + styleSection.Render(" monitor — the daemon's recent reaping") + "\n")
	if parts := serverParts(m.view.Summary.ServerRSS); len(parts) > 0 {
		b.WriteString(styleDim.Render("   shared servers: "+strings.Join(parts, " · ")) + "\n")
	}
	if len(m.view.Events) == 0 {
		b.WriteString(styleDim.Render("   nothing reaped yet") + "\n")
		return
	}
	shown := m.view.Events
	const maxEvents = 8
	if len(shown) > maxEvents {
		shown = shown[:maxEvents]
	}
	for _, ev := range shown {
		age := "now"
		if !ev.At.IsZero() {
			age = humanAge(time.Since(ev.At))
		}
		fmt.Fprintf(b, "   %s  %-13s %-22s %s\n",
			styleDim.Render(fmt.Sprintf("%6s", age)), ev.Kind, truncate(ev.Target, 22), styleDim.Render(ev.Reason))
	}
}

// serverParts names each shared server that holds memory, in a stable order.
func serverParts(servers map[string]uint64) []string {
	var parts []string
	for _, name := range []string{"clickhouse", "postgres", "redis", "containers"} {
		if rss := servers[name]; rss > 0 {
			parts = append(parts, fmt.Sprintf("%s ~%s", name, humanBytes(rss)))
		}
	}
	return parts
}

func (m model) viewFooter(b *strings.Builder) {
	b.WriteString("\n")
	switch {
	case m.busy && m.isQuitting:
		b.WriteString(styleWarn.Render("  working… exiting when the current action finishes (ctrl+c again to force)") + "\n")
	case m.busy:
		b.WriteString(styleWarn.Render("  working…") + "\n")
	case m.mode == modeConfirmDown && m.pending != nil:
		b.WriteString(styleWarn.Render(fmt.Sprintf("  shut %q down? Its databases are kept. y/n", m.pending.name())) + "\n")
	case m.mode == modeConfirmDestroy && m.pending != nil:
		b.WriteString(styleWarn.Render(fmt.Sprintf("  DESTROY %q — stops anything running, drops its databases, deletes the worktree.", m.pending.name())) + "\n")
		b.WriteString(styleWarn.Render(fmt.Sprintf("  type the name to confirm: %s▏", m.typed)) + "\n")
	case m.flash != "":
		b.WriteString("  " + m.flash + "\n")
	default:
		b.WriteString(styleDim.Render("  "+strings.Join(m.keyHints(), " · ")) + "\n")
	}
}

func (m model) keyHints() []string {
	keys := append([]string{"↑↓ select", "enter git"}, m.stackKeys()...)
	keys = append(keys, "x destroy")
	if m.actions.HasCleanup {
		keys = append(keys, "c cleanup")
	}
	if m.actions.OpenURL != nil && m.actions.WebURL != "" {
		keys = append(keys, "w web")
	}
	return append(keys, "m monitor", "q quit")
}

// stackKeys are the hints that only apply with a stack row selected.
func (m model) stackKeys() []string {
	it, ok := m.selected()
	if !ok || it.stack == nil {
		return nil
	}
	var keys []string
	if m.actions.OpenURL != nil && it.stack.AppURL != "" {
		keys = append(keys, "o open")
	}
	if m.actions.Restart != nil && it.stack.IsLive {
		keys = append(keys, "r restart")
	}
	return append(keys, "d down")
}

func (m model) itemSelected(it item) bool {
	sel, ok := m.selected()
	if !ok {
		return false
	}
	if it.stack != nil {
		return sel.stack == it.stack
	}
	return sel.wt == it.wt
}

// memBar renders dev work's share of machine RAM as a fixed-width bar.
func memBar(used, total uint64, width int) string {
	if total == 0 {
		return ""
	}
	on := int(min(uint64(width), used*uint64(width)/total))
	return styleBarOn.Render(strings.Repeat("█", on)) + styleDim.Render(strings.Repeat("░", width-on))
}

func sumValues(m map[string]uint64) uint64 {
	var total uint64
	for _, v := range m {
		total += v
	}
	return total
}

// truncate bounds a cell to n runes so one long branch name can't shear the
// table out of alignment.
func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n-1]) + "…"
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

// humanAge is a compact "how long ago" for the monitor panel.
func humanAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return "now"
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 24*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}
