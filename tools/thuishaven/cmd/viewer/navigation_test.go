package viewer

import (
	"fmt"
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// @scenario "Filtered logs scroll and search within the matching lines"
func TestFilteredLogsNavigate(t *testing.T) {
	tab := NewLogsTab(Sources{})
	for i := range 12 {
		tab.Observe(sources.LogLine{Lane: "api", Text: fmt.Sprintf(`{"level":"error","msg":"failure %02d"}`, i)})
		tab.Observe(sources.LogLine{Lane: "api", Text: `{"level":"info","msg":"ordinary"}`})
	}
	tab.Key("e")
	frame := Frame{Width: 120, Height: 3}
	if body := texts(tab.Body(frame)); !strings.Contains(strings.Join(body, ""), "failure 11") {
		t.Fatal(body)
	}
	tab.Key("g")
	body := strings.Join(texts(tab.Body(frame)), "\n")
	if !strings.Contains(body, "failure 00") || !strings.Contains(body, "failure 02") || strings.Contains(body, "ordinary") {
		t.Fatal(body)
	}
	tab.Key("/")
	for _, r := range "failure 07" {
		tab.Key(string(r))
	}
	tab.Key("enter")
	body = ansi.Strip(strings.Join(texts(tab.Body(frame)), "\n"))
	if !strings.Contains(body, "failure 07") {
		t.Fatal(body)
	}
	before := strings.Join(texts(tab.Body(frame)), "\n")
	tab.Observe(sources.LogLine{Lane: "api", Text: `{"level":"info","msg":"ignored"}`})
	tab.Observe(sources.LogLine{Lane: "api", Text: `{"level":"error","msg":"new error"}`})
	if got := strings.Join(texts(tab.Body(frame)), "\n"); got != before {
		t.Fatalf("scrolled view moved: %s -> %s", before, got)
	}
}

// @scenario "Unicode searches preserve the original log text"
func TestHighlightUnicodeOffsets(t *testing.T) {
	for _, query := range []string{"k", "i", "İ", "界", "m", "31"} {
		line := "\x1b[31mKelvin İSTANBUL 界 and K\x1b[0m"
		if got := ansi.Strip(highlight(line, query)); got != ansi.Strip(line) {
			t.Fatalf("query %q corrupted text: %q", query, got)
		}
	}
}

// @scenario "Mail and identity tabs keep selection while live data refreshes"
func TestSimulatorSelection(t *testing.T) {
	var opened string
	tab := NewSimulatorTab("mail", Sources{Open: func(url string) error { opened = url; return nil }})
	tab.browserURL = "http://mail.localhost"
	one := sources.SimulatorItem{ID: "one", Title: "First invite", Detail: "ada@example.test", Path: "/messages/one"}
	two := sources.SimulatorItem{ID: "two", Title: "Sign-in", Detail: "bob@example.test", Path: "/messages/two"}
	tab.accept(simulatorResult{items: []sources.SimulatorItem{one, two}})
	tab.Key("down")
	tab.accept(simulatorResult{items: []sources.SimulatorItem{{ID: "new", Title: "New mail"}, one, two}})
	tab.Key("enter")
	tab.Key("o")
	tab.Key("esc")
	if opened != "http://mail.localhost/messages/two" {
		t.Fatal(opened)
	}
	tab.Key("/")
	for _, r := range "ada" {
		tab.Key(string(r))
	}
	tab.Key("enter")
	tab.Key("o")
	if opened != "http://mail.localhost/messages/one" {
		t.Fatal(opened)
	}
	body := strings.Join(texts(tab.Body(Frame{Height: 4})), "\n")
	if !strings.Contains(body, "First invite") || strings.Contains(body, "Sign-in") {
		t.Fatal(body)
	}
}
