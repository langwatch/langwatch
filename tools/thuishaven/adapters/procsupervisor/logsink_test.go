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

// A capture sink must never take the service down. When rotation cannot
// shrink the file, reopening finds it over the cap and rotates again — so the
// failure has to disable capture rather than recurse.
func TestLogSinkGivesUpWhenRotationCannotShrinkTheFile(t *testing.T) {
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
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("writeLine did not return: rotation is looping instead of giving up")
	}

	if !sink.disabled {
		t.Error("a sink that cannot rotate must disable itself rather than retry indefinitely")
	}
}

func TestNilSinkIsANoOp(t *testing.T) {
	var sink *logSink
	sink.writeLine("should not panic") // one-shot lanes have no capture
	if newLogSink("") != nil {
		t.Error("an empty path means no sink")
	}
}
