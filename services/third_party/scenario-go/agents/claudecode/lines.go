package claudecode

import (
	"bytes"
	"context"
	"log/slog"
	"unicode/utf8"
)

// lineWriter splits what is written to it into lines and hands each one,
// without its newline, to line. A line that arrives whole within one write
// is passed without copying; only a line split across writes is buffered,
// in a buffer reused for every later line. The slice passed to line is only
// valid during the call.
type lineWriter struct {
	line func([]byte)
	buf  []byte
}

const initialLineBuffer = 64 << 10

// Write implements io.Writer. It never fails.
func (w *lineWriter) Write(p []byte) (int, error) {
	n := len(p)
	for len(p) > 0 {
		i := bytes.IndexByte(p, '\n')
		if i < 0 {
			if w.buf == nil {
				w.buf = make([]byte, 0, max(initialLineBuffer, len(p)))
			}
			w.buf = append(w.buf, p...)
			break
		}
		if len(w.buf) == 0 {
			w.line(p[:i])
		} else {
			w.buf = append(w.buf, p[:i]...)
			w.line(w.buf)
			w.buf = w.buf[:0]
		}
		p = p[i+1:]
	}
	return n, nil
}

// flush hands over a last line that had no trailing newline.
func (w *lineWriter) flush() {
	if len(w.buf) > 0 {
		w.line(w.buf)
		w.buf = w.buf[:0]
	}
}

// stderrSink keeps everything the CLI writes to stderr and logs it live as
// a warning. A multibyte character split across two writes is held back
// until it is complete, so the log carries what the CLI wrote and never a
// replacement character.
type stderrSink struct {
	logger *slog.Logger
	buf    bytes.Buffer
	logged int
}

// Write implements io.Writer. It never fails.
func (s *stderrSink) Write(p []byte) (int, error) {
	s.buf.Write(p)
	if s.logger.Enabled(context.Background(), slog.LevelWarn) {
		pending := s.buf.Bytes()[s.logged:]
		if n := completeUTF8(pending); n > 0 {
			s.logger.Warn("Claude Code stderr", "data", string(pending[:n]))
			s.logged += n
		}
	}
	return len(p), nil
}

// String returns everything written so far.
func (s *stderrSink) String() string { return s.buf.String() }

// completeUTF8 returns the length of the longest prefix of b that does not
// end inside a multibyte character.
func completeUTF8(b []byte) int {
	for i := len(b) - 1; i >= 0 && i >= len(b)-utf8.UTFMax; i-- {
		if utf8.RuneStart(b[i]) {
			if utf8.FullRune(b[i:]) {
				return len(b)
			}
			return i
		}
	}
	return len(b)
}
