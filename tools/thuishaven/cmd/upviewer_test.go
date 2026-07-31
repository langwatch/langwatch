package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
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
	default:
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
	}
}

// @scenario "Up in a terminal never holds the stack hostage"
func TestViewerQuitDetachesInsteadOfKilling(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	for _, k := range []string{"q", "esc", "ctrl+c"} {
		_, cmd := m.Update(key(k))
		if cmd == nil {
			t.Fatalf("%q must quit the viewer", k)
		}
		if msg := cmd(); msg != (tea.QuitMsg{}) {
			t.Errorf("%q returned %T, want tea.Quit — the viewer only ever detaches", k, msg)
		}
	}
}

// @scenario "Switching between service log groups is a keypress"
func TestViewerGroupSwitching(t *testing.T) {
	dir := t.TempDir()
	base := time.Now().UTC()
	for _, svc := range []string{"app", "nlp"} {
		line := base.Format(time.RFC3339Nano) + " hello from " + svc + "\n"
		if err := os.WriteFile(filepath.Join(dir, svc+".log"), []byte(line), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest()

	if len(m.groups) != 3 || m.groups[0] != "all" {
		t.Fatalf("groups = %v, want [all app nlp]", m.groups)
	}
	m.Update(key("tab"))
	if m.groups[m.selected] != "app" {
		t.Errorf("tab from all lands on %q, want app", m.groups[m.selected])
	}
	m.Update(key("right"))
	if m.groups[m.selected] != "nlp" {
		t.Errorf("right lands on %q, want nlp", m.groups[m.selected])
	}
	m.Update(key("right"))
	if m.groups[m.selected] != "all" {
		t.Errorf("cycling wraps to %q, want all", m.groups[m.selected])
	}
	m.Update(key("3"))
	if m.groups[m.selected] != "nlp" {
		t.Errorf("digit 3 lands on %q, want nlp", m.groups[m.selected])
	}
	m.Update(key("left"))
	if m.groups[m.selected] != "app" {
		t.Errorf("left lands on %q, want app", m.groups[m.selected])
	}

	view := m.View()
	if !strings.Contains(view, "hello from app") {
		t.Errorf("selected app group must render app's lines, got: %q", view)
	}
	if strings.Contains(view, "hello from nlp") {
		t.Errorf("selected app group must not render nlp's lines")
	}
}

// A service that joins later (up +svc) appears as a tab without restarting.
// @scenario "Switching between service log groups is a keypress"
func TestViewerDiscoversNewServicesLive(t *testing.T) {
	dir := t.TempDir()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest()
	if len(m.groups) != 1 {
		t.Fatalf("groups = %v, want just all before any capture exists", m.groups)
	}
	line := time.Now().UTC().Format(time.RFC3339Nano) + " langy is here\n"
	if err := os.WriteFile(filepath.Join(dir, "langyagent.log"), []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	m.ingest()
	if !m.hasGroup("langy") {
		t.Errorf("groups = %v, want langy discovered (CLI spelling)", m.groups)
	}
}

func TestFormatCombinedLine(t *testing.T) {
	t.Run("a labelled supervisor line gets its lane colour and CLI spelling", func(t *testing.T) {
		got := formatCombinedLine("langyagent | ERROR exploded")
		if !strings.Contains(got, "langy") || strings.Contains(got, "langyagent") {
			t.Errorf("got %q, want the langy CLI spelling", got)
		}
		if !strings.Contains(got, "\x1b[31m") {
			t.Errorf("got %q, want the error highlighted red", got)
		}
	})
	t.Run("a label-less provisioning line passes through", func(t *testing.T) {
		if got := formatCombinedLine("  thuishaven: stack \"x\""); !strings.Contains(got, "thuishaven") {
			t.Errorf("got %q, want the raw line kept", got)
		}
	})
}

// @scenario "The session dashboard is the first thing haven up shows"
func TestSessionDashboardIsTabOne(t *testing.T) {
	m := dashModel(t, []app.SessionServiceStatus{
		{Name: "app", URL: "https://app.feat-x.langwatch.localhost", Up: true, Restartable: true},
		{Name: "nlp", Restartable: true},
	}, nil)

	if m.groups[0] != sessionGroup {
		t.Fatalf("first tab = %q, want the session dashboard", m.groups[0])
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
	t.Logf("\n%s", view) // eyeball the harbour + layout
}

// A viewer built without a session (the log-only paths, and every existing
// test) has no dashboard tab and behaves exactly as before.
// @scenario "The session dashboard is the first thing haven up shows"
func TestNoDashboardWithoutASession(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	if m.onDashboard() {
		t.Error("a session-less viewer must not present a dashboard")
	}
	if m.groups[0] != viewerAllGroup {
		t.Errorf("first tab = %q, want the combined log stream", m.groups[0])
	}
}

// @scenario "Arrow keys move the cursor and open a service's logs"
func TestDashboardOpensServiceLogs(t *testing.T) {
	dir := t.TempDir()
	line := time.Now().UTC().Format(time.RFC3339Nano) + " hi from app\n"
	if err := os.WriteFile(filepath.Join(dir, "app.log"), []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	snap := app.SessionReport{Found: true, Services: []app.SessionServiceStatus{
		{Name: "app", Restartable: true}, {Name: "nlp", Restartable: true},
	}}
	m.enableDashboard(sessionActions{Snapshot: func() app.SessionReport { return snap }}, false)
	m.ingest() // discovers app's log group -> groups = [session all app]

	m.handleKey("down")
	if m.cursor != 1 {
		t.Fatalf("down should move to the nlp row, cursor=%d", m.cursor)
	}
	m.handleKey("up")
	if m.cursor != 0 {
		t.Fatalf("up should return to the app row, cursor=%d", m.cursor)
	}
	m.handleKey("enter")
	if m.groups[m.selected] != "app" {
		t.Errorf("enter on app should open its log tab, landed on %q", m.groups[m.selected])
	}
}

// enter on a service with no capture of its own falls back to the combined stream.
// @scenario "Arrow keys move the cursor and open a service's logs"
func TestDashboardEnterFallsBackToCombined(t *testing.T) {
	m := dashModel(t, []app.SessionServiceStatus{{Name: "gateway", Restartable: true}}, nil)
	m.handleKey("enter")
	if m.groups[m.selected] != viewerAllGroup {
		t.Errorf("enter on a captureless service should open the combined stream, landed on %q", m.groups[m.selected])
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

func TestViewerRingIsCapped(t *testing.T) {
	m := newViewerModel("feat-x", "", "")
	for i := 0; i < viewerRingCap+50; i++ {
		m.push("all", "line")
	}
	if len(m.lines["all"]) != viewerRingCap {
		t.Errorf("ring = %d lines, want capped at %d", len(m.lines["all"]), viewerRingCap)
	}
}

// The combined per-stack log is append-only and uncapped, so attaching to a
// long-lived worktree must not read it whole just to render a screenful.
func TestViewerFirstReadIsBoundedToATailWindow(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "combined.log")

	ts := time.Now().UTC().Format(time.RFC3339Nano)
	var big strings.Builder
	for big.Len() < readFreshTailWindow*3 {
		big.WriteString(ts + " an old line nobody will ever scroll back to\n")
	}
	if err := os.WriteFile(path, []byte(big.String()), 0o600); err != nil {
		t.Fatal(err)
	}

	m := newViewerModel("feat-x", path, t.TempDir())

	t.Run("given a capture file far larger than the window", func(t *testing.T) {
		t.Run("when the viewer first reads it, it consumes only the tail", func(t *testing.T) {
			lines := m.readFresh("all", path)
			consumed := 0
			for _, l := range lines {
				consumed += len(l) + 1
			}
			if consumed > readFreshTailWindow {
				t.Errorf("first read consumed %d bytes, want at most the %d-byte window", consumed, readFreshTailWindow)
			}
			if len(lines) == 0 {
				t.Error("first read should still return the tail, got nothing")
			}
		})

		t.Run("when more is appended, the next read returns exactly the new lines", func(t *testing.T) {
			f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.WriteString(ts + " a brand new line\n"); err != nil {
				t.Fatal(err)
			}
			_ = f.Close()

			lines := m.readFresh("all", path)
			if len(lines) != 1 || !strings.Contains(lines[0], "a brand new line") {
				t.Errorf("incremental read = %v, want just the appended line", lines)
			}
		})
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

// downModel is dashModel with the shutdown action wired — the shape the `up`
// path injects and the play path deliberately does not.
func downModel(t *testing.T, down func() error) *viewerModel {
	t.Helper()
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	snap := app.SessionReport{
		Found: true, Live: true, Slug: "feat-x",
		Services: []app.SessionServiceStatus{{Name: "app", Restartable: true}},
	}
	m.enableDashboard(sessionActions{
		Snapshot: func() app.SessionReport { return snap },
		Down:     down,
	}, false)
	return m
}

// Stopping the stack is the one action in this view that outlives it, so it
// asks first — the same y/n gate the hub puts in front of its own `d`.
// @scenario "The stack can be stopped from the attached view"
func TestDashboardDownConfirms(t *testing.T) {
	t.Run("given the dashboard tab with a wired shutdown", func(t *testing.T) {
		t.Run("when d is pressed, nothing has stopped yet", func(t *testing.T) {
			called := false
			m := downModel(t, func() error { called = true; return nil })
			m.handleKey("d")
			if !m.confirmDown {
				t.Fatal("d did not arm the confirmation")
			}
			if called {
				t.Error("d stopped the stack without asking")
			}
			if !strings.Contains(m.View(), "y/n") {
				t.Errorf("the prompt is not on screen:\n%s", m.View())
			}
		})

		t.Run("when the confirmation is answered with y, the stack is stopped and the view closes", func(t *testing.T) {
			called := false
			m := downModel(t, func() error { called = true; return nil })
			m.handleKey("d")
			_, cmd := m.handleKey("y")
			if cmd == nil {
				t.Fatal("y did not dispatch the shutdown")
			}
			msg, ok := cmd().(downDoneMsg)
			if !ok || msg.err != nil {
				t.Fatalf("want a clean downDoneMsg, got %#v", msg)
			}
			if !called {
				t.Error("the shutdown action was never called")
			}
			if _, quit := m.Update(msg); quit == nil {
				t.Error("a clean shutdown must close the view — there is no stack left to watch")
			}
			if m.exit != viewerDowned {
				t.Errorf("exit = %v, want viewerDowned so the caller says the stack stopped", m.exit)
			}
		})

		t.Run("when the confirmation is answered with anything else, nothing stops", func(t *testing.T) {
			called := false
			m := downModel(t, func() error { called = true; return nil })
			m.handleKey("d")
			m.handleKey("n")
			if called {
				t.Error("a key other than y stopped the stack")
			}
			if m.confirmDown {
				t.Error("the prompt is still armed after being answered")
			}
		})

		// While the prompt is up, every other key answers it. A tab switch that
		// left it armed would make the next keypress mean something the screen
		// no longer says.
		t.Run("when another key is pressed while the prompt is up, it answers the prompt", func(t *testing.T) {
			m := downModel(t, func() error { return nil })
			m.handleKey("d")
			before := m.selected
			m.handleKey("tab")
			if m.selected != before {
				t.Error("tab switched tabs while the shutdown prompt was open")
			}
			if m.confirmDown {
				t.Error("the prompt survived a keypress")
			}
		})
	})

	// A play sandbox is torn down by quitting, not by an action; offering `d`
	// there would be a second, differently-worded way to destroy it.
	t.Run("given the play viewer", func(t *testing.T) {
		m := newViewerModel("play-42", "", "")
		m.enableDashboard(sessionActions{Down: func() error { return nil }}, true)
		if m.canDown() {
			t.Error("the play sandbox offers d — its teardown is the quit contract")
		}
		m.handleKey("d")
		if m.confirmDown {
			t.Error("d armed a shutdown on a play sandbox")
		}
	})
}

// Bare `haven` opens this view when the worktree's stack is up, so the fleet
// hub needs a way in from here or it becomes unreachable from a live worktree.
// @scenario "Bare haven opens this worktree's stack when it is up"
func TestViewerHandsOverToTheFleetHub(t *testing.T) {
	t.Run("given the up viewer", func(t *testing.T) {
		m := downModel(t, func() error { return nil })
		_, cmd := m.handleKey("f")
		if cmd == nil {
			t.Fatal("f did not close the view")
		}
		if msg := cmd(); msg != (tea.QuitMsg{}) {
			t.Errorf("f returned %T, want tea.Quit", msg)
		}
		if m.exit != viewerToHub {
			t.Errorf("exit = %v, want viewerToHub", m.exit)
		}
		if !strings.Contains(m.View(), "f fleet") {
			t.Errorf("the footer does not name f:\n%s", m.View())
		}
	})

	t.Run("given the play viewer, where leaving destroys the sandbox", func(t *testing.T) {
		m := newViewerModel("play-42", "", "")
		m.enableDashboard(sessionActions{}, true)
		if _, cmd := m.handleKey("f"); cmd != nil {
			t.Error("f closed a play viewer — leaving one destroys it, so it is not a navigation key")
		}
	})
}
