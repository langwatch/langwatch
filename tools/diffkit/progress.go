package diffkit

import (
	"fmt"
	"io"
	"time"
)

// ProgressInterval is how often a Ticker prints a status line.
const ProgressInterval = 5 * time.Second

// Ticker describes a periodic status line: what is done of Total, a detail,
// the rate and the time left. Snapshot is asked for the done count and detail.
type Ticker struct {
	Out      io.Writer
	Label    string
	Total    int
	Snapshot func() (done int, detail string)
}

// Start prints one status line every ProgressInterval until the returned stop
// is called. A nil Out prints nothing.
func (ticker Ticker) Start() (stop func()) {
	if ticker.Out == nil {
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
				done, detail := ticker.Snapshot()
				fmt.Fprintln(ticker.Out, ticker.line(progress{done: done, detail: detail, elapsed: time.Since(started)}))
			}
		}
	}()
	return func() { close(quit); <-finished }
}

// progress is one reading of a ticker's snapshot.
type progress struct {
	done    int
	detail  string
	elapsed time.Duration
}

// line is one ticker line: label, done/total, a detail, the rate, and the
// time left at that rate.
func (ticker Ticker) line(at progress) string {
	rate := float64(at.done) / max(at.elapsed.Seconds(), 0.001)
	line := fmt.Sprintf("%s %d/%d", ticker.Label, at.done, ticker.Total)
	if at.detail != "" {
		line += " · " + at.detail
	}
	line += fmt.Sprintf(" · %.1f/s", rate)
	if rate > 0 && at.done < ticker.Total {
		line += " · ~" + (time.Duration(float64(ticker.Total-at.done)/rate) * time.Second).Round(time.Second).String() + " left"
	}
	return line
}
