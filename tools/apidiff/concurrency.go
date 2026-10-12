package apidiff

import (
	"bytes"
	"fmt"
	"io"
	"sync"
	"time"
)

// lockedWriter takes one write at a time onto one stream, so the two side
// pipelines and the background inventories can log through it at once.
type lockedWriter struct {
	mu  sync.Mutex
	out io.Writer
}

func (writer *lockedWriter) Write(chunk []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	return writer.out.Write(chunk)
}

// linePrefixer tags every complete line one subprocess writes with its side,
// so two installs streaming at once stay readable.
type linePrefixer struct {
	mu      sync.Mutex
	out     io.Writer
	prefix  string
	pending []byte
}

func (writer *linePrefixer) Write(chunk []byte) (int, error) {
	writer.mu.Lock()
	defer writer.mu.Unlock()
	writer.pending = append(writer.pending, chunk...)
	for {
		end := bytes.IndexByte(writer.pending, '\n')
		if end < 0 {
			return len(chunk), nil
		}
		line := append([]byte(writer.prefix), writer.pending[:end+1]...)
		writer.pending = writer.pending[end+1:]
		if _, err := writer.out.Write(line); err != nil {
			return len(chunk), err
		}
	}
}

// sideLog is where one side's subprocess output goes: the run log, each line
// prefixed with the side's name.
func (state *bootState) sideLog(side string) io.Writer {
	return &linePrefixer{out: state.stderr, prefix: side + " | "}
}

// timing logs one phase boundary with the time since the run started, the
// line the phase timings in the handoffs and the README are read from.
func (state *bootState) timing(format string, args ...any) {
	elapsed := time.Duration(0)
	if !state.started.IsZero() {
		elapsed = time.Since(state.started).Round(time.Second)
	}
	state.logf("timing +%s: %s", elapsed, fmt.Sprintf(format, args...))
}

// inPool runs work for every index below count on at most size goroutines
// and returns once all of them have finished.
func inPool(count, size int, work func(index int)) {
	jobs := make(chan int)
	var group sync.WaitGroup
	for range min(size, count) {
		group.Go(func() {
			for index := range jobs {
				work(index)
			}
		})
	}
	for index := range count {
		jobs <- index
	}
	close(jobs)
	group.Wait()
}
