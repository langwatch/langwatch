package procsupervisor

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// @scenario "Logs are captured no matter how the stack was started"
func TestLogSinkCapturesTimestampedLines(t *testing.T) {
	path := filepath.Join(t.TempDir(), "logs", "slug", "app.log")
	sink := newLogSink(path)
	sink.writeLine("hello world")

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("capture file: %v", err)
	}
	line := strings.TrimSpace(string(b))
	ts, rest, ok := strings.Cut(line, " ")
	if !ok || rest != "hello world" {
		t.Fatalf("line = %q, want '<ts> hello world'", line)
	}
	if _, err := time.Parse(time.RFC3339Nano, ts); err != nil {
		t.Errorf("timestamp %q does not parse: %v", ts, err)
	}
	if info, err := os.Stat(path); err != nil || info.Mode().Perm() != 0o600 {
		t.Errorf("capture must be owner-only (0600), got %v %v", info.Mode(), err)
	}
}

// @scenario "Log files never grow without bound"
func TestLogSinkRotatesAtTheCap(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.log")
	sink := newLogSink(path)
	// A pre-existing file already over the cap rotates on first open.
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, logSinkMaxBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	sink.writeLine("first line after rotation")

	if _, err := os.Stat(path + ".1"); err != nil {
		t.Fatalf("expected the oversized file rotated to .1: %v", err)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "first line after rotation") {
		t.Errorf("live file = %q, want only the fresh line", string(b))
	}
	if len(b) > 1024 {
		t.Errorf("live file should be fresh after rotation, got %d bytes", len(b))
	}
}

// A capture sink must never take the service down, and it must not go quiet
// either. When rotation cannot shrink the file, reopening finds it over the cap
// again, so the failure has to keep appending past the cap instead of
// recursing or disabling capture for the life of the process.
// @scenario "Capture comes back after the log file cannot be written"
func TestLogSinkKeepsAppendingWhenRotationCannotShrinkTheFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app.log")
	if err := os.WriteFile(path, make([]byte, logSinkMaxBytes+1), 0o600); err != nil {
		t.Fatal(err)
	}
	// A read-only directory makes the rename fail the way a locked or
	// permission-denied log directory would in the field.
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

	sink := newLogSink(path)

	done := make(chan struct{})
	go func() {
		defer close(done)
		sink.writeLine("this must not recurse forever")
		sink.writeLine("and this must still be captured")
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("writeLine did not return: rotation is looping instead of giving up")
	}

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"this must not recurse forever", "and this must still be captured"} {
		if !strings.Contains(string(b), want) {
			t.Errorf("line %q was dropped: a stuck rotation must degrade to appending, not to silence", want)
		}
	}
	if sink.rotateAt <= logSinkMaxBytes {
		t.Errorf("rotateAt = %d, want the next attempt a whole cap further on", sink.rotateAt)
	}
}

// An unwritable log directory is transient in the field (a full disk that is
// cleared, a directory replaced during a worktree switch). Capture has to come
// back on its own once it clears, without restarting the service.
// @scenario "Capture comes back after the log file cannot be written"
func TestLogSinkRecoversAfterTheDirectoryBecomesWritableAgain(t *testing.T) {
	dir := t.TempDir()
	nested := filepath.Join(dir, "logs")
	path := filepath.Join(nested, "app.log")
	if err := os.Chmod(dir, 0o500); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chmod(dir, 0o700) })

	clock := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	sink := newLogSink(path)
	sink.now = func() time.Time { return clock }

	sink.writeLine("lost while the directory is unwritable")
	if _, err := os.Stat(path); err == nil {
		t.Fatal("the log file cannot exist yet: its directory is unwritable")
	}

	if err := os.Chmod(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	sink.writeLine("still inside the backoff window")
	if _, err := os.Stat(path); err == nil {
		t.Error("the sink must back off rather than retry the open on every line")
	}

	clock = clock.Add(logSinkRetryAfter + time.Second)
	sink.writeLine("captured again")

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("capture did not recover: %v", err)
	}
	if !strings.Contains(string(b), "captured again") {
		t.Errorf("live file = %q, want the line written after recovery", string(b))
	}
}

// A write that fails mid-life (the disk fills, the file is replaced) drops the
// descriptor; the next line past the backoff reopens by path.
func TestLogSinkReopensAfterAWriteFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "app.log")
	clock := time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	sink := newLogSink(path)
	sink.now = func() time.Time { return clock }
	sink.writeLine("first")

	// Closing the handle behind the sink's back is the cheapest stand-in for a
	// descriptor that has become unusable.
	if err := sink.file.Close(); err != nil {
		t.Fatal(err)
	}
	sink.writeLine("lost on the broken descriptor")
	if sink.file != nil {
		t.Error("a failed write must drop the descriptor so a later line can reopen")
	}

	clock = clock.Add(logSinkRetryAfter + time.Second)
	sink.writeLine("after reopening")

	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "first") || !strings.Contains(string(b), "after reopening") {
		t.Errorf("live file = %q, want the lines from before and after the failure", string(b))
	}
}

func TestNilSinkIsANoOp(t *testing.T) {
	var sink *logSink
	sink.writeLine("should not panic") // one-shot lanes have no capture
	if newLogSink("") != nil {
		t.Error("an empty path means no sink")
	}
}
