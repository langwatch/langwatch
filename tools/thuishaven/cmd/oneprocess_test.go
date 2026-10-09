package cmd

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

// @scenario "LANGWATCH_GO_ONE_PROCESS is a warned alias of the one switch"
func TestTheGoOneProcessNameIsAWarnedAlias(t *testing.T) {
	cases := []struct {
		name, newVal, oldVal string
		wantOn, wantAlias    bool
		wantErr              bool
	}{
		{"neither set folds", "", "", true, false, false},
		{"the new name 0 splits", "0", "", false, false, false},
		{"the alias alone is read", "", "0", false, true, false},
		{"the alias alone folds", "", "1", true, true, false},
		{"both agree", "0", "0", false, true, false},
		{"both disagree", "0", "1", false, true, true},
		{"both disagree the other way", "1", "0", true, true, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			on, alias, err := resolveOneProcess(c.newVal, c.oldVal)
			if on != c.wantOn || alias != c.wantAlias || (err != nil) != c.wantErr {
				t.Errorf("got on=%v alias=%v err=%v, want on=%v alias=%v err=%v", on, alias, err, c.wantOn, c.wantAlias, c.wantErr)
			}
		})
	}

	t.Run("the warning names the new switch once", func(t *testing.T) {
		t.Setenv("LANGWATCH_DEV_ONE_PROCESS", "")
		t.Setenv("LANGWATCH_GO_ONE_PROCESS", "0")
		var out bytes.Buffer
		if err := checkOneProcessEnv(&out); err != nil {
			t.Fatal(err)
		}
		if strings.Count(out.String(), "LANGWATCH_DEV_ONE_PROCESS") != 1 {
			t.Errorf("warning %q does not name LANGWATCH_DEV_ONE_PROCESS once", out.String())
		}
	})
	t.Run("a disagreeing pair is refused", func(t *testing.T) {
		t.Setenv("LANGWATCH_DEV_ONE_PROCESS", "0")
		t.Setenv("LANGWATCH_GO_ONE_PROCESS", "1")
		if err := checkOneProcessEnv(&bytes.Buffer{}); err == nil {
			t.Error("haven accepted LANGWATCH_DEV_ONE_PROCESS=0 with LANGWATCH_GO_ONE_PROCESS=1")
		}
	})
	t.Run("the one switch splits the Go child too", func(t *testing.T) {
		t.Setenv("LANGWATCH_DEV_ONE_PROCESS", "0")
		t.Setenv("LANGWATCH_GO_ONE_PROCESS", "")
		if optionsFromEnv(t.TempDir()).ShouldRunGoAsOneProcess {
			t.Error("LANGWATCH_DEV_ONE_PROCESS=0 still folds the simulators into the go lane")
		}
	})
}

// @scenario "The Go watcher is on unless switched off"
func TestTheGoWatcherIsOnUnlessSwitchedOff(t *testing.T) {
	t.Run("when LANGWATCH_GO_WATCH is unset", func(t *testing.T) {
		t.Setenv("LANGWATCH_GO_WATCH", "")
		if err := os.Unsetenv("LANGWATCH_GO_WATCH"); err != nil {
			t.Fatal(err)
		}
		if !optionsFromEnv(t.TempDir()).ShouldGoWatch {
			t.Error("the Go watcher is off by default")
		}
	})
	t.Run("when LANGWATCH_GO_WATCH is 0", func(t *testing.T) {
		t.Setenv("LANGWATCH_GO_WATCH", "0")
		if optionsFromEnv(t.TempDir()).ShouldGoWatch {
			t.Error("LANGWATCH_GO_WATCH=0 still watches")
		}
	})
	t.Run("when up gets --watch=false", func(t *testing.T) {
		var spec commandSpec
		for _, c := range table {
			if c.name == "up" {
				spec = c
			}
		}
		inv, err := parse(spec, []string{"--watch=false"})
		if err != nil {
			t.Fatal(err)
		}
		if inv.value("--watch") != "false" {
			t.Errorf("--watch=false parsed as %q", inv.value("--watch"))
		}
		if _, err := parse(spec, []string{"--watch=maybe"}); err == nil {
			t.Error("--watch=maybe was accepted")
		}
	})
}
