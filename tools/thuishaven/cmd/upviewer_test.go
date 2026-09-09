package cmd

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// dashModel builds a viewer with the session dashboard wired to a fixed
// snapshot and a restart spy - the shape both the up and play paths inject.
func dashModel(t *testing.T, services []app.SessionServiceStatus, restart func(string) (string, error)) *viewerModel {
	t.Helper()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	snap := app.SessionReport{
		Found: true, Live: true, Slug: "feat-x", Branch: "feat/x",
		Services: services,
		Servers:  []app.SessionServer{{Name: "proxy", Up: true}, {Name: "daemon", Up: true}},
	}
	m.enableDashboard(sessionActions{
		Snapshot: func() app.SessionReport { return snap },
		Restart:  restart,
	}, false)
	return m
}

func key(s string) tea.KeyMsg {
	switch s {
	case "tab":
		return tea.KeyMsg{Type: tea.KeyTab}
	case "left":
		return tea.KeyMsg{Type: tea.KeyLeft}
	case "right":
		return tea.KeyMsg{Type: tea.KeyRight}
	case "esc":
		return tea.KeyMsg{Type: tea.KeyEsc}
	case "ctrl+c":
		return tea.KeyMsg{Type: tea.KeyCtrlC}
	case "up":
		return tea.KeyMsg{Type: tea.KeyUp}
	case "down":
		return tea.KeyMsg{Type: tea.KeyDown}
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	default:
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
	}
}

// appendCapture adds one line to a lane's capture, stamped now. Appending, not
// rewriting: the file tail follows a byte offset, so a rewrite of the same
// length looks like a file that has not moved.
func appendCapture(t *testing.T, dir, lane, payload string) {
	t.Helper()
	line := time.Now().UTC().Format(time.RFC3339Nano) + " " + payload + "\n"
	file, err := os.OpenFile(filepath.Join(dir, lane+".log"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = file.Close() }()
	if _, err := file.WriteString(line); err != nil {
		t.Fatal(err)
	}
}

// writeCapture writes one capture file, stamped now so the viewer counts the
// lane as live.
func writeCapture(t *testing.T, dir, lane, payload string) {
	t.Helper()
	line := time.Now().UTC().Format(time.RFC3339Nano) + " " + payload + "\n"
	if err := os.WriteFile(filepath.Join(dir, lane+".log"), []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
}

// @scenario "Up in a terminal never holds the stack hostage"
func TestViewerQuitDetachesInsteadOfKilling(t *testing.T) {
	for _, k := range []string{"q", "esc", "ctrl+c"} {
		m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
		_, cmd := m.Update(key(k))
		if cmd == nil {
			t.Fatalf("%q must quit the viewer", k)
		}
		if msg := cmd(); msg != (tea.QuitMsg{}) {
			t.Errorf("%q returned %T, want tea.Quit - the viewer only ever detaches", k, msg)
		}
	}
}

// @scenario "The tabs are session, logs, jobs, errors, traces, metrics, profiles, stores"
func TestViewerTopRowIsFixed(t *testing.T) {
	m := dashModel(t, []app.SessionServiceStatus{{Name: "app"}}, nil)
	want := []string{"session", "logs", "jobs", "errors", "traces", "metrics", "profiles", "stores"}
	if strings.Join(viewer.TabNames, ",") != strings.Join(want, ",") {
		t.Fatalf("top row = %v, want %v", viewer.TabNames, want)
	}

	t.Run("the row is numbered for direct jumps", func(t *testing.T) {
		line := m.tabsLine()
		for i, name := range want {
			if !strings.Contains(line, strconv.Itoa(i+1)+" "+name) {
				t.Errorf("tab bar %q is missing %q numbered %d", line, name, i+1)
			}
		}
	})

	t.Run("when the developer moves between tabs", func(t *testing.T) {
		cases := []struct {
			keys []string
			want string
		}{
			{keys: []string{"right"}, want: "logs"},
			{keys: []string{"tab", "tab"}, want: "jobs"},
			{keys: []string{"left"}, want: "stores"},
			{keys: []string{"4"}, want: "errors"},
			{keys: []string{"8"}, want: "stores"},
			{keys: []string{"1"}, want: "session"},
		}
		for _, tc := range cases {
			m.selected = 0
			for _, k := range tc.keys {
				m.handleKey(k)
			}
			if got := m.currentTab(); got != tc.want {
				t.Errorf("%v landed on %q, want %q", tc.keys, got, tc.want)
			}
		}
	})
}

// @scenario "Only the visible tab polls"
func TestOnlyTheVisibleTabPolls(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	traces := &sources.MemoryTraces{}
	files := &sources.MemoryLogs{}
	m.install(viewer.Sources{
		Files: files, Traces: traces, LokiUp: func() bool { return false }, Now: time.Now,
	})

	m.selectTab("traces")
	m.ingest()
	polled := traces.Queries
	if polled == 0 {
		t.Fatal("the visible traces tab did not poll at all")
	}

	m.selectTab("logs")
	for i := 0; i < 5; i++ {
		m.ingest()
	}
	if traces.Queries != polled {
		t.Errorf("traces was polled %d more times while another tab was on screen", traces.Queries-polled)
	}

	t.Run("the capture tail keeps running whichever tab is visible", func(t *testing.T) {
		if files.Calls == 0 {
			t.Error("the local capture tail stopped - the errors tab depends on it")
		}
	})
}

// @scenario "Switching between service log groups is a keypress"
func TestLogSubTabsAreReachedByKeypress(t *testing.T) {
	dir := t.TempDir()
	writeCapture(t, dir, "ui", "vite ready")
	writeCapture(t, dir, "go", `{"service":"langwatch-service-nlpgo","level":"info","msg":"ready"}`)

	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest()
	m.selectTab("logs")

	if got := m.logs.SubTabs(); strings.Join(got, ",") != "all,ui,nlp" {
		t.Fatalf("sub-tabs = %v, want all,ui,nlp", got)
	}
	m.handleKey("]")
	if m.logs.Selected() != "ui" {
		t.Errorf("] landed on %q, want ui", m.logs.Selected())
	}
	m.handleKey("]")
	if m.logs.Selected() != "nlp" {
		t.Errorf("] landed on %q, want nlp", m.logs.Selected())
	}
	m.handleKey("[")
	if m.logs.Selected() != "ui" {
		t.Errorf("[ landed on %q, want ui", m.logs.Selected())
	}

	t.Run("the lines are colored by application with errors highlighted", func(t *testing.T) {
		writeCapture(t, dir, "backend", `{"name":"langwatch:api","level":"error","msg":"exploded"}`)
		m.ingest()
		body := strings.Join(m.logs.Lines("api"), "\n")
		if !strings.Contains(body, "\x1b[31merror") {
			t.Errorf("api lines = %q, want the error level painted red", body)
		}
	})
}

// @scenario "Switching between service log groups is a keypress"
func TestViewerDiscoversNewApplicationsLive(t *testing.T) {
	dir := t.TempDir()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest()
	if got := m.logs.SubTabs(); len(got) != 1 {
		t.Fatalf("sub-tabs = %v, want just all before any capture exists", got)
	}
	writeCapture(t, dir, "langyagent", "langy is here")
	m.ingest()
	if got := strings.Join(m.logs.SubTabs(), ","); !strings.Contains(got, "langy") {
		t.Errorf("sub-tabs = %v, want langy discovered (CLI spelling)", got)
	}
}

// A `+svc` delta opens the viewer already looking at that application.
// @scenario "Switching between service log groups is a keypress"
func TestViewerLandsOnThePreferredApplication(t *testing.T) {
	dir := t.TempDir()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.preferred = "langy"
	m.ingest()
	if m.currentTab() != "session" {
		t.Fatalf("moved to %q before the preferred application wrote anything", m.currentTab())
	}
	writeCapture(t, dir, "langyagent", "langy is here")
	m.ingest()
	if m.currentTab() != "logs" || m.logs.Selected() != "langy" {
		t.Errorf("landed on %s/%s, want logs/langy", m.currentTab(), m.logs.Selected())
	}
}

// @scenario "The session dashboard is the first thing haven up shows"
func TestSessionDashboardIsTabOne(t *testing.T) {
	m := dashModel(t, []app.SessionServiceStatus{
		{Name: "app", URL: "https://app.feat-x.langwatch.localhost", Up: true, Restartable: true},
		{Name: "nlp", Restartable: true},
	}, nil)

	if viewer.TabNames[0] != viewer.SessionTab {
		t.Fatalf("first tab = %q, want the session dashboard", viewer.TabNames[0])
	}
	if !m.onDashboard() {
		t.Fatal("haven up must open on the dashboard, not straight into a log tab")
	}
	view := m.View()
	for _, want := range []string{"[##]", "safe harbour", "SERVICES", "app", "nlp", "SHARED"} {
		if !strings.Contains(view, want) {
			t.Errorf("dashboard is missing %q\n%s", want, view)
		}
	}
}

// A viewer built without a session still opens on the session tab; it says the
// stack is provisioning rather than pretending there is nothing to show.
// @scenario "The session dashboard is the first thing haven up shows"
func TestNoSessionStillOpensOnTheSessionTab(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	if m.currentTab() != viewer.SessionTab {
		t.Errorf("first tab = %q, want the session tab", m.currentTab())
	}
	if m.onDashboard() {
		t.Error("a session-less viewer has no dashboard to drive")
	}
}

// @scenario "Arrow keys move the cursor and open a service's logs"
func TestDashboardOpensServiceLogs(t *testing.T) {
	dir := t.TempDir()
	writeCapture(t, dir, "ui", "hi from the ui")
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	snap := app.SessionReport{Found: true, Services: []app.SessionServiceStatus{
		{Name: "ui", Restartable: true}, {Name: "nlp", Restartable: true},
	}}
	m.enableDashboard(sessionActions{Snapshot: func() app.SessionReport { return snap }}, false)
	m.ingest()

	m.handleKey("down")
	if m.cursor != 1 {
		t.Fatalf("down should move to the nlp row, cursor=%d", m.cursor)
	}
	m.handleKey("up")
	if m.cursor != 0 {
		t.Fatalf("up should return to the ui row, cursor=%d", m.cursor)
	}
	m.handleKey("enter")
	if m.currentTab() != "logs" || m.logs.Selected() != "ui" {
		t.Errorf("enter on ui should open its log sub-tab, landed on %s/%s", m.currentTab(), m.logs.Selected())
	}
}

// enter on a service with no output of its own opens the combined stream.
// @scenario "Arrow keys move the cursor and open a service's logs"
func TestDashboardEnterFallsBackToCombined(t *testing.T) {
	m := dashModel(t, []app.SessionServiceStatus{{Name: "gateway", Restartable: true}}, nil)
	m.handleKey("enter")
	if m.currentTab() != "logs" || m.logs.Selected() != viewer.AllApps {
		t.Errorf("enter on a silent service should open the combined stream, landed on %s/%s",
			m.currentTab(), m.logs.Selected())
	}
}

// @scenario "Restarting a service from the dashboard bounces just that one"
func TestDashboardRestartDispatch(t *testing.T) {
	t.Run("given a restartable service under the cursor", func(t *testing.T) {
		var got []string
		m := dashModel(t, []app.SessionServiceStatus{
			{Name: "app", Restartable: true}, {Name: "gateway", Restartable: true},
		}, func(name string) (string, error) { got = append(got, name); return "bounced " + name, nil })

		m.handleKey("down") // cursor -> gateway
		cmd := m.restartSelected()
		if cmd == nil {
			t.Fatal("restarting a restartable service must dispatch a command")
		}
		msg, ok := cmd().(restartDoneMsg)
		if !ok || msg.err != nil {
			t.Fatalf("want a clean restartDoneMsg, got %#v", msg)
		}
		if len(got) != 1 || got[0] != "gateway" {
			t.Errorf("only gateway should be bounced, got %v", got)
		}
	})

	t.Run("given a managed service under the cursor", func(t *testing.T) {
		called := false
		m := dashModel(t, []app.SessionServiceStatus{{Name: "clickhouse", Restartable: false}},
			func(string) (string, error) { called = true; return "", nil })
		if cmd := m.restartSelected(); cmd != nil {
			t.Error("a non-restartable service must not dispatch a restart")
		}
		if called {
			t.Error("the restart action must not be called for a managed service")
		}
		if m.toast == "" {
			t.Error("the dashboard should explain why via a toast")
		}
	})

	t.Run("when restarting all, an empty name bounces every child", func(t *testing.T) {
		var got []string
		m := dashModel(t, []app.SessionServiceStatus{{Name: "app", Restartable: true}},
			func(name string) (string, error) { got = append(got, name); return "all bounced", nil })
		cmd := m.restartAll()
		if cmd == nil {
			t.Fatal("restart-all must dispatch a command")
		}
		cmd()
		if len(got) != 1 || got[0] != "" {
			t.Errorf(`restart-all must pass the empty "all" name, got %v`, got)
		}
	})
}

// Quitting the play viewer destroys the sandbox, and only q and ctrl+c are
// advertised as doing that. esc is the universal "back out of this screen"
// key, so it must not be a destroy key here.
func TestEscDoesNotDestroyAPlaySandbox(t *testing.T) {
	t.Run("given the play viewer, where quitting destroys everything", func(t *testing.T) {
		t.Run("when esc is pressed, it does not quit", func(t *testing.T) {
			m := newViewerModel("play-42", "", "")
			m.destroyOnQuit = true
			if _, cmd := m.Update(key("esc")); cmd != nil {
				t.Error("esc must not quit a viewer whose quit destroys the sandbox")
			}
			if m.toast == "" {
				t.Error("esc should explain which key actually quits")
			}
		})

		t.Run("when q is pressed, it still quits", func(t *testing.T) {
			m := newViewerModel("play-42", "", "")
			m.destroyOnQuit = true
			if _, cmd := m.Update(key("q")); cmd == nil {
				t.Error("q is the advertised quit key and must still work")
			}
		})
	})

	t.Run("given the up viewer, where quitting only detaches", func(t *testing.T) {
		t.Run("when esc is pressed, it detaches as before", func(t *testing.T) {
			m := newViewerModel("feat-x", "", "")
			if _, cmd := m.Update(key("esc")); cmd == nil {
				t.Error("esc should still detach a non-destructive viewer")
			}
		})
	})
}

// `haven up` leaves the stack running in the background and q only detaches, so
// the viewer needs a way to stop what it is showing. It takes two presses of an
// uppercase key, because it terminates every lane.
func TestStopKeyStopsTheStack(t *testing.T) {
	newStopViewer := func(t *testing.T, stops *int, err error) *viewerModel {
		t.Helper()
		m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
		m.enableDashboard(sessionActions{
			Snapshot: func() app.SessionReport { return app.SessionReport{} },
			Down:     func() error { *stops++; return err },
		}, false)
		return m
	}

	t.Run("given the up viewer is open", func(t *testing.T) {
		t.Run("when X is pressed once", func(t *testing.T) {
			stops := 0
			m := newStopViewer(t, &stops, nil)
			_, cmd := m.handleKey("X")
			if cmd != nil {
				t.Fatal("one press must not stop the stack")
			}
			if stops != 0 {
				t.Fatalf("stopped %d times on the first press", stops)
			}
			if m.toast == "" {
				t.Error("the first press must say what the second one will do")
			}
		})

		t.Run("when X is pressed twice", func(t *testing.T) {
			stops := 0
			m := newStopViewer(t, &stops, nil)
			m.handleKey("X")
			_, cmd := m.handleKey("X")
			if cmd == nil {
				t.Fatal("the second press must stop the stack")
			}
			msg := cmd()
			if stops != 1 {
				t.Fatalf("stopped %d times, want 1", stops)
			}
			if done, ok := msg.(stopDoneMsg); !ok || done.err != nil {
				t.Fatalf("expected a clean stopDoneMsg, got %#v", msg)
			}
		})

		t.Run("when another key comes between the two presses", func(t *testing.T) {
			stops := 0
			m := newStopViewer(t, &stops, nil)
			m.handleKey("X")
			m.handleKey("tab")
			_, cmd := m.handleKey("X")
			if cmd != nil {
				t.Fatal("an intervening key must cancel the confirmation, not arm it")
			}
			if stops != 0 {
				t.Fatalf("stopped %d times without a confirmed second press", stops)
			}
		})
	})

	t.Run("given the play viewer, where q already destroys the sandbox", func(t *testing.T) {
		t.Run("when X is pressed", func(t *testing.T) {
			stops := 0
			m := newViewerModel("play-1", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
			m.enableDashboard(sessionActions{
				Snapshot: func() app.SessionReport { return app.SessionReport{} },
				Down:     func() error { stops++; return nil },
			}, true)
			m.handleKey("X")
			m.handleKey("X")
			if stops != 0 {
				t.Fatalf("the play viewer has one quit contract; X stopped it %d times", stops)
			}
		})
	})
}

// A stop that failed must keep the viewer open with the reason on screen:
// quitting anyway would leave the stack running with nothing watching it.
func TestFailedStopKeepsTheViewerOpen(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	_, cmd := m.Update(stopDoneMsg{err: errStopFailed})
	if cmd != nil {
		t.Fatal("a failed stop must not quit the viewer")
	}
	if !strings.Contains(m.toast, "stop failed") {
		t.Errorf("toast = %q, want the failure named", m.toast)
	}
}

var errStopFailed = errors.New(`no registered stack "feat-x"`)

// @scenario "Existing bindings keep working"
func TestViewerExistingBindingsUnaffectedByTheTabs(t *testing.T) {
	dir := t.TempDir()
	writeCapture(t, dir, "ui", "hi")
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest()

	m.handleKey("2")
	if m.currentTab() != "logs" {
		t.Fatalf("digit jump broken, landed on %q", m.currentTab())
	}
	m.handleKey("left")
	if m.currentTab() != "session" {
		t.Fatalf("left-cycle broken, landed on %q", m.currentTab())
	}
	m.handleKey("tab")
	if m.currentTab() != "logs" {
		t.Fatalf("tab-cycle broken, landed on %q", m.currentTab())
	}

	if _, cmd := m.handleKey("q"); cmd == nil {
		t.Error("q must still detach")
	}
	m2 := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	if _, cmd := m2.handleKey("ctrl+c"); cmd == nil {
		t.Error("ctrl+c must still detach")
	}

	stops := 0
	m3 := dashModel(t, []app.SessionServiceStatus{{Name: "app", Restartable: true}}, nil)
	m3.session.Down = func() error { stops++; return nil }
	m3.handleKey("X")
	_, cmd := m3.handleKey("X")
	if cmd == nil || stops != 0 {
		t.Fatal("X twice must dispatch a stop")
	}
	cmd()
	if stops != 1 {
		t.Fatalf("stops = %d, want 1 after the confirmed X", stops)
	}

	m3.handleKey("down")
	if m3.cursor != 0 {
		t.Error("the dashboard's own down binding must still move the cursor, not scroll")
	}
}

// A capture left behind by a lane that no longer runs (a retired lane name,
// an earlier selection) is not a sub-tab; `haven logs` still reads it.
// @scenario "Captures from lanes that no longer run are not tabs"
func TestViewerHidesStaleCaptures(t *testing.T) {
	dir := t.TempDir()
	stale := time.Now().Add(-2 * time.Hour)
	for _, lane := range []string{"api", "workers"} {
		path := filepath.Join(dir, lane+".log")
		if err := os.WriteFile(path, []byte(stale.UTC().Format(time.RFC3339Nano)+" old\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(path, stale, stale); err != nil {
			t.Fatal(err)
		}
	}
	writeCapture(t, dir, "backend", `{"name":"langwatch:api","level":"info","msg":"hello from backend"}`)

	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest()
	if got := strings.Join(m.logs.Lines("api"), "\n"); strings.Contains(got, "old") {
		t.Fatalf("api lines = %q, want nothing from a capture written hours before the viewer opened", got)
	}
	if got := strings.Join(m.logs.Lines("api"), "\n"); !strings.Contains(got, "hello from backend") {
		t.Fatalf("api lines = %q, want the live backend lane's line", got)
	}
	if got := m.logs.SubTabs(); strings.Join(got, ",") != "all,api" {
		t.Fatalf("sub-tabs = %v, want the stale lanes absent", got)
	}
}

// rows builds a body of identified rows, the way a tab hands one to the model.
func rows(lines ...string) []viewer.Row {
	out := make([]viewer.Row, 0, len(lines))
	for i, line := range lines {
		out = append(out, viewer.Row{ID: int64(i + 1), Text: line})
	}
	return out
}

// wideLine is one rendered line far wider than any terminal under test.
func wideLine() string {
	return logfmt.Render(
		`{"level":"info","msg":"`+strings.Repeat("word ", 40)+`"}`,
		logfmt.Options{Lane: "backend", Time: time.Date(2026, 9, 9, 22, 30, 0, 0, time.UTC)},
	)
}

// fitted lays a body out the way the model does, for the tests that assert on
// the layout rather than on the whole frame.
func fitted(m *viewerModel, body []viewer.Row, budget int) []string {
	return m.layOutBody(stubTab{body: body}, nil, budget)
}

// stubTab is a tab with a fixed body and nothing else, for layout tests.
type stubTab struct {
	body   []viewer.Row
	header []string
}

func (s stubTab) Name() string                         { return "logs" }
func (s stubTab) Poll()                                {}
func (s stubTab) Header() []string                     { return s.header }
func (s stubTab) Body(viewer.Frame) []viewer.Row       { return s.body }
func (s stubTab) Footer() string                       { return "footer" }
func (s stubTab) Key(string) bool                      { return false }
func (s stubTab) Rows() any                            { return s.body }
func (s stubTab) Attention(time.Time) viewer.Attention { return viewer.AttentionNone }

// @scenario "A line wider than the terminal is cut, not wrapped"
func TestWideRowsAreCutNotWrapped(t *testing.T) {
	body := rows(wideLine(), "22:30:01.000  backend    info   last")
	laid := fitRows(body, fitOptions{width: 60, body: 10, expanded: map[int64]bool{}})

	if len(laid) != 2 {
		t.Fatalf("rows = %d, want one row per line - a wide line must not become several", len(laid))
	}
	for i, row := range paintRows(laid, 60, -1) {
		if ansi.StringWidth(row) > 60 {
			t.Errorf("row %d is %d cells wide: %q", i, ansi.StringWidth(row), row)
		}
	}
	if !strings.HasSuffix(laid[0].text, cutMarker) {
		t.Errorf("cut row = %q, want a marker where it was cut", laid[0].text)
	}
	if strings.HasSuffix(laid[1].text, cutMarker) {
		t.Errorf("row %q fits and must carry no marker", laid[1].text)
	}

	t.Run("when the terminal has not reported its size", func(t *testing.T) {
		laid := fitRows(rows(wideLine()), fitOptions{width: 0, body: 10, expanded: map[int64]bool{}})
		if len(laid) != 1 || laid[0].text != wideLine() {
			t.Errorf("rows = %v, want the line untouched until the width is known", laid)
		}
	})

	t.Run("the newest rows are the ones kept", func(t *testing.T) {
		laid := fitRows(rows("one", "two", "three", "four"),
			fitOptions{width: 60, body: 2, expanded: map[int64]bool{}})
		if len(laid) != 2 || laid[1].text != "four" {
			t.Errorf("rows = %v, want the last two", laid)
		}
	})
}

// expandingModel is a viewer sized to a narrow terminal, on a tab whose rows
// carry identity.
func expandingModel(t *testing.T) *viewerModel {
	t.Helper()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	m.width, m.height = 63, 30
	return m
}

// openRows is how many rows of a laid-out body belong to opened blocks.
func openRows(painted []string) int {
	count := 0
	for _, row := range painted {
		if strings.Contains(row, openShade) {
			count++
		}
	}
	return count
}

// @scenario "Clicking a row opens it in full, and clicking again closes it"
func TestClickingARowExpandsIt(t *testing.T) {
	m := expandingModel(t)
	body := rows(wideLine())

	if got := openRows(fitted(m, body, 20)); got != 0 {
		t.Fatalf("%d rows are open before any click", got)
	}

	t.Run("when the developer clicks that row", func(t *testing.T) {
		m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: m.chromeHeight()})
		painted := fitted(m, body, 20)
		if openRows(painted) < 2 {
			t.Fatalf("open rows = %d after the click, want the line shown in full", openRows(painted))
		}
		indent := strings.Repeat(" ", logfmt.MessageColumn)
		if !strings.Contains(painted[1], indent) {
			t.Errorf("continuation row %q is not indented to the message column", painted[1])
		}
	})

	t.Run("when the developer clicks it again", func(t *testing.T) {
		m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: m.chromeHeight()})
		if got := openRows(fitted(m, body, 20)); got != 0 {
			t.Errorf("open rows = %d after the second click, want the row closed again", got)
		}
	})

	t.Run("a click above the body opens nothing", func(t *testing.T) {
		m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: 0})
		if got := openRows(fitted(m, body, 20)); got != 0 {
			t.Errorf("open rows = %d, want a click on the tab bar to open nothing", got)
		}
	})
}

// @scenario "An opened line stays open as the view scrolls"
func TestExpansionFollowsTheLineNotTheScreenRow(t *testing.T) {
	m := expandingModel(t)
	body := rows("22:30:00.000  backend    info   first", wideLine())

	fitted(m, body, 20)
	m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: m.chromeHeight() + 1})
	if openRows(fitted(m, body, 20)) < 2 {
		t.Fatal("the clicked line did not open")
	}

	t.Run("when new output pushes the line to another row", func(t *testing.T) {
		moved := append(rows("22:30:02.000  backend    info   newer"), body...)
		for i := range moved {
			moved[i].ID = int64(i + 10)
		}
		moved[2].ID = 2 // the same line as before, drawn one row further down
		painted := fitted(m, moved, 20)
		if !strings.Contains(painted[2], glyphOpen) {
			t.Errorf("row %q does not head an opened block", painted[2])
		}
		if strings.Contains(painted[1], glyphOpen) {
			t.Errorf("row %q opened instead - expansion followed the screen row, not the line", painted[1])
		}
	})
}

// @scenario "The row under the pointer is marked, so a click has a target"
func TestHoverMarksTheRowUnderThePointer(t *testing.T) {
	m := expandingModel(t)
	body := rows("22:30:00.000  backend    info   first", "22:30:01.000  backend    info   second")

	if painted := fitted(m, body, 20); strings.Contains(strings.Join(painted, "\n"), gutterHover) {
		t.Fatal("a row is marked before the pointer has been anywhere")
	}

	m.Update(tea.MouseMsg{Button: tea.MouseButtonNone, Action: tea.MouseActionMotion, Y: m.chromeHeight() + 1})
	painted := fitted(m, body, 20)
	if !strings.HasPrefix(painted[1], gutterHover) {
		t.Errorf("row under the pointer = %q, want a marker in the gutter", painted[1])
	}
	if strings.HasPrefix(painted[0], gutterHover) {
		t.Errorf("row %q is marked and the pointer is not on it", painted[0])
	}

	t.Run("when the pointer leaves the body", func(t *testing.T) {
		m.Update(tea.MouseMsg{Button: tea.MouseButtonNone, Action: tea.MouseActionMotion, Y: 0})
		if strings.Contains(strings.Join(fitted(m, body, 20), "\n"), gutterHover) {
			t.Error("a row is still marked with the pointer over the tab bar")
		}
	})
}

// @scenario "An opened line is marked in the gutter and reads as one block"
func TestAnOpenedBlockIsMarkedInTheGutter(t *testing.T) {
	m := expandingModel(t)
	body := rows(wideLine())
	fitted(m, body, 20)
	m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: m.chromeHeight()})

	painted := fitted(m, body, 20)
	open := openRows(painted)
	if open < 3 {
		t.Fatalf("open rows = %d, want a block of several rows", open)
	}
	if !strings.Contains(painted[0], glyphOpen) {
		t.Errorf("head row = %q, want the head glyph in the gutter", painted[0])
	}
	for i := 1; i < open; i++ {
		if !strings.Contains(painted[i], glyphRest) {
			t.Errorf("row %d = %q, want the bar joining it to the head", i, painted[i])
		}
	}

	t.Run("every row of the block carries the shade, across the whole width", func(t *testing.T) {
		for i := 0; i < open; i++ {
			if !strings.HasPrefix(painted[i], openShade) {
				t.Errorf("row %d = %q, want the block background", i, painted[i])
			}
			if ansi.StringWidth(painted[i]) != m.width {
				t.Errorf("row %d is %d cells wide, want the shade to run the full %d", i, ansi.StringWidth(painted[i]), m.width)
			}
		}
	})

	t.Run("a row outside the block carries neither", func(t *testing.T) {
		if strings.Contains(painted[open], openShade) {
			t.Errorf("row %d = %q, want the shade to stop at the block", open, painted[open])
		}
	})
}

// @scenario "An opened line lists its fields one per row"
func TestAnOpenedLineListsItsFieldsOnePerRow(t *testing.T) {
	source := `{"level":"warn","msg":"statusprobe_control_plane_unreachable",` +
		`"caller":"statusprobe/monitor.go:175","error":"connection refused"}`
	painted := logfmt.Render(source, logfmt.Options{
		Lane: "gateway", Time: time.Date(2026, 9, 9, 23, 42, 4, 0, time.UTC), Color: true,
	})
	row := viewer.Row{ID: 1, Text: painted, Source: source}

	laid := fitRows([]viewer.Row{row}, fitOptions{width: 200, body: 20, expandAll: true, expanded: map[int64]bool{}})
	if len(laid) != 3 {
		t.Fatalf("rows = %d, want the line and one row per field", len(laid))
	}
	if !strings.Contains(laid[0].text, "statusprobe_control_plane_unreachable") {
		t.Errorf("head row = %q, want the message", laid[0].text)
	}
	if strings.Contains(laid[0].text, "caller=") {
		t.Errorf("head row = %q, want the fields moved off it", laid[0].text)
	}

	fields := []struct {
		row  int
		want string
	}{
		{row: 1, want: "caller=statusprobe/monitor.go:175"},
		{row: 2, want: `error="connection refused"`},
	}
	indent := strings.Repeat(" ", logfmt.MessageColumn)
	for _, tc := range fields {
		if !strings.Contains(stripPaint(laid[tc.row].text), tc.want) {
			t.Errorf("row %d = %q, want %q in the order it was written", tc.row, laid[tc.row].text, tc.want)
		}
		if !strings.HasPrefix(stripPaint(laid[tc.row].text), indent) {
			t.Errorf("row %d = %q, want it under the message column", tc.row, laid[tc.row].text)
		}
	}

	t.Run("given a line with no fields that already fits", func(t *testing.T) {
		plain := "22:30:00.000  backend    info   short"
		laid := fitRows(rows(plain), fitOptions{width: 200, body: 20, expandAll: true, expanded: map[int64]bool{}})
		if len(laid) != 1 || laid[0].text != plain {
			t.Errorf("rows = %v, want opening it to change nothing but the marking", laid)
		}
	})
}

// stripPaint removes escape sequences so an assertion reads what a person sees.
func stripPaint(line string) string {
	var b strings.Builder
	for i := 0; i < len(line); i++ {
		if line[i] != 0x1b {
			b.WriteByte(line[i])
			continue
		}
		for i < len(line) && (line[i] < 'a' || line[i] > 'z') && (line[i] < 'A' || line[i] > 'Z') {
			i++
		}
	}
	return b.String()
}

// @scenario "x opens every row on the tab, for a terminal that forwards no clicks"
func TestXExpandsEveryRowOnTheTab(t *testing.T) {
	m := expandingModel(t)
	body := rows(wideLine())
	m.selectTab("logs")

	m.handleKey("x")
	if got := openRows(fitted(m, body, 20)); got < 2 {
		t.Fatalf("open rows = %d after x, want every row opened in full", got)
	}

	t.Run("when the developer moves to another tab", func(t *testing.T) {
		m.selectTab("traces")
		if got := openRows(fitted(m, body, 20)); got != 0 {
			t.Errorf("open rows = %d, want the setting to belong to the tab it was made on", got)
		}
	})

	t.Run("when x is pressed again on the original tab", func(t *testing.T) {
		m.selectTab("logs")
		m.handleKey("x")
		if got := openRows(fitted(m, body, 20)); got != 0 {
			t.Errorf("open rows = %d after the second x, want the rows cut again", got)
		}
	})
}

func TestWrapLogLineIndentsContinuationToTheMessageColumn(t *testing.T) {
	line := logfmt.Render(
		`{"level":"info","msg":"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen"}`,
		logfmt.Options{Lane: "backend", Time: time.Date(2026, 9, 9, 22, 30, 0, 0, time.UTC)},
	)
	rows := wrapLogLine(line, 60)
	if len(rows) < 2 {
		t.Fatalf("expected the line to wrap, got %d row(s): %q", len(rows), rows)
	}
	indent := strings.Repeat(" ", logfmt.MessageColumn)
	for i, row := range rows {
		if ansi.StringWidth(row) > 60 {
			t.Fatalf("row %d is %d cells wide: %q", i, ansi.StringWidth(row), row)
		}
		if i > 0 && !strings.HasPrefix(row, indent) {
			t.Fatalf("row %d is not indented to the message column: %q", i, row)
		}
		if i > 0 && strings.HasPrefix(strings.TrimPrefix(row, indent), " ") {
			t.Fatalf("row %d starts with a stray space: %q", i, row)
		}
	}
	if !strings.Contains(rows[0], "  backend    info   one") {
		t.Fatalf("first row lost its columns: %q", rows[0])
	}
}

func TestWrapLogLineLeavesNarrowLinesAlone(t *testing.T) {
	line := "22:30:00.000  backend    info   short"
	if rows := wrapLogLine(line, 80); len(rows) != 1 || rows[0] != line {
		t.Fatalf("narrow line changed: %q", rows)
	}
	if rows := wrapLogLine(line, 0); len(rows) != 1 || rows[0] != line {
		t.Fatalf("unsized terminal changed the line: %q", rows)
	}
}

// The frame bubbletea is handed must fit the terminal. It keeps the LAST rows
// of whatever it gets, so one row too many costs the banner - the row that says
// which stack this is and how to leave it.
// @scenario "The frame is never taller than the terminal, so the banner stays"
func TestTheFrameNeverOutgrowsTheTerminal(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 40; i++ {
		appendCapture(t, dir, "ui", `{"level":"info","msg":"`+strings.Repeat("word ", 30)+strconv.Itoa(i)+`"}`)
	}
	m := newViewerModel("a-very-long-worktree-slug-indeed", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest()
	m.selectTab("logs")

	for _, size := range []struct{ width, height int }{{width: 60, height: 14}, {width: 40, height: 14}, {width: 200, height: 30}} {
		t.Run("given a terminal of that size", func(t *testing.T) {
			m.Update(tea.WindowSizeMsg{Width: size.width, Height: size.height})
			lines := strings.Split(m.View(), "\n")
			if len(lines) > size.height {
				t.Errorf("frame = %d lines at height %d - bubbletea drops the top, which is the banner", len(lines), size.height)
			}
			if !strings.Contains(lines[0], "haven up") {
				t.Errorf("first line = %q, want the banner", lines[0])
			}
			for i, line := range lines {
				if ansi.StringWidth(line) > size.width {
					t.Errorf("line %d is %d cells wide at width %d: %q", i, ansi.StringWidth(line), size.width, line)
				}
			}
		})
	}
}

// @scenario "A tab with something new since it was last seen is marked"
func TestATabWithSomethingNewIsMarked(t *testing.T) {
	clock := time.Now()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	m.now = func() time.Time { return clock }
	files := &sources.MemoryLogs{}
	jobs := &sources.MemoryJobs{}
	m.install(viewer.Sources{Files: files, Jobs: jobs, LokiUp: func() bool { return false }, Now: time.Now})
	m.width, m.height = 200, 30
	m.selectTab("logs")
	m.View() // the reader is on logs, so everything is now read

	later := clock.Add(time.Second)
	jobs.History = []sources.JobRun{{Name: "prepare", At: later, Exit: 1}}
	files.Append(sources.LogLine{At: later, Lane: "backend", Level: "error",
		Text: `{"name":"langwatch:api","level":"error","msg":"exploded"}`})
	m.ingest()

	bar := m.tabsLine()
	if !strings.Contains(bar, "jobs"+markFailure) {
		t.Errorf("tab bar = %q, want the failed job marked as a failure", bar)
	}
	if !strings.Contains(bar, "errors"+markFailure) {
		t.Errorf("tab bar = %q, want the new error signature marked", bar)
	}

	t.Run("the tab on screen never marks itself", func(t *testing.T) {
		if strings.Contains(bar, "logs"+markFailure) || strings.Contains(bar, "logs"+markNotice) {
			t.Errorf("tab bar = %q, want the tab being read to carry no mark", bar)
		}
	})

	t.Run("a change that did not fail is marked apart from one that did", func(t *testing.T) {
		quiet := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
		quiet.now = func() time.Time { return clock }
		ok := &sources.MemoryJobs{}
		quiet.install(viewer.Sources{Files: &sources.MemoryLogs{}, Jobs: ok, LokiUp: func() bool { return false }, Now: time.Now})
		quiet.width, quiet.height = 200, 30
		quiet.selectTab("logs")
		quiet.View()
		ok.History = []sources.JobRun{{Name: "seed", At: later}}
		quiet.ingest()
		if !strings.Contains(quiet.tabsLine(), "jobs"+markNotice) {
			t.Errorf("tab bar = %q, want a finished run marked without alarm", quiet.tabsLine())
		}
	})
}

// @scenario "Entering the tab clears its mark"
func TestEnteringATabClearsItsMark(t *testing.T) {
	clock := time.Now()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	m.now = func() time.Time { return clock }
	jobs := &sources.MemoryJobs{}
	m.install(viewer.Sources{Files: &sources.MemoryLogs{}, Jobs: jobs, LokiUp: func() bool { return false }, Now: time.Now})
	m.width, m.height = 200, 30
	m.selectTab("logs")
	m.View()

	jobs.History = []sources.JobRun{{Name: "prepare", At: clock.Add(time.Second), Exit: 1}}
	m.ingest()
	if !strings.Contains(m.tabsLine(), "jobs"+markFailure) {
		t.Fatal("the jobs tab was not marked in the first place")
	}

	clock = clock.Add(2 * time.Second) // the reader arrives after the job finished
	m.selectTab("jobs")
	m.View()
	m.selectTab("logs")
	if strings.Contains(m.tabsLine(), "jobs"+markFailure) {
		t.Errorf("tab bar = %q, want the mark cleared by reading the tab", m.tabsLine())
	}

	t.Run("and returns for something newer still", func(t *testing.T) {
		jobs.History = append(jobs.History, sources.JobRun{Name: "seed", At: clock.Add(time.Hour), Exit: 2})
		m.ingest()
		if !strings.Contains(m.tabsLine(), "jobs"+markFailure) {
			t.Errorf("tab bar = %q, want a newer failure to mark it again", m.tabsLine())
		}
	})
}

// A frame shorter than the terminal leaves the previous, taller frame's rows on
// screen - which is how the pinned sub-tab header came to appear twice, once
// where it belongs and once in the middle of the output.
// @scenario "The body is exactly the rows the terminal has, in every state"
func TestTheBodyIsExactlyTheRowsTheTerminalHas(t *testing.T) {
	newTab := func(t *testing.T, width, height int) *viewerModel {
		t.Helper()
		dir := t.TempDir()
		m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
		m.width, m.height = width, height
		m.selectTab("logs")
		for i := 0; i < 60; i++ {
			level := "info"
			if i%5 == 0 {
				level = "warn"
			}
			appendCapture(t, dir, "ui", `{"level":"`+level+`","msg":"`+strings.Repeat("word ", 20)+strconv.Itoa(i)+`"}`)
			m.ingest()
		}
		return m
	}

	cases := []struct {
		name   string
		width  int
		height int
		set    func(m *viewerModel)
	}{
		{name: "following", width: 100, height: 24, set: func(*viewerModel) {}},
		{name: "scrolled back", width: 100, height: 24, set: func(m *viewerModel) { m.handleKey("b") }},
		{name: "filtered to warnings", width: 100, height: 24, set: func(m *viewerModel) { m.handleKey("w") }},
		{name: "one line opened", width: 100, height: 24, set: func(m *viewerModel) {
			m.View()
			m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: m.chromeHeight() + 2})
		}},
		{name: "every line opened", width: 100, height: 24, set: func(m *viewerModel) { m.handleKey("x") }},
		{name: "a narrow terminal", width: 40, height: 24, set: func(m *viewerModel) {}},
		{name: "a short terminal", width: 100, height: 12, set: func(m *viewerModel) { m.handleKey("x") }},
		// The ui lane writes records whose msg carries its own newlines - the
		// Vite banner is three lines in one record. A row holding a newline is
		// one row to the layout and three on the terminal, so the frame is
		// taller than it counts and the banner falls off the top.
		{name: "a record whose message carries its own newlines", width: 100, height: 24, set: func(m *viewerModel) {
			m.logs.Observe(sources.LogLine{At: time.Now(), Lane: "ui", Level: "info", Text: `{"level":"info","msg":"VITE v8.1.2  ready in 412 ms

  ➜  Local:   https://app.feat-x.langwatch.localhost/
  ➜  Network: use --host to expose"}`})
			m.logs.Observe(sources.LogLine{At: time.Now(), Lane: "ui", Level: "error",
				Text: `{"level":"error","msg":"boom","stack":"at one (a.ts:1)
at two (b.ts:2)
at three (c.ts:3)"}`})
		}},
	}
	for _, tc := range cases {
		t.Run("when the logs tab is drawn "+tc.name, func(t *testing.T) {
			m := newTab(t, tc.width, tc.height)
			tc.set(m)
			lines := strings.Split(m.View(), "\n")

			if len(lines) != tc.height {
				t.Errorf("frame = %d lines, want exactly the terminal's %d", len(lines), tc.height)
			}
			if headers := countHeaders(lines); headers != 1 {
				t.Errorf("the sub-tab header appears %d times, want once", headers)
			}
			if !strings.Contains(lines[m.chromeHeight()], "all") {
				t.Errorf("row %d = %q, want the header pinned to the top of the body", m.chromeHeight(), lines[m.chromeHeight()])
			}
			for i, line := range lines {
				if ansi.StringWidth(line) > tc.width {
					t.Errorf("line %d is %d cells wide, want at most %d: %q", i, ansi.StringWidth(line), tc.width, line)
				}
				if strings.Contains(line, "\n") {
					t.Errorf("line %d carries a newline, so it paints as several rows: %q", i, line)
				}
			}
		})
	}
}

// countHeaders counts the rows that carry the logs tab's application sub-tabs.
func countHeaders(lines []string) int {
	count := 0
	for _, line := range lines {
		plain := stripPaint(line)
		if strings.Contains(plain, " all ") && strings.Contains(plain, " ui ") {
			count++
		}
	}
	return count
}

// With the frame exactly the terminal's height, screen row Y and frame row Y
// are the same row, and a click lands on the line the reader pointed at.
// @scenario "A click opens the line that was drawn at that row"
func TestAClickOpensTheLineDrawnAtThatRow(t *testing.T) {
	dir := t.TempDir()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.width, m.height = 120, 20
	m.selectTab("logs")
	for i := 0; i < 40; i++ {
		appendCapture(t, dir, "ui", `{"level":"info","msg":"line `+strconv.Itoa(i)+`"}`)
		m.ingest()
	}

	t.Run("given a scrolled-back view with one line already opened", func(t *testing.T) {
		m.handleKey("b")
		m.View()
		first := m.chromeHeight() + 2
		m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: first})

		lines := strings.Split(m.View(), "\n")
		target := drawnRow(lines, m.chromeHeight()+1)
		want := payloadOf(lines[target])
		m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: target})

		opened := strings.Split(m.View(), "\n")[target]
		if !strings.Contains(stripPaint(opened), want) {
			t.Errorf("the click at row %d opened %q, want the line drawn there: %q", target, stripPaint(opened), want)
		}
		if !strings.Contains(opened, openShade) {
			t.Errorf("row %d = %q, want it opened", target, opened)
		}
	})
}

// drawnRow is the first body row from `from` that actually has a line on it and
// is not already opened - the row a reader would point at.
func drawnRow(lines []string, from int) int {
	for i := from; i < len(lines); i++ {
		if strings.TrimSpace(stripPaint(lines[i])) != "" && !strings.Contains(lines[i], openShade) {
			return i
		}
	}
	return from
}

// payloadOf is the "line N" a rendered row carries, which is what identifies it.
func payloadOf(row string) string {
	fields := strings.Fields(stripPaint(row))
	if len(fields) < 2 {
		return ""
	}
	return strings.Join(fields[len(fields)-2:], " ")
}

// subTabModel is a viewer on the logs tab with two applications behind it.
func subTabModel(t *testing.T) *viewerModel {
	t.Helper()
	dir := t.TempDir()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.width, m.height = 120, 24
	appendCapture(t, dir, "ui", `{"level":"info","msg":"vite ready"}`)
	appendCapture(t, dir, "go", `{"service":"langwatch-service-nlpgo","level":"info","msg":"ready"}`)
	m.ingest()
	m.selectTab("logs")
	return m
}

// @scenario "Enter goes into a tab's sub-tabs and escape comes back up"
func TestEnterGoesIntoSubTabsAndEscapeComesBackUp(t *testing.T) {
	m := subTabModel(t)

	t.Run("at the top level the footer offers the way in", func(t *testing.T) {
		if !strings.Contains(stripPaint(m.navFooter()), "enter goes into this tab's") {
			t.Errorf("footer = %q, want it to name enter", m.navFooter())
		}
	})

	m.handleKey("enter")
	if !m.inSubTabs {
		t.Fatal("enter did not go into the logs tab's sub-tabs")
	}
	t.Run("inside, the footer says so and names the way out", func(t *testing.T) {
		footer := stripPaint(m.navFooter())
		if !strings.Contains(footer, "in "+m.logs.Selected()) || !strings.Contains(footer, "esc goes back") {
			t.Errorf("footer = %q, want the level and the way out", footer)
		}
	})

	m.handleKey("esc")
	if m.inSubTabs {
		t.Fatal("esc did not come back up to the tabs")
	}
	t.Run("and esc from the top level still detaches", func(t *testing.T) {
		if _, cmd := m.handleKey("esc"); cmd == nil {
			t.Error("esc at the top level must still leave the viewer")
		}
	})

	t.Run("given a tab with no sub-tabs", func(t *testing.T) {
		m.selectTab("stores")
		m.handleKey("enter")
		if m.inSubTabs {
			t.Error("the stores tab has no second level to go into")
		}
		if strings.Contains(stripPaint(m.navFooter()), "enter goes into") {
			t.Errorf("footer = %q, want it to offer nothing that is not there", m.navFooter())
		}
	})
}

// @scenario "Arrows move sub-tabs only inside the tab"
func TestArrowsMoveSubTabsOnlyInsideTheTab(t *testing.T) {
	m := subTabModel(t)

	t.Run("at the top level the arrows move between tabs", func(t *testing.T) {
		m.handleKey("right")
		if m.currentTab() != "jobs" {
			t.Errorf("right landed on %q, want the next tab", m.currentTab())
		}
		m.handleKey("left")
	})

	m.handleKey("enter")
	before := m.logs.Selected()
	m.handleKey("right")
	if m.currentTab() != "logs" {
		t.Errorf("the top row moved to %q while inside the tab", m.currentTab())
	}
	if m.logs.Selected() == before {
		t.Errorf("the application stayed on %q, want the arrows to move it", before)
	}
	m.handleKey("left")
	if m.logs.Selected() != before {
		t.Errorf("left landed on %q, want it back on %q", m.logs.Selected(), before)
	}

	t.Run("the bracket keys still work from either level", func(t *testing.T) {
		m.handleKey("]")
		if m.logs.Selected() == before {
			t.Error("] did not move the application")
		}
		m.handleKey("[")
	})

	t.Run("tab still moves between the tabs from inside", func(t *testing.T) {
		m.handleKey("tab")
		if m.currentTab() != "jobs" {
			t.Errorf("tab landed on %q, want the next tab", m.currentTab())
		}
		if m.inSubTabs {
			t.Error("leaving the tab must leave its level too")
		}
	})
}
