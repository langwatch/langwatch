package engine

import "time"

// elapsedMS is the whole milliseconds since started, rounded up. Duration.Milliseconds
// truncates, so a node that answered in 0.4 ms (a warm local model) read 0 ms, the same
// as a node nobody timed. Rounding up keeps any measured work at 1 ms or more, as its span
// reads.
func elapsedMS(started time.Time) int64 {
	elapsed := time.Since(started)
	ms := elapsed.Milliseconds()
	if elapsed > time.Duration(ms)*time.Millisecond {
		ms++
	}
	return ms
}
