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

const progressInterval = 5 * time.Second

// startTicker prints one status line every interval until the returned stop
// is called: what is done of the total, a detail, the rate and the time left.
func startTicker(out io.Writer, label string, total int, snapshot func() (done int, detail string)) (stop func()) {
	if out == nil {
		return func() {}
	}
	quit, finished := make(chan struct{}), make(chan struct{})
	started := time.Now()
	go func() {
		defer close(finished)
		tick := time.NewTicker(progressInterval)
		defer tick.Stop()
		for {
			select {
			case <-quit:
				return
			case <-tick.C:
				done, detail := snapshot()
				fmt.Fprintln(out, progressLine(label, total, done, detail, time.Since(started)))
			}
		}
	}()
	return func() { close(quit); <-finished }
}

func progressLine(label string, total, done int, detail string, elapsed time.Duration) string {
	rate := float64(done) / max(elapsed.Seconds(), 0.001)
	line := fmt.Sprintf("%s %d/%d", label, done, total)
	if detail != "" {
		line += " · " + detail
	}
	line += fmt.Sprintf(" · %.1f/s", rate)
	if rate > 0 && done < total {
		line += " · ~" + (time.Duration(float64(total-done)/rate) * time.Second).Round(time.Second).String() + " left"
	}
	return line
}
