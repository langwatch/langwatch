package procsupervisor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
)

// @scenario "The one-process lane's logs are captured per application"
func TestSplitCaptureFilesEachLineUnderTheApplicationThatWroteIt(t *testing.T) {
	dir := t.TempDir()
	stale := filepath.Join(dir, "app.log")
	if err := os.WriteFile(stale, []byte("old whole-lane capture\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	c := proc{name: app.AppLane, isPlain: true, preview: &recentLogs{},
		sink: newCapture(app.Child{Name: app.AppLane, LogPath: stale, SplitLog: true}, time.Time{})}
	var w rawWindow
	c.captureLine(&w, `{"level":"info","service":"langwatch-worker","msg":"drained queue"}`)
	c.captureLine(&w, `{"level":"info","service":"langwatch-api","msg":"GET /api/health"}`)
	c.captureLine(&w, `{"level":"warn","service":"langwatch-app","msg":"boot failed; waiting for a change: boom"}`)
	c.captureLine(&w, "vite v7 building for production...")
	c.logln(`{"level":"warn","msg":"exited — restarting in 1s"}`)

	read := func(name string) string {
		b, _ := os.ReadFile(filepath.Join(dir, name+".log"))
		return string(b)
	}
	want := map[string][]string{
		"worker": {"drained queue", "boot failed", "restarting"},
		"api":    {"GET /api/health", "boot failed", "restarting"},
		"ui":     {"vite v7 building"},
	}
	refused := map[string][]string{
		"worker": {"GET /api/health", "vite v7"},
		"api":    {"drained queue", "vite v7"},
		"ui":     {"drained queue", "GET /api/health", "boot failed", "restarting"},
	}
	for name, needles := range want {
		got := read(name)
		for _, needle := range needles {
			if !strings.Contains(got, needle) {
				t.Errorf("%s.log lacks %q:\n%s", name, needle, got)
			}
		}
		for _, needle := range refused[name] {
			if strings.Contains(got, needle) {
				t.Errorf("%s.log holds %q, another application's line:\n%s", name, needle, got)
			}
		}
	}
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Errorf("app.log is still listed beside its split: %v", err)
	}
}

func TestSplitCaptureOfTheAPILaneKeepsPlainOutputWithBothHalves(t *testing.T) {
	dir := t.TempDir()
	c := newCapture(app.Child{Name: app.APILane, LogPath: filepath.Join(dir, "api.log"), SplitLog: true}, time.Time{})
	c.write("node:internal/modules/run_main:123", false)
	for _, name := range []string{"api", "worker"} {
		if b, _ := os.ReadFile(filepath.Join(dir, name+".log")); !strings.Contains(string(b), "run_main") {
			t.Errorf("%s.log lacks the backend lane's plain output", name)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, "ui.log")); !os.IsNotExist(err) {
		t.Errorf("the api lane wrote a ui capture: %v", err)
	}
}
