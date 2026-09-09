package cmd

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer"
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// tabCommandFor is the command that prints one tab's rows. Two of the eight
// tabs are printed by a command that already existed, because ADR-064 allows
// exactly one name per command.
var tabCommandFor = map[string]string{
	"session": "status",
	"logs":    "logs",
}

// @scenario "Every tab has a plain form for agents"
func TestEveryTabHasAPlainForm(t *testing.T) {
	for _, tab := range viewer.TabNames {
		t.Run("when haven "+tab+" --json is run", func(t *testing.T) {
			name := tab
			if alias, ok := tabCommandFor[tab]; ok {
				name = alias
			}
			spec, ok := tableByName[name]
			if !ok {
				t.Fatalf("the %q tab has no command - an agent cannot read it", tab)
			}
			if !declaresFlag(spec, "--json") {
				t.Errorf("haven %s does not declare --json", name)
			}
		})
	}
}

func declaresFlag(spec commandSpec, long string) bool {
	for _, flag := range spec.flags {
		if flag.long == long {
			return true
		}
	}
	return false
}

// The command prints the tab's own rows, not a second rendering of the same
// data: a tab and its command that computed their rows separately would drift.
// @scenario "Every tab has a plain form for agents"
func TestTabCommandPrintsTheTabsOwnRows(t *testing.T) {
	m := newViewerModel("feat-x", filepath.Join(t.TempDir(), "c.log"), t.TempDir())
	m.install(viewer.Sources{
		Files: &sources.MemoryLogs{},
		Jobs: &sources.MemoryJobs{History: []sources.JobRun{
			{Name: "prepare", At: time.Now(), Duration: time.Second},
		}},
		Now: time.Now,
	})
	tab := m.tabs["jobs"]
	tab.Poll()

	printed := captureStdout(t, func() {
		if err := printTabJSON(tab); err != nil {
			t.Fatal(err)
		}
	})
	want, err := json.Marshal(tab.Rows())
	if err != nil {
		t.Fatal(err)
	}
	var got, expected any
	if err := json.Unmarshal([]byte(printed), &got); err != nil {
		t.Fatalf("the command printed something that is not JSON: %s", printed)
	}
	if err := json.Unmarshal(want, &expected); err != nil {
		t.Fatal(err)
	}
	gotAgain, _ := json.Marshal(got)
	wantAgain, _ := json.Marshal(expected)
	if !bytes.Equal(gotAgain, wantAgain) {
		t.Errorf("command printed %s, want the tab's own rows %s", gotAgain, wantAgain)
	}
}
