// Package havenui is haven's terminal design language: one palette, one set
// of glyphs, one way to pad a column and clamp a line.
//
// It exists because there wasn't one. The hub, the cleanup picker and the
// install picker each declared their own `accent`, `styleWarn`, `styleGood`
// — the same four colours, written out three times — so the screens agreed
// only by coincidence, and the next screen would have agreed by coincidence
// too, until the day it didn't. The colours below are the ones those three
// had already converged on; the only change is that there is now somewhere
// for them to live.
//
// Everything here is presentation. No package under domain/ or app/ may
// import it: a status that knows how it will be coloured is a status that
// cannot be printed any other way.
package havenui

import (
	"strings"

	"github.com/charmbracelet/lipgloss"
)

// The palette. Adaptive where the colour has to work on both a light and a
// dark terminal; fixed 256-colour where it is a status signal and the meaning
// matters more than the match.
var (
	// Accent is haven's own colour — titles, the cursor, the thing you are
	// about to act on. Nothing decorative uses it, so it always means "here".
	Accent = lipgloss.AdaptiveColor{Light: "#ed8926", Dark: "#f59e3f"}
	// Live is healthy, running, installed, done.
	Live = lipgloss.Color("42")
	// Stale is running but behind, or old enough to mention.
	Stale = lipgloss.Color("214")
	// Alarm is broken, missing, or about to be destroyed.
	Alarm = lipgloss.Color("203")
	// Gone is deliberately absent: reclaimed, skipped, silenced. Distinct
	// from Alarm because "you turned this off" is not a problem.
	Gone = lipgloss.Color("213")
	// Other is the catch-all series in bars and charts.
	Other = lipgloss.AdaptiveColor{Light: "#7c3aed", Dark: "#a78bfa"}
)

// The styles every haven screen draws from.
var (
	Title    = lipgloss.NewStyle().Bold(true).Foreground(Accent)
	Muted    = lipgloss.NewStyle().Faint(true)
	Selected = lipgloss.NewStyle().Foreground(Accent).Bold(true)
	Good     = lipgloss.NewStyle().Foreground(Live)
	Warn     = lipgloss.NewStyle().Foreground(Alarm).Bold(true)
	Aging    = lipgloss.NewStyle().Foreground(Stale)
	Absent   = lipgloss.NewStyle().Foreground(Gone)
)

// The glyphs. One mark per meaning, so a reader learns them once.
const (
	// Cursor marks the row the keys act on.
	Cursor = "▸"
	// Yes and No are outcomes, not decorations: a ✓ always means the machine
	// is fine here and a ✗ always means it is not.
	Yes = "✓"
	No  = "✗"
	// Bullet separates clauses inside one line.
	Bullet = "·"
	// Skip marks something deliberately left alone.
	Skip = "–"
)

// Keys renders a footer key hint: "space tick · enter install · q quit".
// One separator, one style, so the bottom line of every screen matches.
func Keys(hints ...string) string {
	return Muted.Render("  " + strings.Join(hints, " "+Bullet+" "))
}

// Pad right-pads plain text to a column width, measured the way a terminal
// measures it rather than in bytes.
//
// It has to be applied BEFORE any style. lipgloss wraps its output in escape
// codes, and fmt's own `%-22s` counts those as characters — so padding a
// styled string silently produces a column that collapses on exactly the rows
// that are highlighted, which is where the eye already is.
func Pad(s string, width int) string {
	if gap := width - lipgloss.Width(s); gap > 0 {
		return s + strings.Repeat(" ", gap)
	}
	return s + " "
}

// Clamp cuts every line to the terminal width, so a long row soft-wraps
// nowhere and cannot shift the layout under everything below it. A width of
// zero (nothing has told us yet) leaves the text alone.
func Clamp(s string, width int) string {
	if width <= 0 {
		return s
	}
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		if lipgloss.Width(line) > width {
			lines[i] = lipgloss.NewStyle().MaxWidth(width).Render(line)
		}
	}
	return strings.Join(lines, "\n")
}
