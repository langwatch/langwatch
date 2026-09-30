package visualdiff

import (
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"

	"github.com/langwatch/langwatch/tools/diffkit"
)

// DefaultMaxConsecutiveErrors is how many captures in a row on one side may
// be harness or stack errors before the runner is stopped; 0 never stops it.
const DefaultMaxConsecutiveErrors = 10

type captureVerdict int

const (
	captureWorked captureVerdict = iota
	captureFailed
	captureBroken
)

// harnessMarks are the texts of a failed flow step that say nothing about the
// screen under test: the browser or page went, the network refused, sign-in
// or the shell did not come up, or the page itself never loaded.
var harnessMarks = []string{
	"has been closed", "target closed", "net::err_", "econnrefused", "econnreset",
	"sign-in", "sign in", "shell does not render", "never came up", "page.goto: timeout",
}

// judgeCapture files one capture: a route that errored is broken (a route has
// no expectation to fail), a flow step is broken only when its text names the
// harness, and any other failed step is an expectation failing, a FAIL.
func judgeCapture(capture Capture) (captureVerdict, string) {
	if len(capture.ModuleFailures) > 0 {
		return captureBroken, "page modules failed to load: " + capture.ModuleFailures[0]
	}
	if capture.Error == "" {
		return captureWorked, ""
	}
	cause, _, _ := strings.Cut(capture.Error, "\n")
	lower := strings.ToLower(cause)
	if capture.Kind == "route" || slices.ContainsFunc(harnessMarks, func(mark string) bool { return strings.Contains(lower, mark) }) {
		return captureBroken, cause
	}
	return captureFailed, cause
}

// captureStreaks holds one streak per side, so a broken candidate is not
// hidden by the base's captures arriving between its errors.
type captureStreaks struct {
	mu     sync.Mutex
	limit  int
	bySide map[string]*diffkit.Streak
}

func newCaptureStreaks(limit int) *captureStreaks {
	return &captureStreaks{limit: limit, bySide: map[string]*diffkit.Streak{}}
}

// file counts one capture and answers the reason to stop when it trips a side.
func (streaks *captureStreaks) file(capture Capture) *diffkit.Stopped {
	verdict, cause := judgeCapture(capture)
	streaks.mu.Lock()
	streak := streaks.bySide[capture.Side]
	if streak == nil {
		streak = diffkit.NewStreak(streaks.limit)
		streaks.bySide[capture.Side] = streak
	}
	streaks.mu.Unlock()
	switch verdict {
	case captureBroken:
		if streak.Error(cause) {
			return streak.Stopped()
		}
	case captureWorked:
		streak.OK()
	}
	return nil
}

// killTree ends the runner and everything it started (its node and browsers).
func killTree(pid int) {
	for _, text := range treePids(pid) {
		if id, err := strconv.Atoi(text); err == nil {
			_ = syscall.Kill(id, syscall.SIGTERM)
		}
	}
}
