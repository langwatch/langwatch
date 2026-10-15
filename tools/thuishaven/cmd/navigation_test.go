package cmd

import (
	"fmt"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// @scenario "Clicking a service opens its own deployable view"
func TestClickService(t *testing.T) {
	for _, tc := range []struct{ name, tab, log string }{{"backend", "logs", "api"}, {"mail", "mail", ""}, {"idp", "idp", ""}, {"app", "logs", "ui"}} {
		t.Run(tc.name, func(t *testing.T) {
			m := dashModel(t, []app.SessionServiceStatus{{Name: tc.name}}, nil)
			m.width, m.height = 72, 24
			m.View()
			var y int
			for row, index := range m.serviceRows {
				if index == 0 {
					y = row
					break
				}
			}
			if y == 0 {
				t.Fatal("no clickable service")
			}
			m.Update(tea.MouseMsg{X: 5, Y: y, Button: tea.MouseButtonLeft, Action: tea.MouseActionPress})
			if m.currentTab() != tc.tab {
				t.Fatalf("tab %s", m.currentTab())
			}
			if tc.log != "" && m.logs.Selected() != tc.log {
				t.Fatalf("logs %s", m.logs.Selected())
			}
		})
	}
}

// @scenario "The selected service stays visible in a small terminal"
func TestSessionSelectionScrolls(t *testing.T) {
	var services []app.SessionServiceStatus
	for i := range 25 {
		services = append(services, app.SessionServiceStatus{Name: fmt.Sprintf("service-%02d", i), URL: "https://example.localhost/a-very-long-path"})
	}
	m := dashModel(t, services, nil)
	m.width, m.height = 42, 18
	for range 24 {
		m.handleKey("down")
	}
	view := m.View()
	if !strings.Contains(view, "service-24") {
		t.Fatalf("selection invisible: %s", view)
	}
	for _, line := range strings.Split(view, "\n") {
		if ansi.StringWidth(line) > 42 {
			t.Fatalf("row too wide: %q", line)
		}
	}
	if len(strings.Split(view, "\n")) > 18 {
		t.Fatal("screen overflow")
	}
}

// @scenario "Log cursor controls cannot move the viewer's rows"
func TestLogTerminalControls(t *testing.T) {
	input := "\x1b[2J\x1b[8A\r\x1b]0;window title\a\x1b[31mhello\x1b[0m\t界\b!"
	got := terminalText(input)
	if ansi.Strip(got) != "hello   界!" {
		t.Fatalf("unsafe layout: %q", got)
	}
	if !strings.Contains(got, "\x1b[31m") {
		t.Fatal("color lost")
	}
	m := expandingModel(t)
	m.logs.Observe(sources.LogLine{Lane: "ui", Text: input})
	m.View()
	for _, y := range []int{0, m.height - 1, m.height + 1} {
		m.handleMouse(tea.MouseMsg{X: 2, Y: y, Button: tea.MouseButtonLeft, Action: tea.MouseActionPress})
	}
	if len(m.expandedIDs) != 0 {
		t.Fatal("chrome or off-screen click expanded a row")
	}
	m.selectTab("session")
	m.View()
	if len(m.rowIDs) != 0 {
		t.Fatal("log hit targets survived tab switch")
	}
}

// @scenario "Wrapped terminal tabs remain clickable"
func TestWrappedTabHitTargets(t *testing.T) {
	m := dashModel(t, nil, nil)
	m.width, m.height = 42, 24
	m.View()
	for _, hit := range m.tabHits {
		if hit.name != "idp" {
			continue
		}
		m.Update(tea.MouseMsg{X: hit.start + 1, Y: hit.y, Button: tea.MouseButtonLeft, Action: tea.MouseActionPress})
		if m.currentTab() != "idp" {
			t.Fatal(m.currentTab())
		}
		return
	}
	t.Fatal("identity tab has no hit target")
}

// @scenario "Expanding the top log record keeps it visible while new output arrives"
func TestExpandedTopRecordIsAnchored(t *testing.T) {
	m := expandingModel(t)
	body := rows(wideLine(), "second", "third", "fourth", "fifth", "sixth")
	fitted(m, body, 6)
	m.Update(tea.MouseMsg{Button: tea.MouseButtonLeft, Action: tea.MouseActionPress, Y: m.chromeHeight()})
	view := fitted(m, body, 6)
	if !strings.Contains(view[0], glyphOpen) || !strings.Contains(stripPaint(view[0]), "word") {
		t.Fatalf("clicked record disappeared: %v", view)
	}
	before := strings.Join(view, "\n")
	body = append(body, rows("new output")...)
	if after := strings.Join(fitted(m, body, 6), "\n"); after != before {
		t.Fatal("new output moved the inspected record")
	}
	m.offerKey("down")
	if got := fitted(m, body, 6); strings.Join(got, "\n") == before {
		t.Fatal("expanded details did not scroll")
	}
	m.offerKey("f")
	if got := strings.Join(fitted(m, body, 6), "\n"); !strings.Contains(got, "new output") || strings.Contains(got, openShade) {
		t.Fatalf("did not resume live output: %s", got)
	}
}

// @scenario "Terminal help separates navigation from stack lifecycle actions"
func TestContextualHelpAndLifecycle(t *testing.T) {
	for _, size := range [][2]int{{120, 30}, {80, 24}, {42, 18}} {
		m := dashModel(t, []app.SessionServiceStatus{{Name: "idp", Up: true}}, nil)
		m.width, m.height = size[0], size[1]
		m.selectTab("idp")
		view := stripPaint(m.View())
		if !strings.Contains(view, "q Detach") || !strings.Contains(view, "X Stop stack") {
			t.Fatalf("lifecycle controls missing at %v: %s", size, view)
		}
		m.handleKey("?")
		help := stripPaint(m.View())
		if !strings.Contains(help, "Keyboard shortcuts") || !strings.Contains(help, "Close help") {
			t.Fatal(help)
		}
		m.handleKey("esc")
		if m.help || m.currentTab() != "idp" {
			t.Fatal("closing help changed the current tab")
		}
	}
}
