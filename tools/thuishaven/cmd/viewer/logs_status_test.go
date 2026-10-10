package viewer

import (
	"strings"
	"testing"
)

// @scenario "A log sub-tab carries the health of the application behind it"
func TestLogSubTabsCarryTheirApplicationsHealth(t *testing.T) {
	newTab := func(up map[string]bool, known map[string]bool) *LogsTab {
		tab := NewLogsTab(Sources{
			AppUp: func(app string) (bool, bool) { return up[app], known[app] },
		})
		for app := range known {
			tab.apps[app] = true
		}
		return tab
	}

	t.Run("when an application is answering, its sub-tab is marked green", func(t *testing.T) {
		tab := newTab(map[string]bool{"api": true}, map[string]bool{"api": true})
		if line := tab.Header()[0]; !strings.Contains(line, "\x1b[32m●\x1b[0m") {
			t.Errorf("header = %q, want a green mark on the answering application", line)
		}
	})

	t.Run("when an application is down, its sub-tab is marked red", func(t *testing.T) {
		tab := newTab(map[string]bool{"worker": false}, map[string]bool{"worker": true})
		if line := tab.Header()[0]; !strings.Contains(line, "\x1b[31m●\x1b[0m") {
			t.Errorf("header = %q, want a red mark on the application that is down", line)
		}
	})

	// An absent probe is not a service that is down, and "all" is every
	// application at once, so neither claims a health it cannot have.
	t.Run("when haven supervises nothing behind a sub-tab, it carries no mark", func(t *testing.T) {
		tab := newTab(map[string]bool{}, map[string]bool{"obs": false})
		line := tab.Header()[0]
		if strings.Contains(line, "●") {
			t.Errorf("header = %q, want no mark where there is no probe", line)
		}
	})

	t.Run("when no health source is wired at all, the bar still renders", func(t *testing.T) {
		tab := NewLogsTab(Sources{})
		tab.apps["api"] = true
		if line := tab.Header()[0]; !strings.Contains(line, "api") {
			t.Errorf("header = %q, want the sub-tabs to render without a health source", line)
		}
	})
}
