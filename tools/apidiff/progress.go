package apidiff

import (
	"bytes"
	"fmt"
	"io"
	"sync"
	"time"
)

// stampWriter starts every complete line with the wall clock, so the run log
// reads as a timeline, the relayed child lines included.
type stampWriter struct {
	mu      sync.Mutex
	out     io.Writer
	pending []byte
}

func (writer *stampWriter) Write(chunk []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	writer.pending = append(writer.pending, chunk...)
	for {
		end := bytes.IndexByte(writer.pending, '\n')
		if end < 0 {
			return len(chunk), nil
		}
		line := append([]byte(time.Now().Format("[15:04:05] ")), writer.pending[:end+1]...)
		writer.pending = writer.pending[end+1:]
		if _, err := writer.out.Write(line); err != nil {
			return len(chunk), err
		}
	}
}

// flush writes a final line that never got its newline.
func (writer *stampWriter) flush() {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	if len(writer.pending) > 0 {
		_, _ = writer.out.Write(append(append([]byte(time.Now().Format("[15:04:05] ")), writer.pending...), '\n'))
		writer.pending = nil
	}
}

// phaseDone logs one phase's duration; the whole run's time is read from
// these lines.
func phaseDone(out io.Writer, name string, started time.Time) {
	if out != nil {
		fmt.Fprintf(out, "phase %s: %s\n", name, time.Since(started).Round(100*time.Millisecond))
	}
}
