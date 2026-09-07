package cmd

import (
	"errors"
	"fmt"
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
	case "up":
		return tea.KeyMsg{Type: tea.KeyUp}
	case "down":
		return tea.KeyMsg{Type: tea.KeyDown}
	case "pgup":
		return tea.KeyMsg{Type: tea.KeyPgUp}
	case "pgdown":
		return tea.KeyMsg{Type: tea.KeyPgDown}
	case "home":
		return tea.KeyMsg{Type: tea.KeyHome}
	case "end":
		return tea.KeyMsg{Type: tea.KeyEnd}
	case "enter":
		return tea.KeyMsg{Type: tea.KeyEnter}
	case "backspace":
		return tea.KeyMsg{Type: tea.KeyBackspace}
	default:
		return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(s)}
	}
}

// pushLines writes n lines of the form "<label> N" straight into a group's
// ring, bypassing file ingestion — the scroll/search tests only care about
// buffer content and position, not the file-tailing path.
func pushLines(m *viewerModel, group, label string, n int) {
	for i := 0; i < n; i++ {
		m.push(group, fmt.Sprintf("%s %d", label, i))
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
		got := formatCombinedLine(`langyagent | {"level":"error","msg":"exploded"}`)
		if !strings.Contains(got, "langy") || strings.Contains(got, "langyagent") {
			t.Errorf("got %q, want the langy CLI spelling", got)
		}
		if !strings.Contains(got, "\x1b[31merror") {
			t.Errorf("got %q, want the error level painted red", got)
		}
		if !strings.Contains(got, "exploded") {
			t.Errorf("got %q, want the message rendered", got)
		}
	})
	t.Run("a label-less line passes through untouched", func(t *testing.T) {
		for _, raw := range []string{
			"  thuishaven: stack \"x\"",
			"12:16:42.370  codegen           Loaded Prisma config from prisma.config.ts.",
		} {
			if got := formatCombinedLine(raw); got != raw {
				t.Errorf("formatCombinedLine(%q) = %q, want the line kept as is", raw, got)
			}
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

var errStopFailed = errors.New("no registered stack \"feat-x\"")

// @scenario "Scrolling back leaves following mode"
func TestViewerScrollLeavesFollowing(t *testing.T) {
	newModel := func() *viewerModel {
		m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
		pushLines(m, viewerAllGroup, "line", 30)
		return m
	}

	t.Run("given a fresh viewer at the bottom", func(t *testing.T) {
		t.Run("when the developer presses up", func(t *testing.T) {
			m := newModel()
			m.handleKey("up")
			if m.scroll[viewerAllGroup] != 1 {
				t.Fatalf("scroll = %d, want 1", m.scroll[viewerAllGroup])
			}
			if !strings.Contains(m.logFooter(viewerAllGroup), "1 lines above") {
				t.Error("footer must show the scroll-back count")
			}
			if !strings.Contains(m.logFooter(viewerAllGroup), "f to follow") {
				t.Error("footer must name f as the way back to following")
			}
		})

		t.Run("when the developer presses PgUp", func(t *testing.T) {
			m := newModel()
			m.handleKey("pgup")
			if m.scroll[viewerAllGroup] != m.bodyHeight() {
				t.Fatalf("scroll = %d, want a full page (%d)", m.scroll[viewerAllGroup], m.bodyHeight())
			}
		})

		t.Run("when the developer scrolls the mouse wheel up", func(t *testing.T) {
			m := newModel()
			m.handleMouse(tea.MouseMsg{Button: tea.MouseButtonWheelUp})
			if m.scroll[viewerAllGroup] != mouseWheelScrollLines {
				t.Fatalf("scroll = %d, want %d", m.scroll[viewerAllGroup], mouseWheelScrollLines)
			}
		})

		t.Run("when the developer presses Home", func(t *testing.T) {
			m := newModel()
			m.handleKey("home")
			if m.scroll[viewerAllGroup] != len(m.lines[viewerAllGroup]) {
				t.Fatalf("Home should scroll to the very top, scroll=%d", m.scroll[viewerAllGroup])
			}
		})
	})
}

// @scenario "New output does not yank a scrolled-back view"
func TestViewerScrollPinnedAgainstNewOutput(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	m.height = 10 // a small terminal, so the body holds only a few lines
	pushLines(m, viewerAllGroup, "line", 30)
	m.scrollBy(viewerAllGroup, 15)

	before := m.visibleLines(viewerAllGroup, m.bodyHeight())
	pushLines(m, viewerAllGroup, "new", 5)
	after := m.visibleLines(viewerAllGroup, m.bodyHeight())

	if strings.Join(before, "|") != strings.Join(after, "|") {
		t.Errorf("scrolled-back view moved: before=%v after=%v", before, after)
	}
	if m.scroll[viewerAllGroup] != 20 {
		t.Errorf("scroll offset = %d, want 20 (15 + 5 new lines)", m.scroll[viewerAllGroup])
	}
}

// @scenario "Returning to the bottom resumes following"
func TestViewerFollowResumes(t *testing.T) {
	newScrolledModel := func() *viewerModel {
		m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
		pushLines(m, viewerAllGroup, "line", 30)
		m.scrollBy(viewerAllGroup, 10)
		return m
	}

	t.Run("given a scrolled-back view", func(t *testing.T) {
		t.Run("when f is pressed", func(t *testing.T) {
			m := newScrolledModel()
			m.handleKey("f")
			if m.scroll[viewerAllGroup] != 0 {
				t.Fatalf("scroll = %d, want 0", m.scroll[viewerAllGroup])
			}
			if strings.Contains(m.logFooter(viewerAllGroup), "lines above") {
				t.Error("the scroll-back indicator must be gone once following resumes")
			}
		})

		t.Run("when End is pressed", func(t *testing.T) {
			m := newScrolledModel()
			m.handleKey("end")
			if m.scroll[viewerAllGroup] != 0 {
				t.Fatalf("scroll = %d, want 0", m.scroll[viewerAllGroup])
			}
		})

		t.Run("when scrolling all the way down", func(t *testing.T) {
			m := newScrolledModel()
			for i := 0; i < 20; i++ {
				m.handleKey("down")
			}
			if m.scroll[viewerAllGroup] != 0 {
				t.Fatalf("scroll = %d, want 0 after scrolling past the bottom", m.scroll[viewerAllGroup])
			}
		})
	})
}

// @scenario "Slash opens a search prompt in the footer"
func TestViewerSearchPromptCapturesInput(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	pushLines(m, viewerAllGroup, "line", 5)

	m.handleKey("/")
	if !m.searchPrompt {
		t.Fatal("/ must open the search prompt")
	}
	if !strings.Contains(m.logFooter(viewerAllGroup), "enter searches") {
		t.Error("the footer must show the live search prompt")
	}

	// While the prompt is open, a normally-scrolling key is captured as text
	// instead of scrolling — only single runes are typed; multi-rune key
	// names like "down" are silently ignored rather than leaking into the query.
	m.handleKey("down")
	if m.scroll[viewerAllGroup] != 0 {
		t.Error("scrolling keys must not scroll while the search prompt is open")
	}

	m.handleKey("h")
	m.handleKey("i")
	if m.searchInput != "hi" {
		t.Fatalf("searchInput = %q, want %q", m.searchInput, "hi")
	}
	m.handleKey("backspace")
	if m.searchInput != "h" {
		t.Fatalf("searchInput after backspace = %q, want %q", m.searchInput, "h")
	}
}

// @scenario "Enter jumps to the nearest match and highlights every match on screen"
func TestViewerSearchJumpsAndHighlights(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	for i := 0; i < 10; i++ {
		m.push(viewerAllGroup, fmt.Sprintf("plain line %d", i))
	}
	m.push(viewerAllGroup, "an ERROR occurred here")

	m.handleKey("/")
	for _, r := range "error" { // lower-case query against an upper-case match
		m.handleKey(string(r))
	}
	m.handleKey("enter")

	if m.searchQuery != "error" {
		t.Fatalf("searchQuery = %q, want %q", m.searchQuery, "error")
	}
	if m.matchIdx < 0 {
		t.Fatal("Enter must land on a match")
	}
	view := m.View()
	if !strings.Contains(view, "\x1b[7mERROR\x1b[27m") {
		t.Errorf("view must highlight the match in its original case, got: %q", view)
	}
}

// @scenario "n and N step across the whole buffer of the current tab"
func TestViewerSearchStepWraps(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	for i := 0; i < 3; i++ {
		m.push(viewerAllGroup, fmt.Sprintf("needle %d", i))
		m.push(viewerAllGroup, "filler")
	}
	m.searchQuery = "needle"
	m.jumpToNearestMatch()

	matches := m.searchMatches(viewerAllGroup)
	if len(matches) != 3 {
		t.Fatalf("matches = %v, want 3 needles", matches)
	}

	seen := []int{m.matchIdx}
	for i := 0; i < 3; i++ {
		m.stepMatch(1)
		seen = append(seen, m.matchIdx)
	}
	if seen[3] != seen[0] {
		t.Errorf("stepping forward 3 times over 3 matches should wrap back, seen=%v", seen)
	}

	m.stepMatch(-1)
	if m.matchIdx != seen[2] {
		t.Errorf("N should step backward, matchIdx=%d want %d", m.matchIdx, seen[2])
	}
}

// @scenario "Escape clears the search"
func TestViewerEscapeClearsSearch(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	pushLines(m, viewerAllGroup, "needle", 3)
	m.searchQuery = "needle"

	m.handleKey("esc")
	if m.searchQuery != "" {
		t.Fatalf("esc must clear the query, still %q", m.searchQuery)
	}
	// \x1b[27m only ever appears as the closing half of a search highlight
	// (the tab bar's own reverse-video uses \x1b[0m to reset), so its absence
	// proves the highlighting is gone rather than merely the tab styling.
	if strings.Contains(m.View(), "\x1b[27m") {
		t.Error("highlighting must disappear once the query is cleared")
	}

	// A second esc, with no search left to clear, falls through to the
	// ordinary detach behavior.
	_, cmd := m.handleKey("esc")
	if cmd == nil {
		t.Fatal("esc must still detach the viewer once there is no search to clear")
	}
}

// @scenario "A search persists across tabs"
func TestViewerSearchPersistsAcrossTabs(t *testing.T) {
	dir := t.TempDir()
	base := time.Now().UTC()
	for _, svc := range []string{"app", "nlp"} {
		line := base.Format(time.RFC3339Nano) + " a restart happened in " + svc + "\n"
		if err := os.WriteFile(filepath.Join(dir, svc+".log"), []byte(line), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest() // groups = [all app nlp]

	m.handleKey("2") // land on "app"
	m.handleKey("/")
	for _, r := range "restart" {
		m.handleKey(string(r))
	}
	m.handleKey("enter")
	if len(m.searchMatches("app")) == 0 {
		t.Fatal("expected a match on the app tab")
	}

	m.handleKey("3") // switch to "nlp"
	if m.searchQuery != "restart" {
		t.Fatalf("query must survive the tab switch, got %q", m.searchQuery)
	}
	if len(m.searchMatches("nlp")) == 0 {
		t.Fatal("the same query must also match nlp's own buffer")
	}
	m.handleKey("n")
	if m.matchIdx < 0 {
		t.Fatal("n on the new tab must search that tab's own matches, not the old tab's")
	}
}

// @scenario "Existing bindings keep working"
func TestViewerExistingBindingsUnaffectedBySearchAndScroll(t *testing.T) {
	dir := t.TempDir()
	line := time.Now().UTC().Format(time.RFC3339Nano) + " hi\n"
	if err := os.WriteFile(filepath.Join(dir, "app.log"), []byte(line), 0o600); err != nil {
		t.Fatal(err)
	}
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest() // groups = [all app]

	m.handleKey("2")
	if m.groups[m.selected] != "app" {
		t.Fatalf("digit jump broken, landed on %q", m.groups[m.selected])
	}
	m.handleKey("left")
	if m.groups[m.selected] != viewerAllGroup {
		t.Fatalf("left-cycle broken, landed on %q", m.groups[m.selected])
	}
	m.handleKey("tab")
	if m.groups[m.selected] != "app" {
		t.Fatalf("tab-cycle broken, landed on %q", m.groups[m.selected])
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
	if _, cmd := m3.handleKey("X"); cmd == nil || stops != 0 {
		t.Fatal("X twice must dispatch a stop")
	} else {
		cmd()
		if stops != 1 {
			t.Fatalf("stops = %d, want 1 after the confirmed X", stops)
		}
	}

	m3.handleKey("down")
	if m3.cursor != 0 {
		t.Error("the dashboard's own down binding must still move the cursor, not scroll")
	}
}

// A capture left behind by a lane that no longer runs (a retired lane name,
// an earlier selection) is not a tab; `haven logs` still reads it.
// @scenario "Captures from lanes that no longer run are not tabs"
func TestViewerHidesStaleCaptures(t *testing.T) {
	dir := t.TempDir()
	stale := time.Now().Add(-2 * time.Hour)
	for _, svc := range []string{"api", "workers"} {
		p := filepath.Join(dir, svc+".log")
		if err := os.WriteFile(p, []byte(stale.UTC().Format(time.RFC3339Nano)+" old\n"), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(p, stale, stale); err != nil {
			t.Fatal(err)
		}
	}
	live := time.Now().UTC().Format(time.RFC3339Nano) + " hello from backend\n"
	if err := os.WriteFile(filepath.Join(dir, "backend.log"), []byte(live), 0o600); err != nil {
		t.Fatal(err)
	}
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), dir)
	m.ingest()
	if m.hasGroup("api") || m.hasGroup("workers") {
		t.Fatalf("groups = %v, want no tab for a capture written hours before the viewer opened", m.groups)
	}
	if !m.hasGroup("backend") {
		t.Fatalf("groups = %v, want backend", m.groups)
	}
}
