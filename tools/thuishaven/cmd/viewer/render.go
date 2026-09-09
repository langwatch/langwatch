// Package viewer is the up viewer's tabs: one screen per question, each over
// exactly one datasource. The bubbletea model that hosts them lives in cmd and
// owns only the frame, the key routing and the tab bar; everything a tab knows
// how to do is here, which is what makes each tab testable without a terminal.
package viewer

import (
	"fmt"
	"strings"
	"time"
)

// Frame is the space a tab has to render into.
type Frame struct {
	Width  int
	Height int
}

// Rows is how many body lines fit, never less than one.
func (f Frame) Rows() int {
	if f.Height < 1 {
		return 1
	}
	return f.Height
}

// The paint helpers. Every tab writes SGR sequences directly rather than
// through a styling library: the viewer already renders log lines the child
// painted itself, so a library that owns the whole line would have to unpick
// them again.
const (
	sgrDim     = "\x1b[2m"
	sgrBold    = "\x1b[1m"
	sgrRed     = "\x1b[31m"
	sgrGreen   = "\x1b[32m"
	sgrYellow  = "\x1b[33m"
	sgrReverse = "\x1b[7m"
	sgrReset   = "\x1b[0m"
)

func dim(text string) string    { return sgrDim + text + sgrReset }
func bold(text string) string   { return sgrBold + text + sgrReset }
func red(text string) string    { return sgrRed + text + sgrReset }
func green(text string) string  { return sgrGreen + text + sgrReset }
func yellow(text string) string { return sgrYellow + text + sgrReset }

// pad left-aligns text in a fixed column, never truncating: a name longer than
// the column pushes its own row out rather than being silently renamed.
func pad(text string, width int) string {
	if len(text) >= width {
		return text
	}
	return text + strings.Repeat(" ", width-len(text))
}

// sparkBlocks are the eight heights a text sparkline is drawn from.
var sparkBlocks = []rune{'▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'}

// Sparkline draws a series as block characters, scaled to its own maximum. A
// flat series draws as its floor rather than as nothing, so "steady" and "no
// data" stay distinguishable - which is the one thing a sparkline is for.
func Sparkline(samples []float64) string {
	if len(samples) == 0 {
		return dim("no data")
	}
	peak := 0.0
	for _, s := range samples {
		if s > peak {
			peak = s
		}
	}
	var b strings.Builder
	for _, s := range samples {
		index := 0
		if peak > 0 {
			index = int(s / peak * float64(len(sparkBlocks)-1))
		}
		b.WriteRune(sparkBlocks[clamp(index, len(sparkBlocks)-1)])
	}
	return b.String()
}

// clamp bounds a value to [0, high]. Every caller here is an index or a count,
// so the floor is always zero and passing it would be noise at the call site.
func clamp(value, high int) int {
	if value < 0 {
		return 0
	}
	if value > high {
		return high
	}
	return value
}

// Bar draws a fraction of a limit as a fixed-width meter.
func Bar(fraction float64, width int) string {
	filled := clamp(int(fraction*float64(width)+0.5), width)
	return strings.Repeat("█", filled) + dim(strings.Repeat("·", width-filled))
}

// clock is how a row spells an instant: local wall time to the second, which is
// what a person reading a live screen matches against their own terminal.
const clock = "15:04:05"

// shortDuration spells a duration at the precision a reader can act on.
func shortDuration(d time.Duration) string {
	switch {
	case d >= time.Minute:
		return fmt.Sprintf("%dm%02ds", int(d.Minutes()), int(d.Seconds())%60)
	case d >= time.Second:
		return fmt.Sprintf("%.1fs", d.Seconds())
	}
	return fmt.Sprintf("%dms", d.Milliseconds())
}

// ago spells how long before now an instant was.
func ago(at, now time.Time) string {
	if at.IsZero() {
		return " - "
	}
	return shortDuration(now.Sub(at)) + " ago"
}

// emptyBody is the one line a tab shows when its source answered with nothing.
func emptyBody(what string) []string { return []string{" " + dim("no "+what+" yet")} }
