package viewer

import (
	"sort"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// ErrorsTab is the last distinct failures across every lane, grouped so a
// crash-loop is one row with a count rather than the whole screen.

// ErrorGroup is one distinct failure: how often it fired, when it was first and
// last seen, and which lane it came from.
type ErrorGroup struct {
	Signature string    `json:"signature"`
	Message   string    `json:"message"`
	Lane      string    `json:"lane"`
	App       string    `json:"app"`
	Count     int       `json:"count"`
	FirstSeen time.Time `json:"firstSeen"`
	LastSeen  time.Time `json:"lastSeen"`
	// Detail is the full message and stack of the last occurrence.
	Detail []string `json:"-"`
}

// ErrorsTab is the errors screen.
type ErrorsTab struct {
	src    Sources
	groups map[string]*ErrorGroup
	cursor int
	// openSignature is the group drilled into, empty on the list.
	openSignature string
	pages         *pager
	last          map[string]string
}

// NewErrorsTab builds the errors screen over the same log backing the log tab
// reads, so an error is grouped from exactly the line a person saw stream past.
func NewErrorsTab(src Sources) *ErrorsTab {
	return &ErrorsTab{src: src, groups: map[string]*ErrorGroup{}, pages: newPager(), last: map[string]string{}}
}

// Name is the tab's label and command name.
func (t *ErrorsTab) Name() string { return "errors" }

// Poll asks nothing of its own. Errors are folded from the same capture stream
// the log tab reads, which the model tails on every beat whichever tab is
// visible - an error that happened while you were looking at traces is exactly
// the one you came to this tab for.
func (t *ErrorsTab) Poll() {}

// Observe folds one already-read line into its group. The errors tab and the
// log tab read the same stream, and a line handed to one is gone from the
// other, so whichever tab polls feeds both.
func (t *ErrorsTab) Observe(line sources.LogLine) { t.fold(line) }

// fold adds one line to its group, if it is a failure at all.
func (t *ErrorsTab) fold(line sources.LogLine) {
	rec, structured := logfmt.Parse(line.Text)
	if !failed(line, rec, structured) {
		return
	}
	line.App = RouteLine(line.Lane, line.Text, t.last[line.Lane])
	t.last[line.Lane] = line.App
	message := rec.Message
	if message == "" {
		message = strings.TrimSpace(line.Text)
	}
	key := Signature(line.Text, message)
	group, seen := t.groups[key]
	if !seen {
		group = &ErrorGroup{Signature: key, FirstSeen: line.At}
		t.groups[key] = group
	}
	group.Message, group.Lane, group.App = message, line.Lane, line.App
	group.Count++
	group.LastSeen = line.At
	group.Detail = detailOf(message, rec.Stack)
}

// failed reports whether a line is a failure. A structured line says so; an
// unstructured one is read the way the log filter reads it.
func failed(line sources.LogLine, rec logfmt.Record, structured bool) bool {
	if structured {
		return rec.Level == logfmt.LevelError || rec.Level == logfmt.LevelFatal
	}
	return levelRank[logfmt.Level(line.Level)] >= levelRank[logfmt.LevelError]
}

// detailOf is the drill-in body: the whole message, then the stack.
func detailOf(message, stack string) []string {
	out := []string{message}
	if stack == "" {
		return out
	}
	return append(out, strings.Split(strings.TrimRight(stack, "\n"), "\n")...)
}

// Groups is every distinct failure, most recently seen first.
func (t *ErrorsTab) Groups() []ErrorGroup {
	out := make([]ErrorGroup, 0, len(t.groups))
	for _, group := range t.groups {
		out = append(out, *group)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].LastSeen.After(out[j].LastSeen) })
	return out
}

// Body renders the group list, or the drilled-into group's own detail.
func (t *ErrorsTab) Body(f Frame) []string {
	if t.openSignature != "" {
		return t.detailBody(f)
	}
	groups := t.Groups()
	if len(groups) == 0 {
		return emptyBody("errors")
	}
	now := t.src.Now()
	out := make([]string, 0, len(groups))
	for i := range groups {
		out = append(out, t.row(i, &groups[i], now))
	}
	return lastN(out, f.Rows())
}

// row renders one group: count, when it was first and last seen, the lane, and
// the message it groups.
func (t *ErrorsTab) row(i int, group *ErrorGroup, now time.Time) string {
	line := " " + pad("×"+itoa(group.Count), 5) + " " +
		dim(pad(ago(group.LastSeen, now), 10)) + " " +
		dim(pad("first "+ago(group.FirstSeen, now), 16)) + " " +
		pad(group.App, 9) + " " + red(group.Message)
	if i == t.cursor {
		return sgrReverse + "›" + line + sgrReset
	}
	return " " + line
}

// detailBody is the drilled-into group's last occurrence, in full.
func (t *ErrorsTab) detailBody(f Frame) []string {
	group, ok := t.groups[t.openSignature]
	if !ok {
		return emptyBody("detail")
	}
	out := make([]string, 0, len(group.Detail)+1)
	out = append(out, " "+bold(group.App)+dim("  ×"+itoa(group.Count)))
	for _, line := range group.Detail {
		out = append(out, " "+line)
	}
	return lastN(out, f.Rows())
}

// Footer names what the keys do on whichever half of the tab is showing.
func (t *ErrorsTab) Footer() string {
	if t.openSignature != "" {
		return dim("esc back to the list")
	}
	return dim("↑↓ move · enter shows the last occurrence in full")
}

// Key moves the cursor and opens or closes the drill-in.
func (t *ErrorsTab) Key(k string) bool {
	switch k {
	case "up", "k":
		t.cursor = maxInt(t.cursor-1, 0)
	case "down", "j":
		t.cursor = minInt(t.cursor+1, maxInt(len(t.groups)-1, 0))
	case "enter":
		groups := t.Groups()
		if t.cursor < len(groups) {
			t.openSignature = groups[t.cursor].Signature
		}
	case "esc":
		if t.openSignature == "" {
			return false
		}
		t.openSignature = ""
	default:
		return false
	}
	return true
}

// Rows is the group list as plain data, most recently seen first.
func (t *ErrorsTab) Rows() any { return t.Groups() }

// Open is the group currently drilled into, empty on the list.
func (t *ErrorsTab) Open() string { return t.openSignature }

// Detail is the drilled-into group's last occurrence, for the tests.
func (t *ErrorsTab) Detail() []string {
	if group, ok := t.groups[t.openSignature]; ok {
		return group.Detail
	}
	return nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var digits []byte
	for n > 0 {
		digits = append([]byte{byte('0' + n%10)}, digits...)
		n /= 10
	}
	return string(digits)
}
