package visualdiff

import (
	"bytes"
	"io"
	"sync"
	"time"
)

// stampedWriter opens every line it writes with the time it was written, so
// run.log says when each phase started and ended.
type stampedWriter struct {
	mu      sync.Mutex
	out     io.Writer
	now     func() time.Time
	midLine bool
}

// newStampedWriter stamps every line written to out with now's clock time.
func newStampedWriter(out io.Writer, now func() time.Time) *stampedWriter {
	return &stampedWriter{out: out, now: now}
}

func (writer *stampedWriter) Write(chunk []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	var buffer bytes.Buffer
	for rest := chunk; len(rest) > 0; {
		if !writer.midLine {
			buffer.WriteString(writer.now().Format("15:04:05.000") + " ")
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
