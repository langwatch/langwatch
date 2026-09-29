package diffkit

import (
	"fmt"
	"io"
	"time"
)

// ProgressInterval is how often StartTicker prints a status line.
const ProgressInterval = 5 * time.Second

// StartTicker prints one status line every ProgressInterval until the returned
// stop is called: what is done of the total, a detail, the rate and the time
// left. Copied from apidiff/progress.go; switch apidiff over later.
func StartTicker(out io.Writer, label string, total int, snapshot func() (done int, detail string)) (stop func()) {
	if out == nil {
		return func() {}
	}
	quit, finished := make(chan struct{}), make(chan struct{})
	started := time.Now()
	go func() {
		defer close(finished)
		tick := time.NewTicker(ProgressInterval)
		defer tick.Stop()
		for {
			select {
			case <-quit:
				return
			case <-tick.C:
				done, detail := snapshot()
				fmt.Fprintln(out, ProgressLine(label, total, done, detail, time.Since(started)))
			}
		}
	}()
	return func() { close(quit); <-finished }
}

// ProgressLine is one ticker line: label, done/total, a detail, the rate, and
// the time left at that rate.
func ProgressLine(label string, total, done int, detail string, elapsed time.Duration) string {
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
