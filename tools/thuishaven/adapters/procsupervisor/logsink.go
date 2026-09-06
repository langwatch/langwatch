package procsupervisor

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// logSinkMaxBytes caps one service's live log file; one rotated generation is
// kept (<file>.1), so a service's footprint is bounded at ~2× this.
const logSinkMaxBytes = 10 << 20

// logSinkRetryAfter is how long the sink waits before it touches the log file
// again after an open or a write failure. A full disk or a log directory that
// is momentarily unwritable then costs one failed syscall per interval instead
// of one per line, and capture comes back on its own once the condition clears.
const logSinkRetryAfter = 5 * time.Second

// logSink captures a supervised child's output lines to a per-service file,
// each line prefixed with an RFC3339Nano timestamp — the tap `haven logs`
// replays, follows, and filters, whether the stack ran attached or detached.
//
// Best-effort by design: a full disk or a permissions hiccup must never take the
// service itself down. Best-effort is not the same as one-way, though. Every
// failure here is transient in the field (a disk that fills and is cleared, a
// directory that is briefly replaced by a worktree switch), so the sink backs
// off and retries rather than going silent for the life of the process, and a
// rotation it cannot complete degrades to appending past the cap.
type logSink struct {
	mu      sync.Mutex
	path    string
	file    *os.File
	written int64
	// rotateAt is the byte count at which rotation is next attempted. It is
	// pushed a whole cap ahead when a rotation fails, so an unrotatable file
	// costs one rename attempt per cap's worth of output rather than one per
	// line, and the open/rotate cycle stays provably finite.
	rotateAt int64
	// retryAt is when a failed open or write may be tried again; the zero time
	// means "now".
	retryAt time.Time
	now     func() time.Time
}

func newLogSink(path string) *logSink {
	if path == "" {
		return nil
	}
	return &logSink{path: path, rotateAt: logSinkMaxBytes, now: time.Now}
}

func (s *logSink) writeLine(line string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.file == nil {
		if s.now().Before(s.retryAt) {
			return
		}
		if err := s.open(); err != nil {
			s.backOff()
			return
		}
	}
	n, err := fmt.Fprintf(s.file, "%s %s\n", s.now().UTC().Format(time.RFC3339Nano), line)
	s.written += int64(n)
	if err != nil {
		// The descriptor is unusable (the disk filled, the file was replaced).
		// Drop it and let a later line open a fresh one.
		_ = s.file.Close()
		s.backOff()
		return
	}
	if s.written >= s.rotateAt {
		s.rotate()
	}
}

// backOff parks capture until logSinkRetryAfter has passed. The file handle is
// dropped, so the next attempt reopens by path and picks up a directory or a
// device that has come back.
func (s *logSink) backOff() {
	s.file = nil
	s.retryAt = s.now().Add(logSinkRetryAfter)
}

// open appends to the existing file (mode 0600 — service output can carry
// seeded credentials), starting the byte counter from its current size so the
// cap holds across restarts.
func (s *logSink) open() error { return s.openFile(true) }

// openFile is open's body. mayRotate exists to make the open/rotate cycle
// provably finite: rotate reopens through openFile(false), so a rename that
// fails to shrink the file can never bounce straight back into rotate. Before
// that, a read-only log directory or a locked file turned "capture the output"
// into unbounded recursion and a stack overflow that took the launcher — and
// with it the whole stack — down.
func (s *logSink) openFile(mayRotate bool) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(s.path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if info, err := f.Stat(); err == nil {
		s.written = info.Size()
	}
	s.file = f
	if mayRotate && s.written >= s.rotateAt {
		s.rotate()
	}
	return nil
}

// rotate moves the live file to its single kept generation and reopens fresh.
// A capture sink must never take the service down, and it must not go quiet
// either: when the rename fails the oversized file stays in place and capture
// keeps appending to it past the cap, with the next attempt a cap's worth of
// output away.
func (s *logSink) rotate() {
	_ = s.file.Close()
	s.file = nil
	if err := os.Rename(s.path, s.path+".1"); err != nil {
		s.rotateAt = s.written + logSinkMaxBytes
		if err := s.openFile(false); err != nil {
			s.backOff()
		}
		return
	}
	s.written = 0
	s.rotateAt = logSinkMaxBytes
	if err := s.openFile(false); err != nil {
		s.backOff()
	}
}
