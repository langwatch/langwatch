package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

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

func TestViewerRingIsCapped(t *testing.T) {
	m := newViewerModel("feat-x", "", "")
	for i := 0; i < viewerRingCap+50; i++ {
		m.push("all", "line")
	}
	if len(m.lines["all"]) != viewerRingCap {
		t.Errorf("ring = %d lines, want capped at %d", len(m.lines["all"]), viewerRingCap)
	}
}
