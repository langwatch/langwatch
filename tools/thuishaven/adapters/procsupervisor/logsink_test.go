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

func TestNilSinkIsANoOp(t *testing.T) {
	var sink *logSink
	sink.writeLine("should not panic") // one-shot lanes have no capture
	if newLogSink("") != nil {
		t.Error("an empty path means no sink")
	}
}
