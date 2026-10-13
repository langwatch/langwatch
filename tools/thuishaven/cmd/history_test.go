package cmd

import (
	"strings"
	"testing"
)

// @scenario "An Nx run leaves one history row per task"
func TestReadNxTaskRows(t *testing.T) {
	in := `{"kind":"typecheck","project":"@langwatch/time","target":"typecheck","status":"success","exitCode":0,"startedAt":"2026-10-11T10:00:00.000Z","durationMs":2500,"cacheHit":false,"runId":"r1","worktree":"/w/a"}

{"kind":"test","project":"@langwatch/time","target":"test","status":"local-cache","exitCode":0,"startedAt":"2026-10-11T10:00:00.000Z","durationMs":0,"cacheHit":true,"runId":"r1","worktree":"/w/a"}
`
	rows, err := readNxTaskRows(strings.NewReader(in))
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || !strings.Contains(rows[1], `"cacheHit":true`) || !strings.Contains(rows[0], `"durationMs":2500`) {
		t.Fatalf("rows = %v", rows)
	}
	if _, err := readNxTaskRows(strings.NewReader(`{"kind":"test"}` + "\n")); err == nil {
		t.Fatal("a row with no project or target was accepted")
	}
	if _, err := readNxTaskRows(strings.NewReader("not json\n")); err == nil {
		t.Fatal("a line that is not JSON was accepted")
	}
}
