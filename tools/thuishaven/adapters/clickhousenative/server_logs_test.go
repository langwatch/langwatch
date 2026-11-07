package clickhousenative

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The daemon finds CapLogs by type assertion, so a drifted signature would
// silently stop the cap: keep the server bound to the interface.
var _ app.LogCapper = (*Server)(nil)

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

	emptied, err := s.CapLogs()
	if err != nil {
		t.Fatal(err)
	}

	if got := stdoutLogSize(t, s); got != 0 {
		t.Fatalf("stdout.log is %d bytes, want 0", got)
	}
	if emptied != domain.ClickHouseNativeStdoutLogMax+1 {
		t.Fatalf("CapLogs reported %d bytes emptied, want %d", emptied, domain.ClickHouseNativeStdoutLogMax+1)
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

	if emptied, err := s.CapLogs(); emptied != 0 || err != nil {
		t.Fatalf("CapLogs = %d, %v; want 0, nil", emptied, err)
	}

	if got := stdoutLogSize(t, s); got != domain.ClickHouseNativeStdoutLogMax {
		t.Fatalf("stdout.log is %d bytes, want it untouched", got)
	}
}

func TestCapLogsWithNoStdoutLogDoesNothing(t *testing.T) {
	s := New(t.TempDir(), domain.PinnedArtifact{}, domain.ClickHouseLimits{})
	if emptied, err := s.CapLogs(); emptied != 0 || err != nil {
		t.Fatalf("CapLogs = %d, %v; want 0, nil", emptied, err)
	}
	if _, err := os.Stat(s.stdoutPath()); !os.IsNotExist(err) {
		t.Fatalf("CapLogs created stdout.log: %v", err)
	}
}

// @scenario "An oversized stdout log haven cannot empty reports why"
func TestCapLogsReportsATruncateItCannotDo(t *testing.T) {
	if os.Geteuid() == 0 {
		t.Skip("root writes through a read-only mode")
	}
	s := New(t.TempDir(), domain.PinnedArtifact{}, domain.ClickHouseLimits{})
	writeStdoutLog(t, s, domain.ClickHouseNativeStdoutLogMax+1)
	if err := os.Chmod(s.stdoutPath(), 0o400); err != nil {
		t.Fatal(err)
	}

	emptied, err := s.CapLogs()

	if err == nil || emptied != 0 {
		t.Fatalf("CapLogs = %d, %v; want 0 and the truncate error", emptied, err)
	}
	if got := stdoutLogSize(t, s); got != domain.ClickHouseNativeStdoutLogMax+1 {
		t.Fatalf("stdout.log is %d bytes, want it untouched", got)
	}
}

// @scenario "Starting ClickHouse caps the log before installing the binary"
func TestEnsureCapsTheLogBeforeInstallingTheBinary(t *testing.T) {
	// No artifact is pinned, so installing the binary fails: anything Ensure
	// did to the log happened before the install.
	s := New(t.TempDir(), domain.PinnedArtifact{}, domain.ClickHouseLimits{})
	writeStdoutLog(t, s, domain.ClickHouseNativeStdoutLogMax+1)

	if _, err := s.Ensure(context.Background()); err == nil {
		t.Fatal("Ensure succeeded with no pinned binary")
	}

	if got := stdoutLogSize(t, s); got != 0 {
		t.Fatalf("stdout.log is %d bytes, want it emptied before the install", got)
	}
}
