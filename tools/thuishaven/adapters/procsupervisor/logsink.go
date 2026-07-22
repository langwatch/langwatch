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

// logSink captures a supervised child's output lines to a per-service file,
// each line prefixed with an RFC3339Nano timestamp — the tap `haven logs`
// replays, follows, and filters, whether the stack ran attached or detached.
// Best-effort by design: a full disk or a permissions hiccup must never take
// the service itself down, so write errors are swallowed after disabling the
// sink for this process's lifetime.
type logSink struct {
	mu       sync.Mutex
	path     string
	file     *os.File
	written  int64
	disabled bool
}

func newLogSink(path string) *logSink {
	if path == "" {
		return nil
	}
	return &logSink{path: path}
}

func (s *logSink) writeLine(line string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.disabled {
		return
	}
	if s.file == nil {
		if err := s.open(); err != nil {
			s.disabled = true
			return
		}
	}
	n, err := fmt.Fprintf(s.file, "%s %s\n", time.Now().UTC().Format(time.RFC3339Nano), line)
	if err != nil {
		s.disabled = true
		return
	}
	s.written += int64(n)
	if s.written >= logSinkMaxBytes {
		s.rotate()
	}
}

// open appends to the existing file (mode 0600 — service output can carry
// seeded credentials), starting the byte counter from its current size so the
// cap holds across restarts.
func (s *logSink) open() error {
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
	if s.written >= logSinkMaxBytes {
		s.rotate()
	}
	return nil
}

// rotate moves the live file to its single kept generation and reopens fresh.
func (s *logSink) rotate() {
	_ = s.file.Close()
	s.file = nil
	_ = os.Rename(s.path, s.path+".1")
	s.written = 0
	if err := s.open(); err != nil {
		s.disabled = true
	}
}
