package procsupervisor

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// @scenario "The restart line itself renders at warn, not with no level"
func TestLevelRecordLineRendersAtTheGivenLevel(t *testing.T) {
	line := levelRecordLine("warn", "exited — restarting in 1s", time.Time{})

	rec, ok := logfmt.Parse(line)
	if !ok {
		t.Fatalf("expected a parseable structured line, got %q", line)
	}
	if rec.Level != logfmt.LevelWarn {
		t.Fatalf("expected level warn, got %q", rec.Level)
	}
	if rec.Message != "exited — restarting in 1s" {
		t.Fatalf("unexpected message: %q", rec.Message)
	}
}

// @scenario "A repeated identical crash is rendered once with a counter"
func TestCrashDedupCollapsesARepeatedMessageIntoACounter(t *testing.T) {
	d := &crashDedup{}

	first, repeat := d.observe("missing package: cannot find '@langwatch/api'")
	if repeat {
		t.Fatal("the first occurrence of a failure must not read as a repeat")
	}
	if first != "missing package: cannot find '@langwatch/api'" {
		t.Fatalf("expected the message unchanged, got %q", first)
	}

	second, repeat := d.observe("missing package: cannot find '@langwatch/api'")
	if !repeat {
		t.Fatal("an identical second occurrence must read as a repeat")
	}
	if second != "same failure, restart 2" {
		t.Fatalf("expected a counter line, got %q", second)
	}

	third, repeat := d.observe("missing package: cannot find '@langwatch/api'")
	if !repeat || third != "same failure, restart 3" {
		t.Fatalf("expected the counter to keep advancing, got repeat=%v msg=%q", repeat, third)
	}
}

// @scenario "A different crash after a repeat is rendered in full again"
func TestCrashDedupRendersInFullAfterADifferentFailure(t *testing.T) {
	d := &crashDedup{}
	d.observe("missing package: cannot find '@langwatch/api'")
	d.observe("missing package: cannot find '@langwatch/api'")

	msg, repeat := d.observe("missing export: module '@langwatch/experiment-server' does not export 'createExperimentsRestApp'")
	if repeat {
		t.Fatal("a different failure must not be folded into the previous counter")
	}
	if msg != "missing export: module '@langwatch/experiment-server' does not export 'createExperimentsRestApp'" {
		t.Fatalf("expected the new message unchanged, got %q", msg)
	}
}

// @scenario "A repeated identical crash is rendered once with a counter"
// Through proc.dedupeFatal, the seam logln actually calls, so the whole line
// (not just the message) is asserted here.
func TestDedupeFatalRewritesARepeatedFatalLineButLeavesTheFirstAlone(t *testing.T) {
	c := proc{name: "api", crash: &crashDedup{}}
	fatal := func(msg string) string {
		encoded, err := json.Marshal(map[string]string{
			"time": "2026-09-10T03:11:57.484Z", "level": "fatal", "msg": msg,
		})
		if err != nil {
			t.Fatalf("could not build a fixture line: %v", err)
		}
		return string(encoded)
	}
	crashLine := fatal("missing export: module '@langwatch/experiment-server' does not export 'createExperimentsRestApp' (imported at apps/api/src/index.ts:180)")

	first := c.dedupeFatal(crashLine)
	if first != crashLine {
		t.Fatalf("the first occurrence must render unchanged, got %q", first)
	}

	second := c.dedupeFatal(crashLine)
	rec, ok := logfmt.Parse(second)
	if !ok || rec.Level != logfmt.LevelFatal {
		t.Fatalf("expected a fatal record, got %q", second)
	}
	if rec.Message != "same failure, restart 2" {
		t.Fatalf("expected the counter form, got %q", rec.Message)
	}
}

// A non-fatal line (info, warn, a passthrough banner) is never touched by the
// dedup seam — only a fatal record's own repeats are folded.
func TestDedupeFatalLeavesNonFatalLinesAlone(t *testing.T) {
	c := proc{name: "api", crash: &crashDedup{}}
	line := `{"time":"2026-09-10T03:11:57.484Z","level":"info","msg":"listening"}`

	if got := c.dedupeFatal(line); got != line {
		t.Fatalf("an info line must pass through unchanged, got %q", got)
	}
}

// A proc built without a crash tracker (RunOnce, RunOnceBounded, WaitReady —
// none of them restart) must never panic on a nil field.
func TestDedupeFatalIsANoOpWithoutACrashTracker(t *testing.T) {
	c := proc{name: "reap-test"}
	line := `{"time":"2026-09-10T03:11:57.484Z","level":"fatal","msg":"boom"}`

	if got := c.dedupeFatal(line); got != line {
		t.Fatalf("expected the line unchanged with no crash tracker, got %q", got)
	}
}
