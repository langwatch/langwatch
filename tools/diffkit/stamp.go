// Package diffkit holds the pieces visualdiff, apidiff, the fuzzer and the
// simulator share: line stamping, log-signature scanning, a findings stream,
// a flock helper, the shared-stack target and org-per-tool seeding.
package diffkit

import (
	"bytes"
	"io"
	"sync"
	"time"
)

// StampedWriter opens every line it writes with the time it was written, so a
// run log says when each phase started and ended.
type StampedWriter struct {
	mu      sync.Mutex
	out     io.Writer
	now     func() time.Time
	midLine bool
	// Layout is the stamp's time layout and what follows it; empty is a run
	// log's millisecond layout.
	Layout string
}

// NewStampedWriter stamps every line written to out with now's clock time.
func NewStampedWriter(out io.Writer, now func() time.Time) *StampedWriter {
	return &StampedWriter{out: out, now: now}
}

// ClockLines opens every line with the wall-clock time, [15:04:05].
func ClockLines(out io.Writer) io.Writer {
	return &StampedWriter{out: out, now: time.Now, Layout: "[15:04:05] "}
}

func (writer *StampedWriter) Write(chunk []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	var buffer bytes.Buffer
	for rest := chunk; len(rest) > 0; {
		if !writer.midLine {
			layout := writer.Layout
			if layout == "" {
				layout = "15:04:05.000 "
			}
			buffer.WriteString(writer.now().Format(layout))
		}
		end := bytes.IndexByte(rest, '\n')
		if end < 0 {
			buffer.Write(rest)
			writer.midLine = true
			break
		}
		buffer.Write(rest[:end+1])
		writer.midLine = false
		rest = rest[end+1:]
	}
	if _, err := writer.out.Write(buffer.Bytes()); err != nil {
		return 0, err
	}
	return len(chunk), nil
}
