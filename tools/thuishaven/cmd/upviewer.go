package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The attached up viewer: what a human's `haven up` shows. The stack itself
// runs detached (startDetachedUp), so this is a window onto it — never a leash.
// Tab one is the session dashboard (live status of every service and shared
// server, with per-service restart and a jump into any log group); the rest are
// the combined stream ("all") and each service's own capture, coloured and
// level-highlighted like `haven logs`. q detaches (up) or destroys (play);
// nothing here can stop an `up` stack — that is `haven down`.

// viewerRingCap bounds how many lines each group holds in memory.
const viewerRingCap = 2000

// viewerAllGroup is the combined launcher stream's tab label.
const viewerAllGroup = "all"

// sessionGroup is the leading dashboard tab, present only when the viewer is
// wired to an action surface (the interactive up/play paths, never the tests
// that only exercise log tabs).
const sessionGroup = "session"

// sessionActions is the viewer's window onto the live stack: a cheap snapshot
// it refreshes on a slow tick, a bounce it fires on `r`/`a`, and the shutdown
// `d` confirms. Kept as plain callbacks (like the hub's Actions) so the viewer
// never reaches for the orchestrator directly. Down is nil where stopping the
// stack from the view would be wrong — the play sandbox, whose teardown is its
// quit contract.
type sessionActions struct {
	Snapshot func() app.SessionReport
	Restart  func(name string) (string, error)
	Down     func() error
}

// viewerExit is why the attached view closed, and so what the caller does next.
// The view is a window onto a background stack, so "closed" is not one thing:
// detaching leaves the stack running, `d` stops it, and `f` hands over to the
// fleet hub.
type viewerExit int

const (
	viewerDetached viewerExit = iota
	viewerDowned
	viewerToHub
)

// attachTarget is what the attached view opens on: the stack, and the log group
// to land on as soon as it appears — `haven up +langy` should open looking at
// langy, while bare `haven` has no such preference.
type attachTarget struct {
	slug      string
	preferred string
}

// runUpViewer opens the viewer on a stack's log files until quit or ctx cancel.
func runUpViewer(ctx context.Context, at attachTarget, session sessionActions) (viewerExit, error) {
	m := newViewerModel(at.slug, stackLogPath(at.slug), filepath.Join(havenHome(), "logs", at.slug))
	m.preferred = at.preferred
	m.enableDashboard(session, false)
	return runViewer(ctx, m)
}

// runPlayViewer is the same view over a play sandbox, with the opposite quit
// contract in its banner: quitting `haven play` destroys the sandbox, it never
// detaches. Every way out of this view is that same teardown, so its exit
// reason carries no information and is discarded.
func runPlayViewer(ctx context.Context, slug string, session sessionActions) error {
	m := newViewerModel(slug, stackLogPath(slug), filepath.Join(havenHome(), "logs", slug))
	m.banner = fmt.Sprintf("\x1b[1m haven play\x1b[0m \x1b[2m· %s · EPHEMERAL sandbox · q quits and DESTROYS it (databases, containers, checkout)\x1b[0m\n", slug)
	m.enableDashboard(session, true)
	_, err := runViewer(ctx, m)
	return err
}

// sessionActions adapts the orchestrator to the dashboard's callback surface —
// the same shape the hub uses. Snapshot is the cheap live probe, Restart the
// quiet bounce that returns a summary instead of printing into the alt-screen,
// and Down the same stop the hub's `d` performs, databases kept.
func (d deps) sessionActions(ctx context.Context, slug string) sessionActions {
	return sessionActions{
		Snapshot: func() app.SessionReport { return d.orch.SessionSnapshot(slug) },
		Restart:  func(name string) (string, error) { return d.orch.RestartStackQuiet(slug, name) },
		Down:     func() error { return d.orch.DownStack(ctx, slug) },
	}
}

func runViewer(ctx context.Context, m *viewerModel) (viewerExit, error) {
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithContext(ctx))
	out, err := p.Run()
	// Ctrl-C via the signal context is a clean quit, and it is the interrupt
	// rather than whatever bubbletea reported that decides so — a detach must
	// not exit non-zero.
	if ctx.Err() != nil {
		return viewerDetached, nil //nolint:nilerr // an interrupted view detached; that is success
	}
	if err != nil {
		return viewerDetached, err
	}
	if final, ok := out.(*viewerModel); ok {
		return final.exit, nil
	}
	return viewerDetached, nil
}

type viewerTickMsg struct{}

// restartDoneMsg carries a bounce's outcome back to the UI thread so the toast
// updates without the action blocking Update.
type restartDoneMsg struct {
	summary string
	err     error
}

// downDoneMsg carries the shutdown's outcome back the same way. A clean one
// closes the view: there is no longer a stack to be a window onto.
type downDoneMsg struct{ err error }

type viewerModel struct {
	slug     string
	combined string // the launcher's combined log file (provisioning + all lanes)
	capDir   string // per-service capture dir (logs/<slug>/)

	groups   []string // tab order: (session) + "all" + captured services (CLI names)
	selected int      // index into groups
	// banner is the header line; the default is `haven up`'s detach contract,
	// and `haven play` overrides it with its destroy-on-quit one.
	banner string
	// preferred is the group to auto-select the moment it appears (the service a
	// `+svc` delta just added); cleared once applied or once the user picks a
	// tab themselves.
	preferred string
	lines     map[string][]string // rendered lines per group, ring-capped
	offsets   map[string]int64    // read offset per file key ("all" or file service name)

	// session, when set, drives the leading dashboard tab.
	session       *sessionActions
	snap          app.SessionReport
	cursor        int    // highlighted service row on the dashboard
	destroyOnQuit bool   // play's contract, for the dashboard footer copy
	toast         string // transient action feedback
	toastTTL      int    // refresh ticks the toast still shows for
	tickN         int    // refresh counter, so the snapshot polls on a slow beat
	// confirmDown is the modal y/n in front of `d`. Unlike the toast it does not
	// expire: a prompt that vanished on a timer would leave the next keypress
	// meaning something else than what the screen said.
	confirmDown bool
	// exit is why the view closed, read by the caller once the program ends.
	exit viewerExit

	width, height int
}

func newViewerModel(slug, combined, capDir string) *viewerModel {
	return &viewerModel{
		slug:     slug,
		combined: combined,
		capDir:   capDir,
		groups:   []string{viewerAllGroup},
		lines:    map[string][]string{},
		offsets:  map[string]int64{},
		banner:   fmt.Sprintf("\x1b[1m haven up\x1b[0m \x1b[2m· %s · running in the background · q detaches (stack keeps running) · haven down stops\x1b[0m\n", slug),
	}
}

// enableDashboard prepends the session tab and wires the action surface. It
// loads a first snapshot up front so tab one paints something real on frame one.
func (m *viewerModel) enableDashboard(session sessionActions, destroyOnQuit bool) {
	m.session = &session
	m.destroyOnQuit = destroyOnQuit
	m.groups = append([]string{sessionGroup}, m.groups...)
	if session.Snapshot != nil {
		m.snap = session.Snapshot()
	}
}

func (m *viewerModel) Init() tea.Cmd { return viewerTick() }

func viewerTick() tea.Cmd {
	return tea.Tick(300*time.Millisecond, func(time.Time) tea.Msg { return viewerTickMsg{} })
}

func (m *viewerModel) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width, m.height = msg.Width, msg.Height
		return m, nil
	case viewerTickMsg:
		m.ingest()
		m.refreshDashboard()
		return m, viewerTick()
	case restartDoneMsg:
		if msg.err != nil {
			m.setToast("restart failed: " + msg.err.Error())
		} else if msg.summary != "" {
			m.setToast(msg.summary)
		}
		if m.session != nil && m.session.Snapshot != nil {
			m.snap = m.session.Snapshot()
		}
		return m, nil
	case downDoneMsg:
		if msg.err != nil {
			m.setToast("down failed: " + msg.err.Error())
			return m, nil
		}
		m.exit = viewerDowned
		return m, tea.Quit
	case tea.KeyMsg:
		return m.handleKey(msg.String())
	}
	return m, nil
}

// handleKey routes a keypress: the shutdown confirmation while it is open,
// then dashboard row actions when the session tab is showing, then the
// tab-navigation and quit bindings shared by every tab.
func (m *viewerModel) handleKey(s string) (tea.Model, tea.Cmd) {
	if m.confirmDown {
		return m.handleDownConfirm(s)
	}
	if m.onDashboard() {
		switch s {
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
			return m, nil
		case "down", "j":
			if m.cursor < len(m.snap.Services)-1 {
				m.cursor++
			}
			return m, nil
		case "enter":
			m.openSelectedLogs()
			return m, nil
		case "r":
			return m, m.restartSelected()
		case "a":
			return m, m.restartAll()
		case "d":
			m.askDown()
			return m, nil
		case "f":
			// The way to the fleet hub. Bare `haven` opens this view when the
			// worktree's own stack is up, so without it the cross-worktree view
			// would have no way in from a live worktree. Like the other stack
			// actions it lives on the dashboard tab, where the footer names it, and
			// never on a play sandbox, where leaving means destroying.
			if !m.canLeaveForHub() {
				return m, nil
			}
			m.exit = viewerToHub
			return m, tea.Quit
		}
	}
	switch s {
	case "esc":
		// esc is the universal "back out of this screen" key, and on the play
		// viewer quitting irreversibly destroys the sandbox — databases,
		// containers, checkout. Only the keys the banner actually names (q, and
		// ctrl+c as the usual interrupt) may do that.
		if m.destroyOnQuit {
			m.setToast("press q to quit — it DESTROYS this sandbox")
			return m, nil
		}
		return m, tea.Quit
	case "q", "ctrl+c":
		return m, tea.Quit
	case "right", "l", "tab":
		m.preferred = ""
		m.selected = (m.selected + 1) % len(m.groups)
	case "left", "h", "shift+tab":
		m.preferred = ""
		m.selected = (m.selected - 1 + len(m.groups)) % len(m.groups)
	default:
		// A digit jumps straight to that tab (1 = the first tab).
		if n := digitKey(s); n > 0 && n <= len(m.groups) {
			m.preferred = ""
			m.selected = n - 1
		}
	}
	return m, nil
}

func (m *viewerModel) onDashboard() bool {
	return m.session != nil && m.groups[m.selected] == sessionGroup
}

// refreshDashboard re-probes the live snapshot on a slow beat (every ~1.2s, not
// every 300ms tick) and expires the toast. Cheap as the probes are, there is no
// reason to hammer them; the log tabs update on the fast tick regardless.
func (m *viewerModel) refreshDashboard() {
	if m.session == nil {
		return
	}
	m.tickN++
	if m.toastTTL > 0 {
		m.toastTTL--
		if m.toastTTL == 0 {
			m.toast = ""
		}
	}
	if m.session.Snapshot != nil && m.tickN%4 == 0 {
		m.snap = m.session.Snapshot()
	}
	if m.cursor >= len(m.snap.Services) {
		m.cursor = maxInt(0, len(m.snap.Services)-1)
	}
}

func (m *viewerModel) selectedService() (app.SessionServiceStatus, bool) {
	if m.cursor < 0 || m.cursor >= len(m.snap.Services) {
		return app.SessionServiceStatus{}, false
	}
	return m.snap.Services[m.cursor], true
}

// openSelectedLogs jumps from the highlighted service to its own log tab, or to
// the combined stream when that service has no capture of its own yet.
func (m *viewerModel) openSelectedLogs() {
	target := viewerAllGroup
	if svc, ok := m.selectedService(); ok && m.hasGroup(svc.Name) {
		target = svc.Name
	}
	for i, g := range m.groups {
		if g == target {
			m.selected = i
			m.preferred = ""
			return
		}
	}
}

// canLeaveForHub reports whether `f` may hand this view over to the fleet hub:
// only a real session, and never a play sandbox (leaving one destroys it).
func (m *viewerModel) canLeaveForHub() bool { return m.session != nil && !m.destroyOnQuit }

// canDown reports whether `d` is offered here — a wired shutdown, and not the
// play sandbox, whose teardown is its quit contract rather than an action.
func (m *viewerModel) canDown() bool {
	return m.session != nil && m.session.Down != nil && !m.destroyOnQuit
}

// askDown arms the shutdown confirmation. Stopping the stack is the one action
// in this view that outlives it, so it asks first — the same y/n gate the hub
// puts in front of its own `d`, and the same promise about the databases.
func (m *viewerModel) askDown() {
	if !m.canDown() {
		return
	}
	m.confirmDown = true
	m.toast = ""
}

// handleDownConfirm answers the y/n prompt. Anything but y cancels, so a
// mistyped key can never stop a stack.
func (m *viewerModel) handleDownConfirm(s string) (tea.Model, tea.Cmd) {
	m.confirmDown = false
	if s != "y" && s != "Y" {
		m.setToast("still running — nothing was stopped")
		return m, nil
	}
	if !m.canDown() {
		return m, nil
	}
	down := m.session.Down
	m.setToast("stopping " + m.slug + "…")
	return m, func() tea.Msg { return downDoneMsg{err: down()} }
}

func (m *viewerModel) restartSelected() tea.Cmd {
	svc, ok := m.selectedService()
	if !ok {
		return nil
	}
	if !svc.Restartable {
		m.setToast(svc.Name + " can't be bounced here")
		return nil
	}
	m.setToast("restarting " + svc.Name + "…")
	return m.bounce(svc.Name)
}

func (m *viewerModel) restartAll() tea.Cmd {
	if len(m.snap.Services) == 0 {
		return nil
	}
	m.setToast("restarting every service…")
	return m.bounce("")
}

// bounce fires the restart off the UI thread; its outcome returns as a
// restartDoneMsg. name is empty for "all".
func (m *viewerModel) bounce(name string) tea.Cmd {
	if m.session == nil || m.session.Restart == nil {
		return nil
	}
	restart := m.session.Restart
	return func() tea.Msg {
		summary, err := restart(name)
		return restartDoneMsg{summary: summary, err: err}
	}
}

func (m *viewerModel) setToast(s string) {
	m.toast = s
	m.toastTTL = 12 // ~3.6s at the 300ms tick
}

func digitKey(s string) int {
	if len(s) == 1 && s[0] >= '1' && s[0] <= '9' {
		return int(s[0] - '0')
	}
	return 0
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ingest pulls appended bytes from every log file into the group rings, and
// discovers services whose capture appeared since the last pass (a later
// `up +svc` joins the tabs live). Keyed by the group's CURRENT name, so a
// selection index stays valid as groups only ever append.
func (m *viewerModel) ingest() {
	m.ingestCombined()
	for _, svc := range capturedServices(m.capDir) {
		cli := fileToCLIService(svc)
		if !m.hasGroup(cli) {
			m.groups = append(m.groups, cli)
			if cli == m.preferred {
				m.selected = len(m.groups) - 1
				m.preferred = ""
			}
		}
		m.ingestCapture(svc, cli)
	}
}

func (m *viewerModel) hasGroup(name string) bool {
	for _, g := range m.groups {
		if g == name {
			return true
		}
	}
	return false
}

// ingestCombined tails the launcher's combined file: lines already carry the
// supervisor's "name     | text" prefix, so colour is re-derived from it.
func (m *viewerModel) ingestCombined() {
	for _, raw := range m.readFresh(viewerAllGroup, m.combined) {
		m.push(viewerAllGroup, formatCombinedLine(raw))
	}
}

// ingestCapture tails one service's timestamped capture file.
func (m *viewerModel) ingestCapture(fileSvc, cli string) {
	for _, raw := range m.readFresh(fileSvc, filepath.Join(m.capDir, fileSvc+".log")) {
		if l, ok := parseLogLine(fileSvc, raw); ok {
			m.push(cli, formatLogLine(l, false))
		}
	}
}

// readFreshTailWindow bounds the FIRST read of any capture file. The viewer only
// ever renders the last few hundred lines, but the combined per-stack log
// (logs/<slug>.log) is append-only and uncapped — long-lived worktrees reach
// hundreds of megabytes. Starting a fresh model at offset 0 therefore allocated
// the whole file, then copied it again through strings.Split, to show a screenful.
// 256 KiB is far more than the ring can hold and is read in one syscall.
const readFreshTailWindow = 256 << 10

// readFresh returns the whole lines appended to path since the last pass,
// starting over when the file rotated (shrank) underneath us.
//
// The first read of a key opens at a bounded tail window rather than at the
// start of the file, so attaching to a stack with a large existing log costs a
// fixed amount of memory. Subsequent reads are true incremental tails.
func (m *viewerModel) readFresh(key, path string) []string {
	info, err := os.Stat(path)
	if err != nil {
		return nil
	}
	offset, seen := m.offsets[key]
	// A partial first line is expected when we seek into the middle of the file;
	// drop it rather than render a fragment.
	dropFirstPartialLine := false
	if !seen {
		if info.Size() > readFreshTailWindow {
			offset = info.Size() - readFreshTailWindow
			dropFirstPartialLine = true
		} else {
			offset = 0
		}
	}
	if info.Size() < offset {
		offset = 0
	}
	if info.Size() == offset {
		m.offsets[key] = offset
		return nil
	}
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer func() { _ = f.Close() }()
	buf := make([]byte, info.Size()-offset)
	if _, err := f.ReadAt(buf, offset); err != nil {
		return nil
	}
	m.offsets[key] = info.Size()
	text := string(buf)
	if dropFirstPartialLine {
		if nl := strings.IndexByte(text, '\n'); nl >= 0 {
			text = text[nl+1:]
		} else {
			text = ""
		}
	}
	var out []string
	for _, raw := range strings.Split(text, "\n") {
		if raw != "" {
			out = append(out, raw)
		}
	}
	return out
}

func (m *viewerModel) push(group, line string) {
	ring := append(m.lines[group], line)
	if len(ring) > viewerRingCap {
		ring = ring[len(ring)-viewerRingCap:]
	}
	m.lines[group] = ring
}

// formatCombinedLine colours a combined-stream line by its supervisor label
// prefix ("app      | booted") and level-highlights the payload; label-less
// lines (provisioning banners) pass through dimmed-label-free.
func formatCombinedLine(raw string) string {
	label, rest, ok := strings.Cut(raw, "|")
	name := strings.TrimSpace(label)
	if !ok || name == "" || strings.ContainsRune(name, ' ') {
		return highlightLevel(raw)
	}
	color := logServiceColors[fileToCLIService(name)]
	if color == "" {
		color = "90" // one-shot prep lanes (codegen, prepare, seed, deps, langy-image)
	}
	return fmt.Sprintf("\x1b[%sm%-8s\x1b[0m │%s", color, fileToCLIService(name), highlightLevel(rest))
}

func (m *viewerModel) View() string {
	var b strings.Builder
	b.WriteString(m.banner)
	b.WriteString(" " + m.tabsLine() + "\n\n")
	if m.onDashboard() {
		b.WriteString(m.dashboardBody())
		return b.String()
	}
	body := m.height - 4
	if body < 1 {
		body = 20
	}
	lines := m.lines[m.groups[m.selected]]
	if len(lines) > body {
		lines = lines[len(lines)-body:]
	}
	if len(lines) == 0 {
		b.WriteString(" \x1b[2mwaiting for output…\x1b[0m\n")
	}
	for _, l := range lines {
		b.WriteString(" " + l + "\n")
	}
	return b.String()
}

// tabsLine renders the group tabs, the selected one inverted, each numbered
// for direct jumps.
func (m *viewerModel) tabsLine() string {
	parts := make([]string, len(m.groups))
	for i, g := range m.groups {
		label := fmt.Sprintf(" %d %s ", i+1, g)
		if i == m.selected {
			parts[i] = "\x1b[7m" + label + "\x1b[0m"
			continue
		}
		parts[i] = "\x1b[2m" + label + "\x1b[0m"
	}
	return strings.Join(parts, " ")
}

// dashboardBody renders tab one: the ASCII harbour, the stack summary, the live
// service and server rows, and the action hint.
func (m *viewerModel) dashboardBody() string {
	var b strings.Builder
	b.WriteString(m.headerBlock())
	b.WriteString("\n")

	if !m.snap.Found {
		b.WriteString(" \x1b[2mthe stack is still provisioning; its services appear here as they register…\x1b[0m\n")
		return b.String()
	}

	b.WriteString(" " + m.stackLine() + "\n\n")

	b.WriteString(" \x1b[1mSERVICES\x1b[0m  \x1b[2m↑↓ move · enter opens its logs · r restart · a restart all\x1b[0m\n")
	for i, svc := range m.snap.Services {
		b.WriteString(m.serviceRow(i, svc) + "\n")
	}

	b.WriteString("\n \x1b[1mSHARED\x1b[0m\n")
	b.WriteString(" " + m.serversLine() + "\n")

	switch {
	case m.confirmDown:
		fmt.Fprintf(&b, "\n \x1b[7m shut %s down? its databases are kept · y/n \x1b[0m\n", m.slug)
	case m.toast != "":
		b.WriteString("\n \x1b[7m " + m.toast + " \x1b[0m\n")
	}

	b.WriteString("\n " + m.footerHint() + "\n")
	return b.String()
}

// stackLine is the one-line summary: slug, branch, liveness, and the RAM the
// whole process group is costing this machine.
func (m *viewerModel) stackLine() string {
	live := "\x1b[31m● stale\x1b[0m"
	if m.snap.Live {
		live = "\x1b[32m● live\x1b[0m"
	}
	branch := m.snap.Branch
	if branch == "" {
		branch = "no branch"
	}
	ram := ""
	if m.snap.RSS > 0 {
		ram = "  \x1b[2m~" + domain.HumanBytes(int64(m.snap.RSS)) + " RAM\x1b[0m"
	}
	return fmt.Sprintf("\x1b[1m%s\x1b[0m  %s  \x1b[2m%s\x1b[0m%s", m.snap.Slug, live, branch, ram)
}

// serviceRow renders one service: a status dot, its name, and where it is
// reached — highlighted when the cursor sits on it, dimmed when it is a shared
// baseline's copy this worktree merely routes to.
func (m *viewerModel) serviceRow(i int, svc app.SessionServiceStatus) string {
	dot := "\x1b[2m○\x1b[0m"
	if svc.Up {
		dot = "\x1b[32m●\x1b[0m"
	}
	name := svc.Name
	tag := ""
	if svc.Fallback {
		tag = " \x1b[2m(shared)\x1b[0m"
	} else if !svc.Restartable {
		tag = " \x1b[2m(managed)\x1b[0m"
	}
	dest := svc.URL
	if dest == "" && svc.Port != 0 {
		dest = fmt.Sprintf(":%d", svc.Port)
	}
	row := fmt.Sprintf(" %s  %-9s %s\x1b[2m%s\x1b[0m", dot, name, dest, tag)
	if m.onDashboard() && i == m.cursor {
		return "\x1b[7m›" + row + "\x1b[0m"
	}
	return " " + row
}

// serversLine renders the shared machinery as compact dot+name pills on one
// line — the proxy, the daemon, and whichever database servers this stack uses.
func (m *viewerModel) serversLine() string {
	parts := make([]string, 0, len(m.snap.Servers))
	for _, s := range m.snap.Servers {
		dot := "\x1b[31m○\x1b[0m"
		if s.Up {
			dot = "\x1b[32m●\x1b[0m"
		}
		parts = append(parts, fmt.Sprintf("%s %s", dot, s.Name))
	}
	if len(parts) == 0 {
		return "\x1b[2mnone\x1b[0m"
	}
	return strings.Join(parts, "   ")
}

func (m *viewerModel) footerHint() string {
	hint := "→/tab logs · 1-9 jump"
	if m.canDown() {
		hint += " · d down (keeps data)"
	}
	if m.canLeaveForHub() {
		hint += " · f fleet"
	}
	quit := "q detaches (stack keeps running)"
	if m.destroyOnQuit {
		quit = "\x1b[31mq quits and DESTROYS the sandbox\x1b[0m"
	}
	return "\x1b[2m" + hint + " · " + quit + "\x1b[0m"
}

// headerBlock is the wordmark and ASCII harbour at the top of tab one: a
// dockside crane stacking containers (the stack) in a safe local port.
func (m *viewerModel) headerBlock() string {
	yellow := func(s string) string { return "\x1b[33m" + s + "\x1b[0m" }
	dim := func(s string) string { return "\x1b[90m" + s + "\x1b[0m" }
	water := func(s string) string { return "\x1b[34m" + s + "\x1b[0m" }
	cellColors := []string{"96", "94", "92", "95"}
	cell := func(i int) string { return "\x1b[1;" + cellColors[i%len(cellColors)] + "m[##]\x1b[0m" }
	containers := func(base int) string {
		return dim(" |") + "  " + cell(base) + " " + cell(base+1) + " " + cell(base+2) + "  " + dim("|")
	}

	rows := []string{
		"  " + yellow(`     __`) + "        \x1b[1;96mh a v e n\x1b[0m",
		"  " + yellow(`    |  |___`) + "     \x1b[2ma safe harbour for your\x1b[0m",
		"  " + yellow(`    |  |   |___`) + " \x1b[2mlocal stack: every service\x1b[0m",
		"  " + yellow(`  __|__|___|___|__`) + " \x1b[2min one place\x1b[0m",
		"  " + containers(0),
		"  " + containers(1),
		"  " + dim(` |________________|`),
		"  " + water(`  ~~~~~~~~~~~~~~~~`),
	}
	return strings.Join(rows, "\n") + "\n"
}
