package cmd

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// The attached up viewer: what a human's `haven up` shows. The stack itself
// runs detached (startDetachedUp), so this is a window onto it — never a leash.
// The top row is fixed - session, logs, errors, traces, metrics, profiles,
// stores, jobs - and each tab is one datasource, which is what lets one screen
// answer the question a person actually arrived with. This file is the model
// that composes them: the frame, the key routing and the tab bar. What each tab
// knows how to do lives in cmd/viewer. q detaches (up) or destroys (play);
// nothing here can stop an `up` stack — that is `haven down`.

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

// runUpViewer opens the viewer on a stack until quit or ctx cancel. preferred,
// when non-empty, names the application whose log sub-tab to land on - `haven
// up +langy` should open looking at langy.
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
	slug string

	// tabs are the seven the viewer package owns, keyed by name. The session
	// tab is not among them: its datasource is haven itself.
	tabs     map[string]viewer.Tab
	logs     *viewer.LogsTab
	errs     *viewer.ErrorsTab
	files    sources.Logs
	selected int // index into viewer.TabNames
	// banner is the header line; the default is `haven up`'s detach contract,
	// and `haven play` overrides it with its destroy-on-quit one.
	banner string
	// preferred is the log sub-tab to land on the moment it has output (the
	// application a `+svc` delta just added); cleared once applied or once the
	// user picks a tab themselves.
	preferred string

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
	// expandedRows are the body rows a click has opened on the tab currently on
	// screen, by their position in the frame. Position, not line identity: a
	// click means "that row, there", and on a following log tab the row under
	// the pointer is the one the reader is looking at. Switching tabs clears it.
	expandedRows map[int]bool
	// expandAll opens every row of a tab, per tab, for a terminal that forwards
	// no clicks.
	expandAll map[string]bool

	width, height int
}

func newViewerModel(slug, combined, capDir string) *viewerModel {
	m := &viewerModel{
		slug:         slug,
		expandedRows: map[int]bool{},
		expandAll:    map[string]bool{},
		banner:       fmt.Sprintf("\x1b[1m haven up\x1b[0m \x1b[2m· %s · running in the background · q detaches (stack keeps running) · X stops it\x1b[0m\n", slug),
	}
	m.install(m.sources(combined, capDir))
	return m
}

// install builds the tab set over one set of datasources. It is where the model
// and the viewer package meet, and the seam a test hands memory doubles to.
func (m *viewerModel) install(src viewer.Sources) {
	m.files = src.Files
	m.tabs = map[string]viewer.Tab{}
	for _, tab := range viewer.New(src) {
		m.tabs[tab.Name()] = tab
	}
	m.logs, _ = m.tabs["logs"].(*viewer.LogsTab)
	m.errs, _ = m.tabs["errors"].(*viewer.ErrorsTab)
}

// sources wires every datasource the tabs read. The Grafana-backed ones are
// pointed at the bundle's fixed loopback ports - fixed on purpose, so agents
// and gcx find the stack without asking haven first.
func (m *viewerModel) sources(combined, capDir string) viewer.Sources {
	obs := observabilityEndpoints()
	loki := sources.NewLoki(obs.GrafanaPort, m.slug, time.Now())
	return viewer.Sources{
		Files:   sources.NewFileLogs(capDir, time.Now()),
		Loki:    loki,
		LokiUp:  loki.Up,
		Traces:  sources.NewTempo(obs.GrafanaPort, m.slug),
		Metrics: sources.NewPrometheus(obs.GrafanaPort, m.slug),
		Profiles: sources.NewPyroscope(sources.PyroscopeConfig{
			PyroscopePort: obs.PyroscopePort, GrafanaPort: obs.GrafanaPort,
			Worktree: m.slug, Services: profiledServices(),
		}),
		Stores: sessionStores{model: m},
		Jobs:   sources.NewFileJobs(capDir, combined),
		Render: renderCapturedLine,
		Open:   openInBrowser,
		Now:    time.Now,
	}
}

// profiledServices are the services whose flame graphs the profiles tab shows,
// with the runtime each one profiles as - the Go services sample CPU where the
// Node applications sample wall time, so asking either for the other's profile
// type shows an empty list rather than a missing one.
func profiledServices() []sources.ProfiledService {
	return []sources.ProfiledService{
		{Name: "langwatch-app"},
		{Name: "langwatch-worker"},
		{Name: "langwatch-service-aigateway", Go: true},
		{Name: "langwatch-service-nlpgo", Go: true},
		{Name: "langwatch-service-langyagent", Go: true},
	}
}

// renderCapturedLine is how a captured line reads on the log tab: the same
// domain/logfmt rendering `haven logs` prints, so a line looks identical
// wherever it is read.
func renderCapturedLine(line sources.LogLine) string {
	lane := fileToCLIService(line.Lane)
	return logfmt.Render(line.Text, logfmt.Options{
		Lane: line.App, LaneColor: logServiceColors[lane], Time: line.At, Color: true,
	})
}

// sessionStores reports the managed database servers from whatever the live
// session snapshot last saw. The ports are not known when the viewer is built  -
// a stack still provisioning has none - so the source resolves them on every
// poll rather than being handed a set that would be stale by the first frame.
type sessionStores struct{ model *viewerModel }

// Stats probes each managed server the snapshot names.
func (s sessionStores) Stats() ([]sources.StoreStat, error) {
	ports := map[string]int{}
	for _, server := range s.model.snap.Servers {
		ports[server.Name] = server.Port
	}
	return sources.LocalStores{
		ClickHouseHTTPPort:   ports["clickhouse"],
		PostgresPort:         ports["postgres"],
		RedisPort:            ports["redis"],
		RedisCapBytes:        float64(envInt("HAVEN_REDIS_MAXMEMORY_MB", domain.DefaultRedisMaxMemoryMB)) * (1 << 20),
		ClickHouseLimitBytes: float64(clickHouseLimits().MaxServerMemory),
	}.Stats()
}

// enableDashboard wires the action surface behind the session tab. It loads a
// first snapshot up front so tab one paints something real on frame one.
func (m *viewerModel) enableDashboard(session sessionActions, destroyOnQuit bool) {
	m.session = &session
	m.destroyOnQuit = destroyOnQuit
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
		return m.stopped(msg)
	case restartDoneMsg:
		return m.restarted(msg)
	case tea.KeyMsg:
		return m.handleKey(msg.String())
	case tea.MouseMsg:
		return m.handleMouse(msg)
	}
	return m, nil
}

func (m *viewerModel) stopped(msg stopDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setToast("stop failed: " + msg.err.Error())
		return m, nil
	}
	return m, tea.Quit
}

func (m *viewerModel) restarted(msg restartDoneMsg) (tea.Model, tea.Cmd) {
	if msg.err != nil {
		m.setToast("restart failed: " + msg.err.Error())
	} else if msg.summary != "" {
		m.setToast(msg.summary)
	}
	if m.session != nil && m.session.Snapshot != nil {
		m.snap = m.session.Snapshot()
	}
	return m, nil
}

// ingest tails the capture files and polls the tab on screen - and only that
// one. The capture tail is not a poll: it is a local read both the log tab and
// the errors tab depend on, and an error that fired while you were reading
// traces is exactly the one the errors tab exists to have caught.
func (m *viewerModel) ingest() {
	for _, line := range m.freshLines() {
		m.logs.Observe(line)
		m.errs.Observe(line)
	}
	m.applyPreferred()
	if tab, ok := m.tabs[m.currentTab()]; ok {
		tab.Poll()
	}
}

// freshLines is whatever the capture tail has appended, or nothing at all on a
// model whose sources were never installed.
func (m *viewerModel) freshLines() []sources.LogLine {
	if m.files == nil {
		return nil
	}
	return m.files.Fresh()
}

// applyPreferred lands on the log sub-tab a `+svc` delta asked for, the moment
// that application has written something.
func (m *viewerModel) applyPreferred() {
	if m.preferred == "" {
		return
	}
	for _, app := range m.logs.SubTabs() {
		if app != m.preferred {
			continue
		}
		m.logs.SelectSubTab(app)
		m.selectTab("logs")
		m.preferred = ""
		return
	}
}

// handleMouse scrolls the current tab on a wheel notch, as a key would, and
// opens the row under a click.
func (m *viewerModel) handleMouse(msg tea.MouseMsg) (tea.Model, tea.Cmd) {
	switch msg.Button {
	case tea.MouseButtonWheelUp:
		m.offerKey("wheelup")
	case tea.MouseButtonWheelDown:
		m.offerKey("wheeldown")
	case tea.MouseButtonLeft:
		if msg.Action == tea.MouseActionPress {
			m.toggleRow(msg.Y - bodyTopRow)
		}
	default:
		// Every other button/gesture is outside this viewer's scope.
	}
	return m, nil
}

// toggleRow opens the clicked body row in full, or closes it again. A click
// above the body is the banner or the tab bar and opens nothing.
func (m *viewerModel) toggleRow(row int) {
	if row < 0 {
		return
	}
	if m.expandedRows[row] {
		delete(m.expandedRows, row)
		return
	}
	m.expandedRows[row] = true
}

// handleKey routes a keypress: the tab on screen is offered it first, and
// whatever it does not claim falls through to the bindings every tab shares.
func (m *viewerModel) handleKey(s string) (tea.Model, tea.Cmd) {
	if m.onSessionTab() {
		if model, cmd, handled := m.handleDashboardKey(s); handled {
			return model, cmd
		}
		return m.handleCommonKey(s)
	}
	if m.offerKey(s) {
		return m, nil
	}
	return m.handleCommonKey(s)
}

// offerKey hands one key to the tab on screen, reporting whether it took it.
func (m *viewerModel) offerKey(s string) bool {
	tab, ok := m.tabs[m.currentTab()]
	return ok && tab.Key(s)
}

// handleDashboardKey is tab one's own row navigation and actions. handled is
// false for every key the dashboard does not claim, so those fall through to
// handleCommonKey (tab switching, quit, stop) unchanged.
func (m *viewerModel) handleDashboardKey(s string) (tea.Model, tea.Cmd, bool) {
	if m.session == nil {
		return m, nil, false
	}
	switch s {
	case "up", "k":
		m.cursor = maxInt(m.cursor-1, 0)
		return m, nil, true
	case "down", "j":
		m.cursor = minInt(m.cursor+1, maxInt(len(m.snap.Services)-1, 0))
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

// handleCommonKey is every binding shared by every tab: stop, quit/detach, and
// tab switching.
func (m *viewerModel) handleCommonKey(s string) (tea.Model, tea.Cmd) {
	if s != "X" {
		m.confirmStop = false
	}
	switch s {
	case "X":
		return m.handleStopKey()
	case "esc":
		return m.handleEscape()
	case "q", "ctrl+c":
		return m, tea.Quit
	case "x":
		tab := m.currentTab()
		m.expandAll[tab] = !m.expandAll[tab]
	case "right", "l", "tab":
		m.moveTab(1)
	case "left", "h", "shift+tab":
		m.moveTab(-1)
	default:
		if n := digitKey(s); n > 0 && n <= len(viewer.TabNames) {
			m.preferred = ""
			m.selected = n - 1
			m.expandedRows = map[int]bool{}
		}
	}
	return m, nil
}

// handleEscape is the universal "back out of this screen" key, once the tab on
// screen has had its own chance at it. Only the keys the banner actually names
// (q, and ctrl+c as the usual interrupt) may destroy a play sandbox.
func (m *viewerModel) handleEscape() (tea.Model, tea.Cmd) {
	if m.destroyOnQuit {
		m.setToast("press q to quit - it DESTROYS this sandbox")
		return m, nil
	}
	return m, tea.Quit
}

func (m *viewerModel) moveTab(delta int) {
	m.preferred = ""
	count := len(viewer.TabNames)
	m.selected = ((m.selected+delta)%count + count) % count
	m.expandedRows = map[int]bool{}
}

// selectTab moves to one tab by name.
func (m *viewerModel) selectTab(name string) {
	for i, tab := range viewer.TabNames {
		if tab == name {
			m.selected = i
			m.expandedRows = map[int]bool{}
			return
		}
	}
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

// currentTab is the name of the tab on screen.
func (m *viewerModel) currentTab() string { return viewer.TabNames[m.selected] }

// onSessionTab is whether the session screen is the one being rendered.
func (m *viewerModel) onSessionTab() bool { return m.currentTab() == viewer.SessionTab }

// onDashboard is whether the session screen is showing AND has an action
// surface behind it. A viewer with no session still opens on the session tab  -
// it says the stack is provisioning - but has no rows to move a cursor over.
func (m *viewerModel) onDashboard() bool { return m.session != nil && m.onSessionTab() }

// refreshDashboard re-probes the live snapshot on a slow beat (every ~1.2s, not
// every 300ms tick) and expires the toast. Cheap as the probes are, there is no
// reason to hammer them; the tabs update on the fast tick regardless.
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
	m.cursor = minInt(m.cursor, maxInt(len(m.snap.Services)-1, 0))
}

func (m *viewerModel) selectedService() (app.SessionServiceStatus, bool) {
	if m.cursor < 0 || m.cursor >= len(m.snap.Services) {
		return app.SessionServiceStatus{}, false
	}
	return m.snap.Services[m.cursor], true
}

// openSelectedLogs jumps from the highlighted service to the log tab, on that
// application's own sub-tab when it has written anything yet.
func (m *viewerModel) openSelectedLogs() {
	m.selectTab("logs")
	m.preferred = ""
	if svc, ok := m.selectedService(); ok {
		m.logs.SelectSubTab(svc.Name)
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

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func (m *viewerModel) View() string {
	var b strings.Builder
	b.WriteString(m.banner)
	b.WriteString(" " + m.tabsLine() + "\n\n")
	if m.onSessionTab() {
		b.WriteString(m.dashboardBody())
		return b.String()
	}
	tab := m.tabs[m.currentTab()]
	frame := viewer.Frame{Width: m.width, Height: m.bodyHeight()}
	for _, row := range m.fitRows(tab.Body(frame), frame.Height) {
		b.WriteString(row + "\n")
	}
	b.WriteString("\n " + tab.Footer() + "\n")
	return b.String()
}

// bodyHeight is how many rows fit between the tab bar and the footer.
func (m *viewerModel) bodyHeight() int {
	if body := m.height - 6; body > 0 {
		return body
	}
	return 20
}

// bodyTopRow is how many rows the banner and the tab bar occupy above the body,
// which is what turns a click's Y coordinate into a body row.
const bodyTopRow = 3

// cutMarker is the one dim character that says a row was cut. A row silently
// ending at the terminal's edge and a row that happens to be exactly that wide
// look identical, and only one of them is hiding something.
const cutMarker = "\x1b[2m…\x1b[0m"

// fitRows lays the tab's body out at this terminal's width. Every row is cut to
// the width with a marker at the cut rather than wrapped: a screen of wrapped
// lines is a screen where nothing lines up, and the columns are the whole point
// of rendering centrally. A row the reader asks for is shown in full instead,
// wrapped under the message column so the continuation reads as more of the
// same message.
func fitRows(lines []string, opts fitOptions) []string {
	rows := make([]string, 0, len(lines))
	for i, line := range lines {
		if opts.expandAll || opts.expanded[i] {
			rows = append(rows, wrapLogLine(line, opts.width)...)
			continue
		}
		rows = append(rows, cutRow(line, opts.width))
	}
	if len(rows) > opts.body {
		rows = rows[len(rows)-opts.body:]
	}
	return rows
}

// fitOptions is the terminal's shape and which rows the reader has opened.
type fitOptions struct {
	width int
	body  int
	// expanded is the body rows a click has opened, by their position on screen.
	expanded map[int]bool
	// expandAll opens every row on this tab, for a terminal that forwards no
	// clicks at all.
	expandAll bool
}

// cutRow truncates one row to the width, leaving room for the marker. A width
// of zero or less is a terminal that has not reported its size yet, and cutting
// against a guess would hide more than it showed.
func cutRow(line string, width int) string {
	if width <= 0 || ansi.StringWidth(line) <= width {
		return line
	}
	return ansi.Cut(line, 0, maxInt(width-1, 0)) + cutMarker
}

// fitRows lays out one frame with whatever this viewer's reader has opened.
func (m *viewerModel) fitRows(lines []string, body int) []string {
	return fitRows(lines, fitOptions{
		width:     m.width - 1,
		body:      body,
		expanded:  m.expandedRows,
		expandAll: m.expandAll[m.currentTab()],
	})
}

// wrapLogLine breaks one rendered line to width cells, for a row the reader
// asked to see in full. The continuation rows
// are indented to the message column so they read as more of the same message
// under the same time and lane, the way a stack trace already is. A terminal
// too narrow to leave room for a message after that column hard-wraps instead.
func wrapLogLine(line string, width int) []string {
	if width <= 0 || ansi.StringWidth(line) <= width {
		return []string{line}
	}
	room := width - logfmt.MessageColumn
	if room < 20 {
		return strings.Split(ansi.Hardwrap(line, width, true), "\n")
	}
	head := ansi.Cut(line, 0, logfmt.MessageColumn)
	rest := ansi.Cut(line, logfmt.MessageColumn, ansi.StringWidth(line))
	rows := strings.Split(ansi.Hardwrap(rest, room, true), "\n")
	indent := strings.Repeat(" ", logfmt.MessageColumn)
	out := make([]string, 0, len(rows))
	for i, row := range rows {
		if i == 0 {
			out = append(out, head+row)
			continue
		}
		out = append(out, indent+row)
	}
	return out
}

// tabsLine renders the fixed top row, the selected one inverted, each numbered
// for direct jumps.
func (m *viewerModel) tabsLine() string {
	parts := make([]string, len(viewer.TabNames))
	for i, name := range viewer.TabNames {
		label := fmt.Sprintf(" %d %s ", i+1, name)
		if i == m.selected {
			parts[i] = "\x1b[7m" + label + "\x1b[0m"
			continue
		}
		parts[i] = "\x1b[2m" + label + "\x1b[0m"
	}
	return strings.Join(parts, " ")
}
