package viewer

import (
	"encoding/json"
	"fmt"
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
	Cause  string   `json:"-"`
}

// ErrorsTab is the errors screen.
type ErrorsTab struct {
	src    Sources
	groups map[string]*ErrorGroup
	cursor int
	// openSignature is the group drilled into, empty on the list.
	openSignature string
	detail        detailPanel
	selectedKey   string
	last          map[string]string
	// firstSeen is when the newest distinct failure first appeared, which is
	// what makes the tab worth a look: another hundred of a failure already on
	// screen is not news, a failure nobody has seen before is.
	newestSignature time.Time
}

// NewErrorsTab builds the errors screen over the same log backing the log tab
// reads, so an error is grouped from exactly the line a person saw stream past.
func NewErrorsTab(src Sources) *ErrorsTab {
	return &ErrorsTab{src: src, groups: map[string]*ErrorGroup{}, last: map[string]string{}}
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
	cause, detail := errorDetails(rec, message)
	signature := Signature(line.Text, message+" "+cause)
	key := line.App + "\x00" + signature
	group, seen := t.groups[key]
	if !seen {
		group = &ErrorGroup{Signature: signature, FirstSeen: line.At}
		t.groups[key] = group
		t.newestSignature = newest(t.newestSignature, line.At)
	}
	group.Message, group.Lane, group.App = message, line.Lane, line.App
	group.Count++
	group.LastSeen = line.At
	group.Detail, group.Cause = detail, cause
}

// failed reports whether a line is a failure. A structured line says so; an
// unstructured one is read the way the log filter reads it.
func failed(line sources.LogLine, rec logfmt.Record, structured bool) bool {
	if structured {
		return rec.Level == logfmt.LevelError || rec.Level == logfmt.LevelFatal
	}
	return levelRank[logfmt.Level(line.Level)] >= levelRank[logfmt.LevelError]
}

// Attention marks the errors tab when a failure nobody has seen before arrived
// while the reader was elsewhere.
func (t *ErrorsTab) Attention(since time.Time) Attention {
	if t.newestSignature.After(since) {
		return AttentionFailure
	}
	return AttentionNone
}

// Groups is every distinct failure, most recently seen first.
func (t *ErrorsTab) Groups() []ErrorGroup {
	out := make([]ErrorGroup, 0, len(t.groups))
	for _, group := range t.groups {
		out = append(out, *group)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].LastSeen.Equal(out[j].LastSeen) {
			return errorKey(out[i]) < errorKey(out[j])
		}
		return out[i].LastSeen.After(out[j].LastSeen)
	})
	return out
}

func errorKey(group ErrorGroup) string { return group.App + "\x00" + group.Signature }

func (t *ErrorsTab) selectedGroups() []ErrorGroup {
	groups := t.Groups()
	if t.selectedKey != "" {
		for i := range groups {
			if errorKey(groups[i]) == t.selectedKey {
				t.cursor = i
				break
			}
		}
	}
	t.cursor = min(t.cursor, max(0, len(groups)-1))
	return groups
}

// Header separates the overview from the selected failure's detail.
func (t *ErrorsTab) Header() []string {
	groups := t.Groups()
	total := 0
	apps := map[string]bool{}
	for i := range groups {
		total += groups[i].Count
		apps[groups[i].App] = true
	}
	title := fmt.Sprintf("Errors  ·  %d distinct · %d occurrences · %d services", len(groups), total, len(apps))
	if group, ok := t.groups[t.openSignature]; ok {
		title = fmt.Sprintf("Errors / %s  ·  %d occurrences", group.App, group.Count)
	}
	return []string{" " + bold(title), " " + dim("Most recent occurrence first · select a failure to inspect its cause and stack"), ""}
}

// Body keeps the selected group visible or scrolls its captured details.
func (t *ErrorsTab) Body(f Frame) []Row {
	if t.openSignature != "" {
		return t.detail.body(f)
	}
	groups := t.selectedGroups()
	if len(groups) == 0 {
		return textRows([]string{dim("No errors captured in this session.")})
	}
	count := max(1, f.Rows()/3)
	start := max(0, t.cursor-count+1)
	var out []Row
	for i := start; i < min(len(groups), start+count); i++ {
		group := groups[i]
		prefix := "  "
		if i == t.cursor {
			prefix = "› "
		}
		title := prefix + bold(group.App) + "  " + group.Message
		if i == t.cursor {
			title = SelectedLine(title, max(0, f.Width-2))
		}
		cause := group.Cause
		if cause == "" {
			cause = "Enter to inspect message, context and stack"
		}
		out = append(out, Row{Text: title}, Row{Text: "  " + red(cause)}, Row{Text: "  " + dim(fmt.Sprintf("×%d · last %s · first %s", group.Count, ago(group.LastSeen, t.src.Now()), ago(group.FirstSeen, t.src.Now())))})
	}
	return out[:min(len(out), f.Rows())]
}

func (t *ErrorsTab) Footer() string {
	if t.openSignature != "" {
		return t.detail.footer()
	}
	return "↑↓ Select failure · enter Details"
}

func (t *ErrorsTab) Key(k string) bool {
	if t.openSignature != "" {
		if k == "esc" {
			t.openSignature = ""
			return true
		}
		return t.detail.key(k)
	}
	groups := t.selectedGroups()
	switch k {
	case "up", "k", "wheelup":
		t.cursor = max(0, t.cursor-1)
	case "down", "j", "wheeldown":
		t.cursor = min(t.cursor+1, max(0, len(groups)-1))
	case "enter":
		if t.cursor < len(groups) {
			group := groups[t.cursor]
			t.openSignature = errorKey(group)
			lines := []string{bold(group.Message), dim("Latest occurrence · " + group.LastSeen.Local().Format(time.RFC3339)), ""}
			t.detail = detailPanel{lines: append(lines, group.Detail...)}
		}
	default:
		return false
	}
	if t.cursor < len(groups) {
		t.selectedKey = errorKey(groups[t.cursor])
	}
	return true
}

// errorDetails retains structured context and unwraps nested error objects.
func errorDetails(rec logfmt.Record, message string) (string, []string) {
	lines := []string{bold("MESSAGE"), message}
	cause, stack := nestedError(rec.Fields)
	if rec.Stack != "" {
		stack = rec.Stack
	}
	if cause != "" {
		lines = append(lines, "", bold("CAUSE"), cause)
	}
	if len(rec.Fields) > 0 {
		lines = append(lines, "", bold("CONTEXT"))
		for _, field := range rec.Fields {
			lines = append(lines, dim(field.Key), prettyField(field.Value))
		}
	}
	if stack != "" {
		lines = append(lines, "", bold("STACK"), stack)
	}
	return cause, lines
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

func nestedError(fields []logfmt.Field) (string, string) {
	for _, field := range fields {
		switch field.Key {
		case "error", "err", "cause":
		default:
			continue
		}
		var value struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Name    string `json:"name"`
			Stack   string `json:"stack"`
		}
		if json.Unmarshal([]byte(field.Value), &value) != nil || value.Message == "" {
			continue
		}
		kind := value.Type
		if kind == "" {
			kind = value.Name
		}
		message := value.Message
		if kind != "" {
			message = kind + ": " + message
		}
		return message, value.Stack
	}
	return "", ""
}

func prettyField(value string) string {
	var decoded any
	if json.Unmarshal([]byte(value), &decoded) != nil {
		return value
	}
	pretty, err := json.MarshalIndent(decoded, "", "  ")
	if err != nil {
		return value
	}
	return string(pretty)
}
