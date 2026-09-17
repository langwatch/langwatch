package viewer

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/charmbracelet/x/ansi"
)

// The scroll-and-search behavior every line-oriented tab shares, kept in one
// place so the logs tab, an error's stack and a job's output all scroll the
// same way. Scrolling back leaves following; new output does not yank a
// scrolled-back view; a committed search persists across sub-tabs and steps
// through the whole buffer of whichever one is showing.

// ringCap bounds how many lines one buffer holds in memory.
const ringCap = 2000

// mouseWheelLines is how many lines one wheel notch moves a buffer.
const mouseWheelLines = 3

// pager is one scrollable buffer set: many named rings, one scroll offset per
// ring, and a search shared across all of them.
type pager struct {
	lines map[string][]Row
	// nextID stamps each pushed line, so the reader's expansion follows the
	// line through scrolling, filtering and new output arriving above it.
	nextID int64
	// scroll is how far each ring is pulled back from the live bottom; 0 is
	// following, where new output stays on screen as it arrives.
	scroll map[string]int
	// query is the committed, case-insensitive search. prompt and input hold a
	// "/" entry before Enter commits it.
	query    string
	prompt   bool
	input    string
	matchIdx int
	filter   func(Row) bool
}

func newPager() *pager {
	return &pager{lines: map[string][]Row{}, scroll: map[string]int{}, matchIdx: -1}
}

// push appends one line to a ring. A ring scrolled back advances its offset in
// lockstep, so the window keeps showing the same content instead of drifting
// under the reader as output streams in.
func (p *pager) push(ring string, row Row) {
	lines := p.lines[ring]
	lines = append(lines, row)
	if len(lines) > ringCap {
		lines = lines[len(lines)-ringCap:]
	}
	p.lines[ring] = lines
	if p.scroll[ring] > 0 && (p.filter == nil || p.filter(row)) {
		p.scroll[ring] = minInt(p.scroll[ring]+1, len(lines))
	}
}

// nextRowID stamps one line as it is pushed.
func (p *pager) nextRowID() int64 {
	p.nextID++
	return p.nextID
}

// visible slices a ring to the window its scroll offset selects.
func (p *pager) visible(ring string, rows int) []Row {
	lines := p.filteredLines(ring)
	p.scroll[ring] = minInt(p.scroll[ring], maxInt(len(lines)-rows, 0))
	end := len(lines) - p.scroll[ring]
	start := maxInt(end-rows, 0)
	return lines[start:end]
}

func (p *pager) filteredLines(ring string) []Row {
	if p.filter == nil {
		return p.lines[ring]
	}
	var out []Row
	for _, row := range p.lines[ring] {
		if p.filter(row) {
			out = append(out, row)
		}
	}
	return out
}

// scrollBy moves a ring's offset, clamped. Positive scrolls toward older lines.
func (p *pager) scrollBy(ring string, delta int) {
	p.scroll[ring] = clamp(p.scroll[ring]+delta, maxInt(len(p.filteredLines(ring))-1, 0))
}

// key offers one keypress to the pager. rows is the current body height, for
// paging. Returns true when the pager consumed it.
func (p *pager) key(ring, k string, rows int) bool {
	if p.prompt {
		return p.searchKey(ring, k)
	}
	switch k {
	case "/":
		p.prompt, p.input = true, ""
	case "n":
		p.step(ring, 1)
	case "N":
		p.step(ring, -1)
	case "f", "end", "G":
		p.scroll[ring] = 0
	case "pgup", "b":
		p.scrollBy(ring, rows)
	case "pgdown", " ":
		p.scrollBy(ring, -rows)
	case "u", "ctrl+u":
		p.scrollBy(ring, maxInt(rows/2, 1))
	case "d", "ctrl+d":
		p.scrollBy(ring, -maxInt(rows/2, 1))
	case "up", "k", "wheelup":
		p.scrollBy(ring, wheelOrLine(k))
	case "down", "j", "wheeldown":
		p.scrollBy(ring, -wheelOrLine(k))
	case "home", "g":
		p.scroll[ring] = maxInt(len(p.filteredLines(ring))-maxInt(rows, 1), 0)
	default:
		return false
	}
	return true
}

// wheelOrLine is how far one movement key travels: a wheel notch is several
// lines, an arrow is one.
func wheelOrLine(k string) int {
	if strings.HasPrefix(k, "wheel") {
		return mouseWheelLines
	}
	return 1
}

// searchKey captures keystrokes while the "/" prompt is open.
func (p *pager) searchKey(ring, k string) bool {
	switch k {
	case "enter":
		p.prompt, p.query, p.input = false, p.input, ""
		p.jumpNearest(ring)
	case "esc":
		p.prompt, p.input = false, ""
	case "backspace":
		p.input = trimLastRune(p.input)
	default:
		if runes := []rune(k); len(runes) == 1 {
			p.input += k
		}
	}
	return true
}

// clearSearch drops the active query and its highlighting.
func (p *pager) clearSearch() {
	p.query, p.matchIdx = "", -1
}

// matches finds every line in a ring containing the committed query.
func (p *pager) matches(ring string) []int {
	if p.query == "" {
		return nil
	}
	needle := strings.ToLower(p.query)
	var idx []int
	for i, row := range p.filteredLines(ring) {
		if strings.Contains(strings.ToLower(ansi.Strip(row.Text)), needle) {
			idx = append(idx, i)
		}
	}
	return idx
}

// jumpNearest lands on the first match at or after the line at the bottom of
// the view, wrapping to the last match when the view is already past them all.
func (p *pager) jumpNearest(ring string) {
	found := p.matches(ring)
	if len(found) == 0 {
		p.matchIdx = -1
		return
	}
	end := len(p.filteredLines(ring)) - p.scroll[ring]
	best := len(found) - 1
	for i, idx := range found {
		if idx >= end-1 {
			best = i
			break
		}
	}
	p.matchIdx = best
	p.reveal(ring, found[best])
}

// step moves across the ring's whole match list, wrapping at either end.
func (p *pager) step(ring string, dir int) {
	found := p.matches(ring)
	if len(found) == 0 {
		return
	}
	if p.matchIdx < 0 {
		p.jumpNearest(ring)
		return
	}
	p.matchIdx = ((p.matchIdx+dir)%len(found) + len(found)) % len(found)
	p.reveal(ring, found[p.matchIdx])
}

// reveal scrolls a ring so one absolute line index sits at the bottom.
func (p *pager) reveal(ring string, lineIdx int) {
	count := len(p.filteredLines(ring))
	p.scroll[ring] = clamp(count-lineIdx-1, count)
}

// footer is the scroll and search half of a tab's hint line.
func (p *pager) footer(ring string) string {
	if p.prompt {
		return dim("/") + p.input + sgrReverse + " " + sgrReset + dim("  enter searches · esc cancels")
	}
	// The keys are named the way a keyboard with no page block can reach them.
	// A Mac laptop has no page up, no page down, no home and no end, so a
	// footer that names only those is a footer telling most readers they cannot
	// move. The old keys still work; they are simply not what is advertised.
	help := "↑↓/jk scroll · space/b page · d/u half · g/G top/bottom · / search"
	if p.query != "" {
		help += fmt.Sprintf(" · %q: %d match(es) · n/N step · esc clears", p.query, len(p.matches(ring)))
	}
	if back := p.scroll[ring]; back > 0 {
		help += fmt.Sprintf(" · ↑ %d lines above · f to follow", back)
	}
	return dim(help)
}

// highlight wraps every case-insensitive occurrence of the query in reverse
// video, leaving any color the line already carries intact.
func highlight(line, query string) string {
	if query == "" {
		return line
	}
	pattern := regexp.MustCompile("(?i)" + regexp.QuoteMeta(query))
	var b strings.Builder
	var plain strings.Builder
	flush := func() {
		b.WriteString(pattern.ReplaceAllStringFunc(plain.String(), func(match string) string {
			return sgrReverse + match + "\x1b[27m"
		}))
		plain.Reset()
	}
	var state byte
	for len(line) > 0 {
		seq, width, n, next := ansi.DecodeSequence(line, state, nil)
		if n == 0 {
			break
		}
		line, state = line[n:], next
		if width > 0 {
			plain.WriteString(seq)
			continue
		}
		flush()
		b.WriteString(seq)
	}
	flush()
	return b.String()
}

func trimLastRune(s string) string {
	if s == "" {
		return s
	}
	runes := []rune(s)
	return string(runes[:len(runes)-1])
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
