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
// snapshot and a restart spy — the shape both the up and play paths inject.
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
			t.Errorf("%q returned %T, want tea.Quit — the viewer only ever detaches", k, msg)
		}
	}
}

// @scenario "The tabs are session, logs, errors, traces, metrics, profiles, stores, jobs"
func TestViewerTopRowIsFixed(t *testing.T) {
	m := dashModel(t, []app.SessionServiceStatus{{Name: "app"}}, nil)
	want := []string{"session", "logs", "errors", "traces", "metrics", "profiles", "stores", "jobs"}
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
			{keys: []string{"tab", "tab"}, want: "errors"},
			{keys: []string{"left"}, want: "jobs"},
			{keys: []string{"4"}, want: "traces"},
			{keys: []string{"8"}, want: "jobs"},
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

// @scenario "A line wider than the terminal is cut, not wrapped"
func TestWideRowsAreCutNotWrapped(t *testing.T) {
	wide := "22:30:00.000  backend    info   " + strings.Repeat("word ", 40)
	rows := fitRows([]string{wide, "22:30:01.000  backend    info   last"},
		fitOptions{width: 60, body: 10, expanded: map[int]bool{}})

	if len(rows) != 2 {
		t.Fatalf("rows = %d, want one row per line - a wide line must not become several", len(rows))
	}
	for i, row := range rows {
		if ansi.StringWidth(row) > 60 {
			t.Errorf("row %d is %d cells wide: %q", i, ansi.StringWidth(row), row)
		}
	}
	if !strings.HasSuffix(rows[0], cutMarker) {
		t.Errorf("cut row = %q, want a marker where it was cut", rows[0])
	}
	if strings.HasSuffix(rows[1], cutMarker) {
		t.Errorf("row %q fits and must carry no marker", rows[1])
	}

	t.Run("when the terminal has not reported its size", func(t *testing.T) {
		rows := fitRows([]string{wide}, fitOptions{width: 0, body: 10, expanded: map[int]bool{}})
		if len(rows) != 1 || rows[0] != wide {
			t.Errorf("rows = %q, want the line untouched until the width is known", rows)
		}
	})

	t.Run("the newest rows are the ones kept", func(t *testing.T) {
		lines := []string{"one", "two", "three", "four"}
		rows := fitRows(lines, fitOptions{width: 60, body: 2, expanded: map[int]bool{}})
		if len(rows) != 2 || rows[1] != "four" {
			t.Errorf("rows = %q, want the last two", rows)
		}
	})
}

// @scenario "Clicking a row opens it in full, and clicking again closes it"
func TestClickingARowExpandsIt(t *testing.T) {
	wide := logfmt.Render(
		`{"level":"info","msg":"`+strings.Repeat("word ", 40)+`"}`,
		logfmt.Options{Lane: "backend", Time: time.Date(2026, 9, 9, 22, 30, 0, 0, time.UTC)},
	)
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	m.width, m.height = 61, 30

	if got := len(m.fitRows([]string{wide}, 20)); got != 1 {
		t.Fatalf("rows = %d before any click, want the line cut to one row", got)
	}

	t.Run("when the developer clicks that row", func(t *testing.T) {
		m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: bodyTopRow})
		rows := m.fitRows([]string{wide}, 20)
		if len(rows) < 2 {
			t.Fatalf("rows = %d after the click, want the row opened in full", len(rows))
		}
		indent := strings.Repeat(" ", logfmt.MessageColumn)
		if !strings.HasPrefix(rows[1], indent) {
			t.Errorf("continuation row %q is not indented to the message column", rows[1])
		}
		for i, row := range rows {
			if ansi.StringWidth(row) > 60 {
				t.Errorf("expanded row %d is %d cells wide: %q", i, ansi.StringWidth(row), row)
			}
		}
	})

	t.Run("when the developer clicks it again", func(t *testing.T) {
		m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: bodyTopRow})
		if got := len(m.fitRows([]string{wide}, 20)); got != 1 {
			t.Errorf("rows = %d after the second click, want the row closed again", got)
		}
	})

	t.Run("a click above the body opens nothing", func(t *testing.T) {
		m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: 0})
		if got := len(m.fitRows([]string{wide}, 20)); got != 1 {
			t.Errorf("rows = %d, want a click on the tab bar to open nothing", got)
		}
	})
}

// @scenario "x opens every row on the tab, for a terminal that forwards no clicks"
func TestXExpandsEveryRowOnTheTab(t *testing.T) {
	wide := "22:30:00.000  backend    info   " + strings.Repeat("word ", 40)
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	m.width, m.height = 61, 30
	m.selectTab("logs")

	m.handleKey("x")
	if got := len(m.fitRows([]string{wide}, 20)); got < 2 {
		t.Fatalf("rows = %d after x, want every row opened in full", got)
	}

	t.Run("when the developer moves to another tab", func(t *testing.T) {
		m.selectTab("traces")
		if got := len(m.fitRows([]string{wide}, 20)); got != 1 {
			t.Errorf("rows = %d, want the setting to belong to the tab it was made on", got)
		}
	})

	t.Run("when x is pressed again on the original tab", func(t *testing.T) {
		m.selectTab("logs")
		m.handleKey("x")
		if got := len(m.fitRows([]string{wide}, 20)); got != 1 {
			t.Errorf("rows = %d after the second x, want the rows cut again", got)
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
