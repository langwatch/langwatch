package cmd

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
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
// runs detached (startDetachedUp), so this is a window onto it - never a leash.
// The top row is fixed - session, logs, errors, traces, metrics, profiles,
// stores, jobs - and each tab is one datasource, which is what lets one screen
// answer the question a person actually arrived with. This file is the model
// that composes them: the frame, the key routing and the tab bar. What each tab
// knows how to do lives in cmd/viewer. q detaches (up) or destroys (play);
// nothing here can stop an `up` stack - that is `haven down`.

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
	jobs     *viewer.JobsTab
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
	session *sessionActions
	// openURL launches the highlighted service's own URL in the browser ("o"
	// or shift+enter on the session tab) - a field rather than calling
	// openInBrowser directly, the same seam viewer.Sources.Open already is
	// for the traces and profiles tabs, so a test can hand it a spy instead
	// of actually shelling out to `open`/`xdg-open`.
	openURL       func(url string) error
	snap          app.SessionReport
	cursor        int    // highlighted service row on the dashboard
	destroyOnQuit bool   // play's contract, for the dashboard footer copy
	toast         string // transient action feedback
	toastTTL      int    // refresh ticks the toast still shows for
	// confirmStop is set by the first X and cleared by anything else, so the
	// key that stops the stack always takes two deliberate presses.
	confirmStop bool
	tickN       int // refresh counter, so the snapshot polls on a slow beat
	// expandedIDs are the lines a click has opened on the tab currently on
	// screen, by the identity the tab gave them. Identity, not screen position:
	// a row opened at the bottom of a following log tab is the same line three
	// seconds later, twenty rows further up, and must still be open. Switching
	// tabs clears it.
	expandedIDs map[int64]bool
	// inSubTabs is whether the reader has gone down into the tab's own second
	// row. Two levels, because the arrows can only mean one thing at a time:
	// at the top they move between tabs, inside they move between the tab's own
	// list, and enter and escape are how you say which you meant.
	inSubTabs bool
	// hoverRow is the body row the pointer is over, so a click has a visible
	// target. -1 when the pointer is outside the body or the terminal sends no
	// motion at all.
	hoverRow int
	// rowIDs is what the last frame drew, by screen row, so a click at a Y
	// coordinate resolves to the line that was under it.
	rowIDs []int64
	// seen is when the reader last had each tab on screen. The tabs answer
	// "what is new since"; only the model knows what "since" is, because only
	// the model knows what is being looked at.
	seen map[string]time.Time
	// now is the clock behind seen. Injected, because "was this newer than the
	// last look" is a claim about two instants and a test that cannot move
	// either of them can only assert it by sleeping.
	now func() time.Time
	// expandAll opens every row of a tab, per tab, for a terminal that forwards
	// no clicks.
	expandAll map[string]bool

	width, height int
}

func newViewerModel(slug, combined, capDir string) *viewerModel {
	m := &viewerModel{
		slug:        slug,
		expandedIDs: map[int64]bool{},
		expandAll:   map[string]bool{},
		seen:        map[string]time.Time{},
		now:         time.Now,
		hoverRow:    -1,
		openURL:     openInBrowser,
		banner:      fmt.Sprintf("\x1b[1m haven up\x1b[0m \x1b[2m· %s · running in the background · q detaches (stack keeps running) · X stops it\x1b[0m\n", slug),
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
	m.jobs, _ = m.tabs["jobs"].(*viewer.JobsTab)
	// Every tab starts read. Whatever a stack did before this viewer opened is
	// history, and a tab bar lit up on frame one teaches the reader to ignore it.
	seenAt := m.now()
	for _, name := range viewer.TabNames {
		m.seen[name] = seenAt
	}
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
	// The jobs journal is read on every beat too, for the same reason the
	// capture tail is: a file in haven's own home is not the kind of poll the
	// visible-tab rule is about, and a prepare that failed while you were
	// reading traces is exactly the one the tab bar has to be able to mark.
	m.jobs.Poll()
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
			m.toggleRow(m.bodyRow(msg.Y))
		}
	case tea.MouseButtonNone:
		m.hoverRow = m.bodyRow(msg.Y)
	default:
		// Every other button/gesture is outside this viewer's scope.
	}
	return m, nil
}

// bodyRow turns a pointer's Y coordinate into a body row, or -1 when it is over
// the chrome. It measures the chrome rather than assuming it, because the frame
// and the screen only line up while the frame is exactly the terminal's height.
func (m *viewerModel) bodyRow(y int) int {
	if row := y - m.chromeHeight(); row >= 0 {
		return row
	}
	return -1
}

// toggleRow opens the line under the clicked body row in full, or closes it
// again. A click on a row with no identity of its own - a header, a drill-in -
// opens nothing, because there is no line there to keep open.
func (m *viewerModel) toggleRow(row int) {
	if row < 0 || row >= len(m.rowIDs) {
		return
	}
	id := m.rowIDs[row]
	if id == 0 {
		return
	}
	if m.expandedIDs[id] {
		delete(m.expandedIDs, id)
		return
	}
	m.expandedIDs[id] = true
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
	case "o", "shift+enter":
		m.openSelectedURL()
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
	case "enter":
		m.enterSubTabs()
	case "x":
		tab := m.currentTab()
		m.expandAll[tab] = !m.expandAll[tab]
		m.expandedIDs = map[int64]bool{}
	case "right", "l":
		m.moveSideways(1)
	case "left", "h":
		m.moveSideways(-1)
	case "tab":
		m.moveTab(1)
	case "shift+tab":
		m.moveTab(-1)
	default:
		if n := digitKey(s); n > 0 && n <= len(viewer.TabNames) {
			m.preferred = ""
			m.selected = n - 1
			m.leaveTab()
		}
	}
	return m, nil
}

// handleEscape is the universal "back out of this screen" key, once the tab on
// screen has had its own chance at it. Only the keys the banner actually names
// (q, and ctrl+c as the usual interrupt) may destroy a play sandbox.
func (m *viewerModel) handleEscape() (tea.Model, tea.Cmd) {
	if m.inSubTabs {
		m.inSubTabs = false
		return m, nil
	}
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
	m.leaveTab()
}

// moveSideways is what the arrows do at whichever level the reader is on.
func (m *viewerModel) moveSideways(delta int) {
	if sub, ok := m.subTabbed(); ok && m.inSubTabs {
		sub.MoveSubTab(delta)
		return
	}
	m.moveTab(delta)
}

// enterSubTabs goes down into a tab's own second row. A tab with no second row
// has nothing to go into, and enter stays whatever that tab made of it.
func (m *viewerModel) enterSubTabs() {
	if _, ok := m.subTabbed(); ok {
		m.inSubTabs = true
	}
}

// subTabbed is the tab on screen if it has a second row of its own.
func (m *viewerModel) subTabbed() (viewer.SubTabbed, bool) {
	tab, ok := m.tabs[m.currentTab()]
	if !ok {
		return nil, false
	}
	sub, isSub := tab.(viewer.SubTabbed)
	if !isSub || len(sub.SubTabs()) < 2 {
		return nil, false
	}
	return sub, true
}

// leaveTab forgets everything that belonged to the tab being left: which rows
// were open on it, and which level of it the reader was on.
func (m *viewerModel) leaveTab() {
	m.expandedIDs = map[int64]bool{}
	m.inSubTabs = false
}

// navFooter is the row that says which level the reader is on and what the
// arrows do there. Two levels are only navigable if the screen says which one
// you are on.
func (m *viewerModel) navFooter() string {
	sub, ok := m.subTabbed()
	switch {
	case ok && m.inSubTabs:
		return dimText("in " + sub.SelectedSubTab() + " · ←→ and [ ] move between them · esc goes back to the tabs")
	case ok:
		return dimText("←→ moves between tabs · enter goes into this tab's " + itoa(len(sub.SubTabs())) + " sub-tabs")
	}
	return dimText("←→ moves between tabs")
}

// dimText paints one string dim, the model's own half of the footer.
func dimText(text string) string { return "\x1b[2m" + text + "\x1b[0m" }

// itoa is strconv.Itoa under a shorter name, for building one footer string.
func itoa(n int) string { return strconv.Itoa(n) }

// selectTab moves to one tab by name.
func (m *viewerModel) selectTab(name string) {
	for i, tab := range viewer.TabNames {
		if tab == name {
			m.selected = i
			m.leaveTab()
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

// openSelectedURL opens the highlighted service's own URL in the browser -
// "o" or shift+enter, the session tab's other action on the highlighted row
// besides enter's "open its logs". Silent when the row has no URL at all (a
// service reached only by loopback port, not a routed hostname) or the OS
// opener could not be started - a toast for a background action nobody is
// blocked on would outlive its own usefulness.
func (m *viewerModel) openSelectedURL() {
	svc, ok := m.selectedService()
	if !ok || svc.URL == "" {
		return
	}
	open := m.openURL
	if open == nil {
		open = openInBrowser
	}
	if err := open(svc.URL); err != nil {
		m.setToast("could not open " + svc.URL)
		return
	}
	m.setToast("opened " + svc.URL)
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
	m.markSeen()
	chrome := m.chromeRows()
	if m.onSessionTab() {
		return strings.Join(m.clampToTerminal(append(chrome, m.dashboardRows()...)), "\n")
	}
	tab := m.tabs[m.currentTab()]
	footer := m.footerRows(tab.Footer() + "\n " + m.navFooter())
	header := m.headerRows(tab)
	budget := m.bodyBudget(len(footer), len(header))
	body := m.layOutBody(tab, header, budget)
	rows := make([]string, 0, len(chrome)+len(body)+1+len(footer))
	rows = append(rows, chrome...)
	rows = append(rows, body...)
	rows = append(rows, "")
	rows = append(rows, footer...)
	return strings.Join(m.clampToTerminal(rows), "\n")
}

// chromeRows is the banner, the tab bar and the blank under them, cut to the
// terminal like every other row. Cut, because a banner that wraps costs the
// body a row nobody accounted for, and the row bubbletea then drops off the top
// is the banner itself.
func (m *viewerModel) chromeRows() []string {
	return []string{
		cutRow(strings.TrimRight(m.banner, "\n"), m.width),
		cutRow(" "+m.tabsLine(), m.width),
		"",
	}
}

// chromeHeight is how many rows the chrome actually occupies, which is what
// turns a pointer's Y coordinate into a body row. Measured rather than assumed:
// a constant that stops matching the chrome sends every click to the wrong line,
// and nothing about the frame says so.
func (m *viewerModel) chromeHeight() int { return len(m.chromeRows()) }

// headerRows is what the tab pins above its output, cut to the width. Pinned
// means pinned: it is not part of the scrollable body, so no amount of
// scrolling or expanding can leave it in the middle of the output.
func (m *viewerModel) headerRows(tab viewer.Tab) []string {
	head := tab.Header()
	out := make([]string, 0, len(head))
	for _, row := range head {
		out = append(out, cutRow(row, m.width))
	}
	return out
}

// dashboardRows is the session screen as rows.
func (m *viewerModel) dashboardRows() []string {
	return strings.Split(strings.TrimRight(m.dashboardBody(), "\n"), "\n")
}

// clampToTerminal keeps a screen inside the terminal by dropping rows off the
// BOTTOM. Bubbletea keeps the last N rows of whatever it is given, so a frame
// one row too tall loses its first row - which is the banner, the one row that
// says which stack this is and how to leave it.
func (m *viewerModel) clampToTerminal(rows []string) []string {
	if m.height <= 0 || len(rows) <= m.height {
		return rows
	}
	return rows[:m.height]
}

// footerRows is the key help, wrapped to the terminal rather than cut. The
// footer is the one place a reader looks up a key they have forgotten, and its
// tail is exactly the part they had not learned yet; the body gives way for it.
func (m *viewerModel) footerRows(text string) []string {
	var out []string
	for i, line := range strings.Split(text, "\n") {
		if i == 0 {
			line = " " + line
		}
		out = append(out, hardWrap(line, m.width)...)
	}
	return out
}

// hardWrap breaks one line into as many rows as the width needs. A width of
// zero or less is a terminal that has not reported its size.
func hardWrap(line string, width int) []string {
	if width <= 0 || ansi.StringWidth(line) <= width {
		return []string{line}
	}
	return strings.Split(ansi.Hardwrap(line, width, true), "\n")
}

// bodyBudget is how many rows are left for the tab's own output once the
// chrome, the pinned header, the blank above the footer and the footer itself
// have taken theirs. It is exact, and the body is padded up to it: a frame
// shorter than the terminal leaves the previous, taller frame's rows on screen,
// which is how a pinned header came to appear twice.
func (m *viewerModel) bodyBudget(footerRows, headerRows int) int {
	if m.height <= 0 {
		return 20
	}
	if budget := m.height - m.chromeHeight() - 1 - footerRows - headerRows; budget > 0 {
		return budget
	}
	return 1
}

// layOutBody assembles the body region: the pinned header, then exactly budget
// rows of output, padded when the tab has less to say. It also records which
// line each row of the region came from, so the next click resolves against
// what is actually on screen.
func (m *viewerModel) layOutBody(tab viewer.Tab, header []string, budget int) []string {
	fitted := fitRows(tab.Body(viewer.Frame{Width: m.width, Height: budget}), fitOptions{
		width:     m.width,
		body:      budget,
		expanded:  m.expandedIDs,
		expandAll: m.expandAll[m.currentTab()],
	})
	out := make([]string, 0, len(header)+budget)
	ids := make([]int64, 0, len(header)+budget)
	for _, row := range header {
		out = append(out, row)
		ids = append(ids, 0) // pinned: there is no line here to open
	}
	for i, row := range paintRows(fitted, m.width, m.hoverRow-len(header)) {
		out = append(out, row)
		ids = append(ids, fitted[i].id)
	}
	for len(out) < len(header)+budget {
		out = append(out, "")
		ids = append(ids, 0)
	}
	m.rowIDs = ids
	return out
}

// markSeen stamps the tab on screen as read. A tab never marks itself: the
// reader is looking at it.
func (m *viewerModel) markSeen() {
	m.seen[m.currentTab()] = m.now()
}

// cutMarker is the one dim character that says a row was cut. A row silently
// ending at the terminal's edge and a row that happens to be exactly that wide
// look identical, and only one of them is hiding something.
const cutMarker = "\x1b[2m…\x1b[0m"

// The gutter and the shade. Two cells before the time column carry where the
// pointer is; the shade behind a whole block is what says several rows are one
// line. A glyph on the head alone did not: an opened record is a head and a
// column of fields, and the eye needs the block, not a bullet.
const (
	gutterWidth = 2
	// gutterPlain is a row with nothing to say about itself.
	gutterPlain = "  "
	// glyphHover, glyphOpen and glyphRest are the marks themselves, apart from
	// the color around them: the shade a block is painted on re-arms itself
	// after every reset in the row, so the painted gutter is no longer any one
	// string a reader (or a test) can look for.
	glyphHover = "·"
	glyphOpen  = "▌"
	glyphRest  = "│"
	// gutterHover marks the row under the pointer, so a click has a target.
	gutterHover = "\x1b[2m" + glyphHover + "\x1b[0m "
	// gutterOpen heads an opened block.
	gutterOpen = "\x1b[36m" + glyphOpen + "\x1b[0m "
	// gutterOpenRest runs down the rest of an opened block.
	gutterOpenRest = "\x1b[36m" + glyphRest + "\x1b[0m "
	// openShade is the background every row of an opened block is painted on:
	// dark enough to stay behind the text at any terminal theme, light enough
	// to be a block rather than a hole.
	openShade = "\x1b[48;5;236m"
	// shadeOff ends the background without touching the foreground.
	shadeOff = "\x1b[49m"
)

// fittedRow is one screen row: the text, the identity of the line it came
// from, and whether it is part of an opened block.
type fittedRow struct {
	id   int64
	text string
	// open is whether this row belongs to a line the reader opened.
	open bool
	// rest is whether it is a continuation of the row above rather than the
	// head of one.
	rest bool
}

// fitOptions is the terminal's shape and which lines the reader has opened.
type fitOptions struct {
	width int
	body  int
	// expanded is the lines a click has opened, by the identity their tab gave
	// them.
	expanded map[int64]bool
	// expandAll opens every row on this tab, for a terminal that forwards no
	// clicks at all.
	expandAll bool
}

// fitRows lays the tab's body out at this terminal's width. Every row is cut to
// the width with a marker at the cut rather than wrapped: a screen of wrapped
// lines is a screen where nothing lines up, and the columns are the whole point
// of rendering centrally. A line the reader opened is shown in full instead.
//
// The budget is honored by dropping WHOLE lines off the top, never half of an
// opened block: a block cut through the middle reads as two unrelated fragments
// and the one at the top has lost the line it belonged to.
func fitRows(rows []viewer.Row, opts fitOptions) []fittedRow {
	blocks := make([][]fittedRow, 0, len(rows))
	for _, row := range rows {
		if opts.expandAll || opts.expanded[row.ID] {
			blocks = append(blocks, expandRow(row, opts.width-gutterWidth))
			continue
		}
		blocks = append(blocks, cutBlock(row, opts.width-gutterWidth))
	}
	return keepLastBlocks(blocks, opts.body)
}

// cutBlock is one unopened line: cut to the width, and split first on any
// newline it carries. A painted row with a newline in it is one row to this
// layout and two on the terminal, so the frame ends up taller than the count
// says and the banner is what falls off the top.
func cutBlock(row viewer.Row, room int) []fittedRow {
	physical := strings.Split(row.Text, "\n")
	out := make([]fittedRow, 0, len(physical))
	for i, line := range physical {
		out = append(out, fittedRow{id: row.ID, text: cutRow(line, room), rest: i > 0})
	}
	return out
}

// keepLastBlocks takes whole blocks from the bottom until the budget is full.
// A single block too tall for the whole body is cut to fit, because showing
// nothing would be worse than showing its start.
func keepLastBlocks(blocks [][]fittedRow, budget int) []fittedRow {
	var out []fittedRow
	for i := len(blocks) - 1; i >= 0; i-- {
		if len(out)+len(blocks[i]) > budget {
			if len(out) == 0 {
				return blocks[i][:budget]
			}
			break
		}
		out = append(append([]fittedRow{}, blocks[i]...), out...)
	}
	return out
}

// expandRow lays one opened line out in full: the line itself, then its
// structured fields one per row under the message column. A line with no fields
// that already fits is unchanged - opening it says "this one", and changing
// what it says as well would make the reader find their place again.
func expandRow(row viewer.Row, room int) []fittedRow {
	head, fields := row.Parts()
	out := blockRows(row.ID, wrapLogLine(head, room), nil)
	indent := strings.Repeat(" ", logfmt.MessageColumn)
	for _, field := range fields {
		out = blockRows(row.ID, wrapLogLine(indent+field, room), out)
	}
	return out
}

// blockRows appends wrapped rows to an opened block, marking every one of them
// as part of it and the first as its head.
func blockRows(id int64, wrapped []string, into []fittedRow) []fittedRow {
	for _, text := range wrapped {
		into = append(into, fittedRow{id: id, text: text, open: true, rest: len(into) > 0})
	}
	return into
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

// paintRows prefixes each laid-out row with its gutter and, for an opened
// block, paints the whole width behind it.
func paintRows(rows []fittedRow, width, hover int) []string {
	out := make([]string, 0, len(rows))
	for i, row := range rows {
		text := gutterFor(row, i == hover) + row.text
		if row.open {
			text = shade(text, width)
		}
		out = append(out, text)
	}
	return out
}

// shade paints one row's whole width on the block background. Every reset the
// row already carries has to re-arm the background behind it, or the shade ends
// at the first colored token in the line.
func shade(text string, width int) string {
	painted := openShade + strings.ReplaceAll(text, sgrReset, sgrReset+openShade)
	if pad := width - ansi.StringWidth(text); pad > 0 {
		painted += strings.Repeat(" ", pad)
	}
	return painted + shadeOff + sgrReset
}

// sgrReset is the sequence a painted row ends every colored run with.
const sgrReset = "\x1b[0m"

// gutterFor picks one row's gutter. Open wins over hover: the pointer moves
// again in a moment, and the block it is passing over stays open.
func gutterFor(row fittedRow, hovered bool) string {
	switch {
	case row.open && row.rest:
		return gutterOpenRest
	case row.open:
		return gutterOpen
	case hovered:
		return gutterHover
	}
	return gutterPlain
}

// wrapLogLine breaks one rendered line to width cells, for a row the reader
// asked to see in full. The continuation rows
// are indented to the message column so they read as more of the same message
// under the same time and lane, the way a stack trace already is. A terminal
// too narrow to leave room for a message after that column hard-wraps instead.
func wrapLogLine(line string, width int) []string {
	if strings.Contains(line, "\n") {
		var out []string
		for _, physical := range strings.Split(line, "\n") {
			out = append(out, wrapLogLine(physical, width)...)
		}
		return out
	}
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
// for direct jumps, each carrying whatever happened on it while the reader was
// somewhere else.
func (m *viewerModel) tabsLine() string {
	parts := make([]string, len(viewer.TabNames))
	for i, name := range viewer.TabNames {
		label := fmt.Sprintf(" %d %s%s ", i+1, name, m.attentionMark(i, name))
		if i == m.selected {
			parts[i] = "\x1b[7m" + label + "\x1b[0m"
			continue
		}
		parts[i] = "\x1b[2m" + label + "\x1b[0m"
	}
	return strings.Join(parts, " ")
}

// The marks a tab off screen carries. Cyan for something new, red for
// something that failed - the same cyan the opened gutter uses, so one color
// means one thing across the whole screen.
const (
	markNotice  = "\x1b[36m•\x1b[0m"
	markFailure = "\x1b[31m•\x1b[0m"
)

// attentionMark is the dot after a tab's name. The tab on screen never carries
// one: the reader is looking at it, so there is nothing to tell them.
func (m *viewerModel) attentionMark(index int, name string) string {
	if index == m.selected {
		return ""
	}
	tab, ok := m.tabs[name]
	if !ok {
		return ""
	}
	switch tab.Attention(m.seen[name]) {
	case viewer.AttentionFailure:
		return markFailure
	case viewer.AttentionNotice:
		return markNotice
	case viewer.AttentionNone:
		return ""
	}
	return ""
}
