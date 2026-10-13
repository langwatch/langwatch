package cmd

import (
	"strings"
	"testing"
)

func TestBrowserMemoryLineNamesTheLimit(t *testing.T) {
	line := browserMemory{usedMB: 1800, limitMB: 8192, unloadAboveMB: 6144, killAboveMB: 10240}.line()
	for _, want := range []string{"1800 MB of the 8192 MB limit", "browser-memory-mb", "unload above 6144 MB", "above 10240 MB"} {
		if !strings.Contains(line, want) {
			t.Errorf("line %q lacks %q", line, want)
		}
	}
	idle := browserMemory{usedMB: -1, limitMB: 4096, killAboveMB: 5120}.line()
	if !strings.Contains(idle, "memory limit 4096 MB") || strings.Contains(idle, "unload") {
		t.Errorf("no-browser line = %q", idle)
	}
}

func TestDaemonLimitPrefersTheRunningDaemon(t *testing.T) {
	if got := daemonLimitMB(map[string]any{"limitMb": float64(2048)}, 8192); got != 2048 {
		t.Errorf("got %d, want the daemon's 2048", got)
	}
	if got := daemonLimitMB(map[string]any{"running": true}, 8192); got != 8192 {
		t.Errorf("got %d, want haven's 8192 for an older daemon", got)
	}
}
