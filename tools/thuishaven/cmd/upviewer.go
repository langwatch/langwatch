package cmd

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
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

// mouseWheelScrollLines is how many lines one wheel notch moves a log tab.
const mouseWheelScrollLines = 3

// sessionGroup is the leading dashboard tab, present only when the viewer is
// wired to an action surface (the interactive up/play paths, never the tests
// that only exercise log tabs).
const sessionGroup = "session"

// sessionActions is the viewer's window onto the live stack: a cheap snapshot
// it refreshes on a slow tick, and a bounce it fires on `r`/`a`. Kept as plain
// callbacks (like the hub's Actions) so the viewer never reaches for the
// orchestrator directly.
type sessionActions struct {
	Snapshot func() app.SessionReport
	Restart  func(name string) (string, error)
	// Down stops the whole stack. Nil on a viewer with no stop contract (the
	// play sandbox, where quitting already destroys everything).
	Down func() error
}

// runUpViewer opens the viewer on a stack's log files until quit or ctx
// cancel. preferred, when non-empty, names the group to land on as soon as it
// appears — `haven up +langy` should open looking at langy.
func runUpViewer(ctx context.Context, slug, preferred string, session sessionActions) error {
	m := newViewerModel(slug, stackLogPath(slug), filepath.Join(havenHome(), "logs", slug))
	m.preferred = preferred
	m.enableDashboard(session, false)
	return runViewer(ctx, m)
}

// runPlayViewer is the same view over a play sandbox, with the opposite quit
// contract in its banner: quitting `haven play` destroys the sandbox, it never
// detaches.
func runPlayViewer(ctx context.Context, slug string, session sessionActions) error {
	m := newViewerModel(slug, stackLogPath(slug), filepath.Join(havenHome(), "logs", slug))
	m.banner = fmt.Sprintf("\x1b[1m haven play\x1b[0m \x1b[2m· %s · EPHEMERAL sandbox · q quits and DESTROYS it (databases, containers, checkout)\x1b[0m\n", slug)
	m.enableDashboard(session, true)
	return runViewer(ctx, m)
}

// sessionActions adapts the orchestrator to the dashboard's callback surface —
// the same shape the hub uses. Snapshot is the cheap live probe; Restart is the
// quiet bounce that returns a summary instead of printing into the alt-screen.
func (d deps) sessionActions(slug string) sessionActions {
	return sessionActions{
		Snapshot: func() app.SessionReport { return d.orch.SessionSnapshot(slug) },
		Restart:  func(name string) (string, error) { return d.orch.RestartStackQuiet(slug, name) },
		Down:     func() error { return d.orch.DownStack(context.Background(), slug) },
	}
}

func runViewer(ctx context.Context, m *viewerModel) error {
	p := tea.NewProgram(m, tea.WithAltScreen(), tea.WithContext(ctx), tea.WithMouseCellMotion())
	_, err := p.Run()
	if err != nil && ctx.Err() != nil { // Ctrl-C via the signal context is a clean quit
		return nil
	}
	return err
}

type viewerTickMsg struct{}

// stopDoneMsg carries the outcome of stopping the stack back to the UI thread.
// A failure keeps the viewer open with the reason on screen: quitting on a stop
// that did not happen would leave the stack running with nothing watching it.
type stopDoneMsg struct{ err error }

// restartDoneMsg carries a bounce's outcome back to the UI thread so the toast
// updates without the action blocking Update.
type restartDoneMsg struct {
	summary string
	err     error
}

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
	// scroll holds, per group, how many lines the view is pulled back from the
	// live bottom (0 = following: new output stays on screen as it arrives).
	// push() advances it in lockstep with new lines so a scrolled-back view
	// keeps showing the same content instead of drifting as output streams in.
	scroll map[string]int
	// searchQuery is the committed, case-insensitive substring search, shared
	// across every log tab. searchPrompt/searchInput hold an in-progress "/"
	// entry before Enter commits it. matchIdx is the current tab's position
	// within its own match list, reset whenever the tab changes.
	searchQuery  string
	searchPrompt bool
	searchInput  string
	matchIdx     int

	// session, when set, drives the leading dashboard tab.
	session       *sessionActions
	snap          app.SessionReport
	cursor        int    // highlighted service row on the dashboard
	destroyOnQuit bool   // play's contract, for the dashboard footer copy
	toast         string // transient action feedback
	toastTTL      int    // refresh ticks the toast still shows for
	// confirmStop is set by the first X and cleared by anything else, so the
	// key that stops the stack always takes two deliberate presses.
	confirmStop bool
	tickN       int // refresh counter, so the snapshot polls on a slow beat
	// startedAt gates which captures become tabs: a file last written before
	// this viewer opened belongs to a lane that no longer runs (a retired lane
	// name, an earlier selection) and stays reachable through `haven logs`.
	startedAt time.Time

	width, height int
}

func newViewerModel(slug, combined, capDir string) *viewerModel {
	return &viewerModel{
		slug:      slug,
		combined:  combined,
		capDir:    capDir,
		groups:    []string{viewerAllGroup},
		lines:     map[string][]string{},
		offsets:   map[string]int64{},
		scroll:    map[string]int{},
		matchIdx:  -1,
		startedAt: time.Now(),
		banner:    fmt.Sprintf("\x1b[1m haven up\x1b[0m \x1b[2m· %s · running in the background · q detaches (stack keeps running) · X stops it\x1b[0m\n", slug),
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
	case stopDoneMsg:
		if msg.err != nil {
			m.setToast("stop failed: " + msg.err.Error())
			return m, nil
		}
		return m, tea.Quit
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
	case tea.KeyMsg:
		return m.handleKey(msg.String())
	case tea.MouseMsg:
		return m.handleMouse(msg)
	}
	return m, nil
}

// handleMouse scrolls the current log tab on a wheel notch. Inert on the
// dashboard tab, which has no scrollable buffer.
func (m *viewerModel) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	if m.onDashboard() {
		return m, nil
	}
	switch msg.Button {
	case tea.MouseButtonWheelUp:
		m.scrollBy(m.currentGroup(), mouseWheelScrollLines)
	case tea.MouseButtonWheelDown:
		m.scrollBy(m.currentGroup(), -mouseWheelScrollLines)
	default:
		// Every other button/gesture is outside this viewer's scope.
	}
	return m, nil
}

// handleKey routes a keypress: dashboard row actions first when the session tab
// is showing, then the tab-navigation and quit bindings shared by every tab.
func (m *viewerModel) handleKey(s string) (tea.Model, tea.Cmd) {
	if m.searchPrompt {
		return m.handleSearchInput(s)
	}
	if m.onDashboard() {
		if model, cmd, handled := m.handleDashboardKey(s); handled {
			return model, cmd
		}
	} else if m.handleLogTabKey(s) {
		return m, nil
	}
	return m.handleCommonKey(s)
}

// handleDashboardKey is tab one's own row navigation and actions. handled is
// false for every key the dashboard does not claim, so those fall through to
// handleCommonKey (tab switching, quit, stop) unchanged.
func (m *viewerModel) handleDashboardKey(s string) (tea.Model, tea.Cmd, bool) {
	switch s {
	case "up", "k":
		if m.cursor > 0 {
			m.cursor--
		}
		return m, nil, true
	case "down", "j":
		if m.cursor < len(m.snap.Services)-1 {
			m.cursor++
		}
		return m, nil, true
	case "enter":
		m.openSelectedLogs()
		return m, nil, true
	case "r":
		return m, m.restartSelected(), true
	case "a":
		return m, m.restartAll(), true
	default:
		return m, nil, false
	}
}

// handleLogTabKey is scrolling and search-entry for a log tab. handled is
// false for every key it does not own, so tab-switching, quit and stop still
// reach handleCommonKey.
func (m *viewerModel) handleLogTabKey(s string) bool {
	group := m.currentGroup()
	switch s {
	case "/":
		m.searchPrompt = true
		m.searchInput = ""
	case "n":
		m.stepMatch(1)
	case "N":
		m.stepMatch(-1)
	case "f", "end":
		m.scroll[group] = 0
	case "pgup":
		m.scrollBy(group, m.bodyHeight())
	case "pgdown":
		m.scrollBy(group, -m.bodyHeight())
	case "up", "k":
		m.scrollBy(group, 1)
	case "down", "j":
		m.scrollBy(group, -1)
	case "home":
		m.scroll[group] = len(m.lines[group])
	default:
		return false
	}
	return true
}

// handleCommonKey is every binding shared by the dashboard and every log tab:
// stop, quit/detach, and tab switching.
func (m *viewerModel) handleCommonKey(s string) (tea.Model, tea.Cmd) {
	if s != "X" {
		m.confirmStop = false
	}
	switch s {
	case "X":
		return m.handleStopKey()
	case "esc":
		// esc is the universal "back out of this screen" key. A live search
		// clears first — the play viewer's destroy contract still wins below
		// once there is nothing left to back out of. Only the keys the banner
		// actually names (q, and ctrl+c as the usual interrupt) may destroy.
		if m.searchQuery != "" {
			m.clearSearch()
			return m, nil
		}
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
		m.matchIdx = -1
	case "left", "h", "shift+tab":
		m.preferred = ""
		m.selected = (m.selected - 1 + len(m.groups)) % len(m.groups)
		m.matchIdx = -1
	default:
		// A digit jumps straight to that tab (1 = the first tab).
		if n := digitKey(s); n > 0 && n <= len(m.groups) {
			m.preferred = ""
			m.selected = n - 1
			m.matchIdx = -1
		}
	}
	return m, nil
}

// handleSearchInput captures keystrokes while the "/" prompt is open: Enter
// commits the query and jumps to the nearest match, Esc cancels without
// touching any search already committed, Backspace edits, everything else
// (a single rune) is appended.
func (m *viewerModel) handleSearchInput(s string) (tea.Model, tea.Cmd) {
	switch s {
	case "enter":
		m.commitSearch()
	case "esc":
		m.searchPrompt = false
		m.searchInput = ""
	case "backspace":
		if m.searchInput != "" {
			_, size := utf8.DecodeLastRuneInString(m.searchInput)
			m.searchInput = m.searchInput[:len(m.searchInput)-size]
		}
	case "ctrl+c":
		return m, tea.Quit
	default:
		if r := []rune(s); len(r) == 1 {
			m.searchInput += s
		}
	}
	return m, nil
}

// handleStopKey is the two-press stop. `haven up` runs the stack in the
// background and q only detaches, so without this the only way to stop what you
// are looking at is to leave and type `haven down`. X is uppercase and asks
// twice because it terminates every lane; it is inert on the play viewer, where
// q already destroys the sandbox and a second stop key would only be ambiguous.
func (m *viewerModel) handleStopKey() (tea.Model, tea.Cmd) {
	if m.destroyOnQuit || m.session == nil || m.session.Down == nil {
		return m, nil
	}
	if !m.confirmStop {
		m.confirmStop = true
		m.setToast("press X again to stop this stack (databases are kept)")
		return m, nil
	}
	m.confirmStop = false
	m.setToast("stopping…")
	down := m.session.Down
	return m, func() tea.Msg { return stopDoneMsg{err: down()} }
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
			if !m.captureWrittenSinceStart(svc) {
				continue
			}
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
			m.push(cli, formatLogLine(l, renderHuman, false))
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

// push appends one line to a group's ring. When the group is scrolled back
// (scroll[group] > 0), the offset advances in lockstep so the window keeps
// showing the same content instead of the new line silently shifting it —
// "following" only resumes when the viewer (or the user, via f/End) sets the
// offset back to 0.
func (m *viewerModel) push(group, line string) {
	ring := append(m.lines[group], line)
	if len(ring) > viewerRingCap {
		ring = ring[len(ring)-viewerRingCap:]
	}
	m.lines[group] = ring
	if m.scroll[group] > 0 {
		m.scroll[group]++
		if m.scroll[group] > len(ring) {
			m.scroll[group] = len(ring)
		}
	}
}

// currentGroup is the tab currently on screen.
func (m *viewerModel) currentGroup() string { return m.groups[m.selected] }

// bodyHeight is how many log lines fit between the tab bar and the footer.
func (m *viewerModel) bodyHeight() int {
	body := m.height - 6
	if body < 1 {
		body = 20
	}
	return body
}

// scrollBy moves a group's scroll-back offset, clamped to [0, len(lines)].
// Positive delta scrolls up (toward older lines); negative scrolls down.
func (m *viewerModel) scrollBy(group string, delta int) {
	n := m.scroll[group] + delta
	if n < 0 {
		n = 0
	}
	if top := len(m.lines[group]); n > top {
		n = top
	}
	m.scroll[group] = n
}

// visibleLines slices a group's ring to the window the current scroll offset
// selects, at most `body` lines.
func (m *viewerModel) visibleLines(group string, body int) []string {
	lines := m.lines[group]
	scroll := m.scroll[group]
	if scroll > len(lines) {
		scroll = len(lines)
	}
	end := len(lines) - scroll
	start := end - body
	if start < 0 {
		start = 0
	}
	return lines[start:end]
}

// searchMatches finds every line in a group containing the committed query,
// case-insensitive. Returns nil when there is no active search.
func (m *viewerModel) searchMatches(group string) []int {
	if m.searchQuery == "" {
		return nil
	}
	q := strings.ToLower(m.searchQuery)
	var idx []int
	for i, l := range m.lines[group] {
		if strings.Contains(strings.ToLower(l), q) {
			idx = append(idx, i)
		}
	}
	return idx
}

// commitSearch closes the prompt, adopts its text as the active query (which
// then applies across every tab), and jumps to the nearest match in this one.
func (m *viewerModel) commitSearch() {
	m.searchPrompt = false
	m.searchQuery = m.searchInput
	m.searchInput = ""
	m.jumpToNearestMatch()
}

// clearSearch drops the active query and its highlighting, leaving scroll
// position where it is.
func (m *viewerModel) clearSearch() {
	m.searchQuery = ""
	m.matchIdx = -1
}

// jumpToNearestMatch lands on the first match at or after the line currently
// at the bottom of the view, wrapping to the last match if the view is
// already scrolled past every match.
func (m *viewerModel) jumpToNearestMatch() {
	group := m.currentGroup()
	matches := m.searchMatches(group)
	if len(matches) == 0 {
		m.matchIdx = -1
		return
	}
	end := len(m.lines[group]) - m.scroll[group]
	best := len(matches) - 1
	for i, idx := range matches {
		if idx >= end-1 {
			best = i
			break
		}
	}
	m.matchIdx = best
	m.revealMatch(group, matches[best])
}

// stepMatch moves forward (dir=1) or back (dir=-1) across the current tab's
// whole match buffer, wrapping at either end.
func (m *viewerModel) stepMatch(dir int) {
	group := m.currentGroup()
	matches := m.searchMatches(group)
	if len(matches) == 0 {
		return
	}
	if m.matchIdx < 0 {
		m.jumpToNearestMatch()
		return
	}
	m.matchIdx = ((m.matchIdx+dir)%len(matches) + len(matches)) % len(matches)
	m.revealMatch(group, matches[m.matchIdx])
}

// revealMatch scrolls a group so the given absolute line index sits at the
// bottom of the visible window.
func (m *viewerModel) revealMatch(group string, lineIdx int) {
	lines := m.lines[group]
	scroll := len(lines) - lineIdx - 1
	if scroll < 0 {
		scroll = 0
	}
	if scroll > len(lines) {
		scroll = len(lines)
	}
	m.scroll[group] = scroll
}

// highlightMatches wraps every case-insensitive occurrence of query in line
// with reverse video, leaving any pre-existing ANSI color codes intact.
func highlightMatches(line, query string) string {
	if query == "" {
		return line
	}
	lower := strings.ToLower(line)
	q := strings.ToLower(query)
	var b strings.Builder
	i := 0
	for {
		j := strings.Index(lower[i:], q)
		if j < 0 {
			b.WriteString(line[i:])
			break
		}
		start := i + j
		end := start + len(q)
		b.WriteString(line[i:start])
		b.WriteString("\x1b[7m")
		b.WriteString(line[start:end])
		b.WriteString("\x1b[27m")
		i = end
	}
	return b.String()
}

// logFooter is the help/status line under a log tab: key bindings normally,
// the live "/" prompt while typing one, and a scroll-position indicator once
// the view has left the following bottom.
func (m *viewerModel) logFooter(group string) string {
	if m.searchPrompt {
		return "\x1b[2m/\x1b[0m" + m.searchInput + "\x1b[7m \x1b[0m\x1b[2m  enter searches · esc cancels\x1b[0m"
	}
	help := "\x1b[2m↑↓/jk scroll · pgup/pgdn page · home/end · / search"
	if m.searchQuery != "" {
		matches := m.searchMatches(group)
		help += fmt.Sprintf(" · %q: %d match(es) · n/N step · esc clears", m.searchQuery, len(matches))
	}
	if scroll := m.scroll[group]; scroll > 0 {
		help += fmt.Sprintf(" · ↑ %d lines above · f to follow", scroll)
	}
	help += "\x1b[0m"
	return help
}

// formatCombinedLine renders a combined-stream line, whose lane comes from the
// supervisor's own label prefix ("api      | {…}") rather than from the file it
// was read out of. A label-less line (a provisioning banner) renders with an
// empty lane column, so it still lines up with the lines around it.
func formatCombinedLine(raw string) string {
	label, rest, ok := strings.Cut(raw, "|")
	name := strings.TrimSpace(label)
	if !ok || name == "" || strings.ContainsRune(name, ' ') {
		return formatLogLine(logLine{text: raw}, renderHuman, false)
	}
	lane := fileToCLIService(name)
	color := logServiceColors[lane]
	if color == "" {
		color = "90" // one-shot prep lanes (codegen, prepare, seed, deps, langy-image)
	}
	return logfmt.Render(strings.TrimPrefix(rest, " "), logfmt.Options{
		Lane: lane, LaneColor: color, Color: true,
	})
}

func (m *viewerModel) View() string {
	var b strings.Builder
	b.WriteString(m.banner)
	b.WriteString(" " + m.tabsLine() + "\n\n")
	if m.onDashboard() {
		b.WriteString(m.dashboardBody())
		return b.String()
	}
	group := m.currentGroup()
	lines := m.visibleLines(group, m.bodyHeight())
	if len(lines) == 0 {
		b.WriteString(" \x1b[2mwaiting for output…\x1b[0m\n")
	}
	for _, l := range lines {
		b.WriteString(" " + highlightMatches(l, m.searchQuery) + "\n")
	}
	b.WriteString("\n " + m.logFooter(group) + "\n")
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

	if m.toast != "" {
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
	quit := "q detaches (stack keeps running) · X stops it"
	if m.destroyOnQuit {
		quit = "\x1b[31mq quits and DESTROYS the sandbox\x1b[0m"
	}
	return "\x1b[2m→/tab logs · 1-9 jump · " + quit + "\x1b[0m"
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

// captureLivenessGrace covers lanes that wrote before the viewer finished opening.
const captureLivenessGrace = 10 * time.Second

// captureWrittenSinceStart reports whether a service's capture file has been
// written since this viewer opened. Older captures are stale lanes, not tabs.
func (m *viewerModel) captureWrittenSinceStart(fileSvc string) bool {
	info, err := os.Stat(filepath.Join(m.capDir, fileSvc+".log"))
	if err != nil {
		return false
	}
	return !info.ModTime().Before(m.startedAt.Add(-captureLivenessGrace))
}
