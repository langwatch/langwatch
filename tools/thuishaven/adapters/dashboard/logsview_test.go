package dashboard

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// viewerPage renders the dashboard, and script returns the viewer's client.
func viewerPage(t *testing.T) (page, script string) {
	t.Helper()
	s := New(Config{
		Stacks:    func() []domain.Stack { return []domain.Stack{{Slug: "project", LauncherPID: 1}} },
		SharedURL: func(svc string) string { return "https://" + svc + ".langwatch.localhost" },
	})
	index := httptest.NewRecorder()
	s.routes().ServeHTTP(index, httptest.NewRequest(http.MethodGet, "/", nil))
	assets := httptest.NewRecorder()
	s.routes().ServeHTTP(assets, httptest.NewRequest(http.MethodGet, "/assets/logs.js", nil))
	if index.Code != http.StatusOK || assets.Code != http.StatusOK {
		t.Fatalf("page %d, script %d", index.Code, assets.Code)
	}
	return index.Body.String(), assets.Body.String()
}

// @scenario "Severity is a row of counted chips, not a dropdown of floors"
func TestLogViewerSeverityChips(t *testing.T) {
	page, script := viewerPage(t)

	t.Run("when the viewer is rendered", func(t *testing.T) {
		if !strings.Contains(page, `id="log-levels"`) {
			t.Error("the viewer offers severity chips")
		}
		// The dropdown it replaced could only express severity floors, so
		// warnings could not be read without errors mixed into them.
		if strings.Contains(page, `id="log-level"`) {
			t.Error("the severity dropdown should be gone, not sitting beside the chips")
		}
	})

	t.Run("when a severity is switched off", func(t *testing.T) {
		for _, want := range []string{"muted.has(line.level", "muted.delete(name)", "muted.add(name)"} {
			if !strings.Contains(script, want) {
				t.Errorf("a chip toggles its own severity: expected %q", want)
			}
		}
		// Counts come from everything loaded. Counting only what survives the
		// filter would make every count read as the number shown, which is the
		// one number already on the status line.
		if !strings.Contains(script, "for (const line of lines) counts.set(") {
			t.Error("counts should be tallied over the loaded lines, not the visible ones")
		}
	})
}

// @scenario "A search says where it matched, not only which lines it kept"
func TestLogViewerHighlightsMatches(t *testing.T) {
	_, script := viewerPage(t)

	t.Run("when a filter matches inside a line", func(t *testing.T) {
		if !strings.Contains(script, `document.createElement("mark")`) {
			t.Error("the matched substring is marked")
		}
		// A log line is whatever a service printed. The one place it must never
		// be treated as markup is the page that displays it.
		if strings.Contains(script, "innerHTML") {
			t.Error("the viewer must never build a line as markup")
		}
		if !strings.Contains(script, "JSON.stringify([visible, needle])") {
			t.Error("the needle decides what is marked, so it belongs in the render signature")
		}
	})
}

// @scenario "The log viewer is driven from the keyboard"
func TestLogViewerKeyboard(t *testing.T) {
	_, script := viewerPage(t)

	if !strings.Contains(script, `event.key === "/"`) {
		t.Error("slash focuses the filter")
	}
	if !strings.Contains(script, `event.key === "Escape"`) {
		t.Error("escape clears it")
	}
	// Slash is a character someone may be typing into the filter itself, or
	// into the search box of another panel.
	if !strings.Contains(script, "INPUT|TEXTAREA|SELECT") {
		t.Error("the shortcut must stand down while something is being typed into")
	}
}
