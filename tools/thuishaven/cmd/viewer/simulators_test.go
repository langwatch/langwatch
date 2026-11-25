package viewer

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// @scenario "A slow simulator cannot block terminal navigation"
func TestSimulatorPollIsAsync(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { <-release; _, _ = w.Write([]byte(`{"messages":[]}`)) }))
	defer server.Close()
	defer close(release)
	port := server.Listener.Addr().(*net.TCPAddr).Port
	tab := NewSimulatorTab("mail", Sources{Simulator: func(string) (int, string) { return port, server.URL }})
	done := make(chan struct{})
	go func() { tab.Poll(); close(done) }()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("poll blocked on the simulator")
	}
	if tab.Key("tab") {
		t.Fatal("simulator swallowed tab navigation")
	}
	if !tab.Key("/") {
		t.Fatal("search is unresponsive")
	}
}

// @scenario "Simulator details open in the terminal before an explicit browser action"
func TestSimulatorTerminalDetails(t *testing.T) {
	opened := ""
	tab := NewSimulatorTab("idp", Sources{Open: func(url string) error { opened = url; return nil }})
	tab.browserURL = "https://idp.example.test"
	tab.accept(simulatorResult{items: []sources.SimulatorItem{{ID: "1", Title: "Tenant 1", Path: "/t/1/", Preview: []string{"USERS", "alice@acme1.test", "APPLICATIONS", "None"}}}})
	tab.Key("enter")
	if opened != "" {
		t.Fatal("enter opened a browser")
	}
	body := strings.Join(texts(tab.Body(Frame{Width: 80, Height: 12})), "\n")
	if !strings.Contains(body, "alice@acme1.test") || !strings.Contains(body, "APPLICATIONS") {
		t.Fatal(body)
	}
	tab.Key("o")
	if opened != "https://idp.example.test/t/1/" {
		t.Fatal(opened)
	}
	tab.Key("esc")
	if tab.opened != nil {
		t.Fatal("escape did not return to providers")
	}
}

// @scenario "Mail recipients can be inspected and used to filter the terminal inbox"
func TestMailRecipientDirectory(t *testing.T) {
	tab := NewSimulatorTab("mail", Sources{})
	tab.accept(simulatorResult{items: []sources.SimulatorItem{
		{ID: "1", Title: "Welcome", Detail: "a@example.test", Recipients: []string{"a@example.test"}},
		{ID: "2", Title: "Reset", Detail: "a@example.test", Recipients: []string{"a@example.test", "A@example.test"}},
		{ID: "3", Title: "Other", Detail: "b@example.test", Recipients: []string{"b@example.test"}},
	}})
	tab.Key("a")
	body := strings.Join(texts(tab.Body(Frame{Width: 80, Height: 10})), "\n")
	if !strings.Contains(body, "a@example.test") || !strings.Contains(body, "2 messages") {
		t.Fatal(body)
	}
	tab.Key("enter")
	body = strings.Join(texts(tab.Body(Frame{Width: 80, Height: 10})), "\n")
	if !strings.Contains(body, "Welcome") || !strings.Contains(body, "Reset") || strings.Contains(body, "Other") {
		t.Fatal(body)
	}
}
