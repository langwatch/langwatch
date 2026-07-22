package cmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeLog(t *testing.T, dir, service string, lines ...string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, service+".log"), []byte(strings.Join(lines, "\n")+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339Nano) }

// @scenario "Everything, labelled and interleaved"
func TestReadLogTailsInterleavesByTime(t *testing.T) {
	dir := t.TempDir()
	base := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	writeLog(t, dir, "nlp", stamp(base.Add(2*time.Second))+" nlp second")
	writeLog(t, dir, "app", stamp(base.Add(1*time.Second))+" app first", stamp(base.Add(3*time.Second))+" app third")

	lines, offsets := readLogTails(dir, []string{"app", "nlp"})
	if len(lines) != 3 {
		t.Fatalf("lines = %d, want 3", len(lines))
	}
	order := []string{lines[0].text, lines[1].text, lines[2].text}
	if order[0] != "app first" || order[1] != "nlp second" || order[2] != "app third" {
		t.Errorf("merge order = %v, want time order across services", order)
	}
	if offsets["app"] == 0 || offsets["nlp"] == 0 {
		t.Error("offsets must record each live file's end for follow to continue from")
	}
}

// @scenario "Filtering to one service is a plain argument"
func TestSelectLogServices(t *testing.T) {
	dir := t.TempDir()
	writeLog(t, dir, "app", stamp(time.Now())+" x")
	writeLog(t, dir, "langyagent", stamp(time.Now())+" y")

	t.Run("when no service is named, every captured one is read", func(t *testing.T) {
		got, err := selectLogServices(dir, nil)
		if err != nil {
			t.Fatalf("selectLogServices: %v", err)
		}
		if len(got) != 2 {
			t.Errorf("got %v, want both services", got)
		}
	})

	t.Run("when the CLI name langy is used, the langyagent capture is read", func(t *testing.T) {
		got, err := selectLogServices(dir, []string{"langy"})
		if err != nil {
			t.Fatalf("selectLogServices: %v", err)
		}
		if len(got) != 1 || got[0] != "langyagent" {
			t.Errorf("got %v, want the langyagent capture", got)
		}
	})

	t.Run("when a service has no capture, the error lists what exists in CLI spelling", func(t *testing.T) {
		_, err := selectLogServices(dir, []string{"nlp"})
		if err == nil || !strings.Contains(err.Error(), "langy") || strings.Contains(err.Error(), "langyagent") {
			t.Fatalf("want available services in CLI spelling, got %v", err)
		}
	})
}

// @scenario "A time window is one flag"
// @scenario "Severity is a filter, not a grep"
func TestFilterLogLines(t *testing.T) {
	base := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	lines := []logLine{
		{ts: base, service: "app", text: "INFO booted"},
		{ts: base.Add(time.Minute), service: "app", text: "WARN slow query"},
		{ts: base.Add(2 * time.Minute), service: "nlp", text: "ERROR exploded"},
		{ts: base.Add(3 * time.Minute), service: "nlp", text: "no level here"},
	}

	t.Run("since drops older lines", func(t *testing.T) {
		got := filterLogLines(lines, base.Add(90*time.Second), "")
		if len(got) != 2 {
			t.Errorf("got %d lines, want the 2 after the window start", len(got))
		}
	})

	t.Run("level warn keeps warn and worse only", func(t *testing.T) {
		got := filterLogLines(lines, time.Time{}, "warn")
		if len(got) != 2 || got[0].text != "WARN slow query" || got[1].text != "ERROR exploded" {
			t.Errorf("got %v, want the warn and error lines", got)
		}
	})

	t.Run("no filter passes level-less lines through", func(t *testing.T) {
		if got := filterLogLines(lines, time.Time{}, ""); len(got) != 4 {
			t.Errorf("got %d, want all 4", len(got))
		}
	})
}

// @scenario "Logs outlive the stack"
func TestReadLogTailsIncludesRotatedGeneration(t *testing.T) {
	dir := t.TempDir()
	base := time.Date(2026, 7, 23, 10, 0, 0, 0, time.UTC)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app.log.1"), []byte(stamp(base)+" old generation\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	writeLog(t, dir, "app", stamp(base.Add(time.Second))+" live generation")

	lines, _ := readLogTails(dir, []string{"app"})
	if len(lines) != 2 || lines[0].text != "old generation" {
		t.Errorf("lines = %v, want the rotated generation first", lines)
	}
}
