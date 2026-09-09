package viewer

import (
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// pushLines writes n lines straight into a sub-tab's ring, the way the file
// tail would have, so these tests exercise position and search rather than
// ingestion.
func pushLines(tab *LogsTab, app, label string, n int) {
	for i := 0; i < n; i++ {
		tab.Observe(sources.LogLine{
			At: time.Now(), Lane: app,
			Text: `{"level":"info","msg":"` + label + " " + itoa(i) + `"}`,
		})
	}
}

// scrollTab is a logs tab with one application's worth of output in it.
func scrollTab(t *testing.T, lines int) *LogsTab {
	t.Helper()
	tab, _, _ := logsTab(t, false)
	pushLines(tab, "ui", "line", lines)
	return tab
}

// @scenario "Scrolling back leaves following mode"
func TestScrollingBackLeavesFollowing(t *testing.T) {
	for _, k := range []string{"pgup", "up", "k", "wheelup", "home"} {
		t.Run("when the developer scrolls with "+k, func(t *testing.T) {
			tab := scrollTab(t, 200)
			tab.SelectSubTab("ui")
			if !tab.Key(k) {
				t.Fatalf("%q was not claimed by the logs tab", k)
			}
			if tab.pages.scroll["ui"] == 0 {
				t.Fatalf("%q left the view following, want it scrolled back", k)
			}
			footer := tab.Footer()
			if !strings.Contains(footer, "lines above") {
				t.Errorf("footer = %q, want it to say how far back the view is", footer)
			}
			if !strings.Contains(footer, "f to follow") {
				t.Errorf("footer = %q, want it to name f as the way back", footer)
			}
		})
	}
}

// @scenario "New output does not yank a scrolled-back view"
func TestNewOutputDoesNotYankAScrolledBackView(t *testing.T) {
	tab := scrollTab(t, 200)
	tab.SelectSubTab("ui")
	tab.Key("pgup")
	before := texts(tab.pages.visible("ui", 10))
	back := tab.pages.scroll["ui"]

	pushLines(tab, "ui", "later", 5)
	if got := texts(tab.pages.visible("ui", 10)); strings.Join(got, "|") != strings.Join(before, "|") {
		t.Errorf("the window moved under the reader:\n before %v\n after  %v", before, got)
	}
	if tab.pages.scroll["ui"] != back+5 {
		t.Errorf("scrolled-back indicator = %d, want it to grow to %d with the new lines", tab.pages.scroll["ui"], back+5)
	}
}

// @scenario "Returning to the bottom resumes following"
func TestReturningToTheBottomResumesFollowing(t *testing.T) {
	for _, k := range []string{"f", "end"} {
		t.Run("when the developer presses "+k, func(t *testing.T) {
			tab := scrollTab(t, 200)
			tab.SelectSubTab("ui")
			tab.Key("pgup")
			tab.Key(k)
			if tab.pages.scroll["ui"] != 0 {
				t.Fatalf("%q left the view scrolled back", k)
			}
			if strings.Contains(tab.Footer(), "lines above") {
				t.Errorf("footer = %q, want the scrolled-back indicator gone", tab.Footer())
			}
		})
	}
}

// @scenario "Slash opens a search prompt in the footer"
func TestSlashOpensASearchPrompt(t *testing.T) {
	tab := scrollTab(t, 50)
	tab.Key("/")
	if !strings.Contains(tab.Footer(), "enter searches") {
		t.Errorf("footer = %q, want the search prompt", tab.Footer())
	}
	for _, k := range []string{"f", "1", "n"} {
		if !tab.Key(k) {
			t.Errorf("%q escaped the open prompt, want it captured as text", k)
		}
	}
	if tab.pages.input != "f1n" {
		t.Errorf("input = %q, want the keystrokes captured as text", tab.pages.input)
	}
}

// @scenario "Enter jumps to the nearest match and highlights every match on screen"
func TestEnterJumpsToTheNearestMatchAndHighlights(t *testing.T) {
	tab, _, _ := logsTab(t, false)
	pushLines(tab, "ui", "filler", 100)
	tab.Observe(sources.LogLine{At: time.Now(), Lane: "ui", Text: `{"level":"info","msg":"NEEDLE here"}`})
	pushLines(tab, "ui", "filler", 100)
	tab.SelectSubTab("ui")
	tab.Key("pgup")
	tab.Key("pgup")

	tab.Key("/")
	for _, r := range "needle" {
		tab.Key(string(r))
	}
	tab.Key("enter")

	visible := strings.Join(texts(tab.pages.visible("ui", 5)), "\n")
	if !strings.Contains(visible, "NEEDLE") {
		t.Fatalf("view did not jump to the match, showing:\n%s", visible)
	}
	if !strings.Contains(highlight("a NEEDLE line", "needle"), sgrReverse) {
		t.Error("the match is not highlighted - the search is meant to be case-insensitive")
	}
}

// @scenario "n and N step across the whole buffer of the current tab"
func TestStepAcrossTheWholeBuffer(t *testing.T) {
	tab, _, _ := logsTab(t, false)
	for i := 0; i < 3; i++ {
		pushLines(tab, "ui", "filler", 30)
		tab.Observe(sources.LogLine{At: time.Now(), Lane: "ui", Text: `{"level":"info","msg":"mark ` + itoa(i) + `"}`})
	}
	tab.SelectSubTab("ui")
	commit(tab, "mark")

	first := tab.pages.matchIdx
	tab.Key("n")
	if tab.pages.matchIdx == first {
		t.Fatal("n did not move to another match")
	}
	tab.Key("n")
	tab.Key("n")
	if tab.pages.matchIdx != first {
		t.Errorf("matchIdx = %d after wrapping past the last match, want %d", tab.pages.matchIdx, first)
	}
	tab.Key("N")
	if tab.pages.matchIdx == first {
		t.Error("N did not step backward")
	}
}

// commit types a query into the open prompt and commits it.
func commit(tab *LogsTab, query string) {
	tab.Key("/")
	for _, r := range query {
		tab.Key(string(r))
	}
	tab.Key("enter")
}

// @scenario "Escape clears the search"
func TestEscapeClearsTheSearch(t *testing.T) {
	tab := scrollTab(t, 50)
	tab.SelectSubTab("ui")
	commit(tab, "line 1")
	if tab.pages.query == "" {
		t.Fatal("the query was not committed")
	}
	if !tab.Key("esc") {
		t.Fatal("esc was not claimed while a search was active")
	}
	if tab.pages.query != "" {
		t.Errorf("query = %q, want esc to clear it", tab.pages.query)
	}
	if tab.Key("esc") {
		t.Error("esc was claimed a second time - with nothing to back out of it belongs to the viewer")
	}
}

// @scenario "A search persists across tabs"
func TestASearchPersistsAcrossSubTabs(t *testing.T) {
	tab, _, _ := logsTab(t, false)
	pushLines(tab, "ui", "shared", 20)
	tab.Observe(sources.LogLine{At: time.Now(), Lane: "go",
		Text: `{"service":"langwatch-service-nlpgo","level":"info","msg":"shared word here"}`})
	tab.SelectSubTab("ui")
	commit(tab, "shared")

	tab.Key("]")
	if tab.pages.query != "shared" {
		t.Errorf("query = %q after switching sub-tabs, want it still active", tab.pages.query)
	}
	tab.SelectSubTab("nlp")
	if got := tab.pages.matches("nlp"); len(got) != 1 {
		t.Errorf("matches on nlp = %v, want it to search that sub-tab's own buffer", got)
	}
}

// @scenario "Existing bindings keep working"
func TestPagerLeavesTheViewersOwnKeysAlone(t *testing.T) {
	tab := scrollTab(t, 20)
	for _, k := range []string{"1", "2", "q", "X", "tab", "shift+tab", "left", "right", "ctrl+c"} {
		if tab.Key(k) {
			t.Errorf("the logs tab claimed %q - that binding belongs to the viewer", k)
		}
	}
}

// A Mac laptop keyboard has no page up, no page down, no home and no end. A
// footer naming only those is a footer telling most readers they cannot move.
// @scenario "Paging works from a keyboard with no page keys"
func TestPagingFromAKeyboardWithNoPageKeys(t *testing.T) {
	newTab := func(t *testing.T) *LogsTab {
		t.Helper()
		tab := scrollTab(t, 400)
		tab.SelectSubTab("ui")
		tab.Body(Frame{Width: 120, Height: 20}) // the budget is exact: twenty rows
		return tab
	}

	cases := []struct {
		name string
		keys []string
		want int
	}{
		{name: "space pages down from the bottom, which is nowhere to go", keys: []string{" "}, want: 0},
		{name: "b pages up", keys: []string{"b"}, want: 20},
		{name: "b then space returns", keys: []string{"b", " "}, want: 0},
		{name: "u moves half a page up", keys: []string{"u"}, want: 10},
		{name: "ctrl+u moves half a page up", keys: []string{"ctrl+u"}, want: 10},
		{name: "d moves half a page back down", keys: []string{"b", "d"}, want: 10},
		{name: "ctrl+d moves half a page back down", keys: []string{"b", "ctrl+d"}, want: 10},
		{name: "g jumps to the top", keys: []string{"g"}, want: 400},
		{name: "G returns to the bottom", keys: []string{"g", "G"}, want: 0},
		{name: "the page keys still work where a keyboard has them", keys: []string{"pgup"}, want: 20},
		{name: "home and end still work too", keys: []string{"home", "end"}, want: 0},
	}
	for _, tc := range cases {
		t.Run("when the developer presses "+strings.Join(tc.keys, " then "), func(t *testing.T) {
			tab := newTab(t)
			for _, k := range tc.keys {
				if !tab.Key(k) {
					t.Fatalf("%q was not claimed by the logs tab", k)
				}
			}
			if got := tab.pages.scroll["ui"]; got != tc.want {
				t.Errorf("scrolled back %d lines, want %d", got, tc.want)
			}
		})
	}

	t.Run("the footer names the keys a laptop actually has", func(t *testing.T) {
		footer := newTab(t).Footer()
		for _, want := range []string{"space/b page", "d/u half", "g/G top/bottom"} {
			if !strings.Contains(footer, want) {
				t.Errorf("footer = %q, want it to name %q", footer, want)
			}
		}
		if strings.Contains(footer, "pgup/pgdn") || strings.Contains(footer, "home/end") {
			t.Errorf("footer = %q, want it to stop advertising keys a laptop has not got", footer)
		}
	})
}
