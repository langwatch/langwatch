package clickhousenative

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

func writeStdoutLog(t *testing.T, s *Server, size int64) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(s.stdoutPath()), 0o750); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(s.stdoutPath())
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := f.Truncate(size); err != nil { // sparse: no real bytes written
		t.Fatal(err)
	}
}

func stdoutLogSize(t *testing.T, s *Server) int64 {
	t.Helper()
	fi, err := os.Stat(s.stdoutPath())
	if err != nil {
		t.Fatal(err)
	}
	return fi.Size()
}

// @scenario "An oversized stdout log is emptied"
func TestCapLogsEmptiesAnOversizedStdoutLog(t *testing.T) {
	s := New(t.TempDir(), domain.PinnedArtifact{}, domain.ClickHouseLimits{})
	writeStdoutLog(t, s, domain.ClickHouseNativeStdoutLogMax+1)
	// The server's own descriptor, opened as start opens it.
	server, err := os.OpenFile(s.stdoutPath(), os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	defer server.Close()

	s.CapLogs()

	if got := stdoutLogSize(t, s); got != 0 {
		t.Fatalf("stdout.log is %d bytes, want 0", got)
	}
	if _, err := server.WriteString("next line\n"); err != nil {
		t.Fatal(err)
	}
	if got := stdoutLogSize(t, s); got != int64(len("next line\n")) {
		t.Fatalf("after the server's next write stdout.log is %d bytes, want it at the start", got)
	}
}

// @scenario "A stdout log under its cap is kept"
func TestCapLogsKeepsAStdoutLogUnderItsCap(t *testing.T) {
	s := New(t.TempDir(), domain.PinnedArtifact{}, domain.ClickHouseLimits{})
	writeStdoutLog(t, s, domain.ClickHouseNativeStdoutLogMax)

	s.CapLogs()

	if got := stdoutLogSize(t, s); got != domain.ClickHouseNativeStdoutLogMax {
		t.Fatalf("stdout.log is %d bytes, want it untouched", got)
	}
}

func TestCapLogsWithNoStdoutLogDoesNothing(t *testing.T) {
	s := New(t.TempDir(), domain.PinnedArtifact{}, domain.ClickHouseLimits{})
	s.CapLogs()
	if _, err := os.Stat(s.stdoutPath()); !os.IsNotExist(err) {
		t.Fatalf("CapLogs created stdout.log: %v", err)
	}
}
