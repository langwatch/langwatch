package viewer

import (
	"sort"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
	"github.com/langwatch/langwatch/tools/thuishaven/domain/logfmt"
)

// LogsTab is the log stream, split by the application that wrote each line
// rather than by the lane that hosted it, with a severity floor and a choice of
// backing. Both backings matter: the capture files are the only ones that work
// with the observability stack down, and Loki is the only one that has the info
// and debug lines, because a stack that is up mutes the console to warn.

// levelFloors maps the three level keys onto the severity they admit.
var levelFloors = map[string]logfmt.Level{"a": logfmt.LevelNone, "w": logfmt.LevelWarn, "e": logfmt.LevelError}

// levelRank orders the severities the floor compares against.
var levelRank = map[logfmt.Level]int{
	logfmt.LevelNone: 0, logfmt.LevelTrace: 1, logfmt.LevelDebug: 2,
	logfmt.LevelInfo: 3, logfmt.LevelWarn: 4, logfmt.LevelError: 5, logfmt.LevelFatal: 6,
}

// LogsTab is the logs screen.
type LogsTab struct {
	src   Sources
	pages *pager
	// apps is which applications have written a line, so a sub-tab appears
	// only once there is something behind it.
	apps map[string]bool
	// last is the application the previous structured line on each lane
	// resolved to, which is what that lane's unstructured lines follow.
	last     map[string]string
	selected string
	floor    logfmt.Level
	// fromLoki is whether this sub-tab reads Loki instead of the capture files.
	fromLoki bool
	rows     []sources.LogLine
	// bodyRows is the height the last render had, so a page key moves by what
	// the reader can actually see rather than by a guess.
	bodyRows int
	// lastWarn and lastError are when this tab last saw a line at each level,
	// which is all the tab bar's mark needs from it.
	lastWarn  time.Time
	lastError time.Time
}

// NewLogsTab builds the logs screen over the file and Loki backings.
func NewLogsTab(src Sources) *LogsTab {
	return &LogsTab{
		src: src, pages: newPager(), apps: map[string]bool{},
		last: map[string]string{}, selected: AllApps, floor: logfmt.LevelNone,
	}
}

// Name is the tab's label and command name.
func (t *LogsTab) Name() string { return "logs" }

// Poll pulls from Loki, and only from Loki. The capture files are tailed by
// the model on every beat and fanned out, because the errors tab reads the same
// stream: two tabs each calling Fresh would each get half the lines.
func (t *LogsTab) Poll() {
	if !t.fromLoki || t.src.Loki == nil {
		return
	}
	for _, line := range t.src.Loki.Fresh() {
		t.ingest(line)
	}
}

// Observe files one captured line, unless this sub-tab is reading Loki instead.
func (t *LogsTab) Observe(line sources.LogLine) {
	if t.fromLoki {
		return
	}
	t.ingest(line)
}

// ingest routes one line to its application and files it under that sub-tab
// and under "all".
func (t *LogsTab) ingest(line sources.LogLine) {
	line.App = RouteLine(line.Lane, line.Text, t.last[line.Lane])
	t.last[line.Lane] = line.App
	t.apps[line.App] = true
	t.noteLevel(line)
	t.rows = append(t.rows, line)
	if len(t.rows) > ringCap {
		t.rows = t.rows[len(t.rows)-ringCap:]
	}
	rendered := line.Text
	if t.src.Render != nil {
		rendered = t.src.Render(line)
	}
	if rendered == "" {
		// Nothing worth a row: a record with nothing to say, or a tool banner
		// line already covered another way (domain/logfmt.Render).
		return
	}
	// A record's message can carry newlines of its own, and so can a stack
	// trace. One ring entry holding several physical lines counts as one row
	// to the layout and paints as several on the terminal - a frame taller
	// than the terminal thinks it is. Each physical line is its own row;
	// only the first carries the record, since only it has the fields.
	for i, physical := range strings.Split(rendered, "\n") {
		row := Row{ID: t.pages.nextRowID(), Text: physical}
		if i == 0 {
			row.Source = line.Text
		}
		t.pages.push(AllApps, row)
		t.pages.push(line.App, row)
	}
}

// noteLevel remembers when a line worth a mark on the tab bar arrived. Info is
// not one: the log tab is always receiving info, so marking it for info would
// mark it permanently and the mark would mean nothing.
func (t *LogsTab) noteLevel(line sources.LogLine) {
	switch logfmt.Level(line.Level) {
	case logfmt.LevelError, logfmt.LevelFatal:
		t.lastError = newest(t.lastError, line.At)
	case logfmt.LevelWarn:
		t.lastWarn = newest(t.lastWarn, line.At)
	case logfmt.LevelNone, logfmt.LevelTrace, logfmt.LevelDebug, logfmt.LevelInfo:
		// Ordinary traffic. The tab is always receiving it.
	}
}

// Attention marks the log tab when something worth reading arrived while the
// reader was on another tab: a failure in red, a warning in the ordinary color.
func (t *LogsTab) Attention(since time.Time) Attention {
	switch {
	case t.lastError.After(since):
		return AttentionFailure
	case t.lastWarn.After(since):
		return AttentionNotice
	}
	return AttentionNone
}

// SelectedSubTab is the application on screen, for the model's navigation.
func (t *LogsTab) SelectedSubTab() string { return t.selected }

// MoveSubTab cycles the application sub-tabs.
func (t *LogsTab) MoveSubTab(delta int) { t.moveSubTab(delta) }

// SubTabs is the applications with output, in the fixed order, "all" first.
func (t *LogsTab) SubTabs() []string {
	out := []string{AllApps}
	for _, app := range LogApps {
		if app != AllApps && t.apps[app] {
			out = append(out, app)
		}
	}
	return out
}

// Selected is the sub-tab on screen.
func (t *LogsTab) Selected() string { return t.selected }

// Header is the application sub-tabs, pinned above the output.
func (t *LogsTab) Header() []string { return []string{" " + t.subTabsLine()} }

// Body renders the current sub-tab's window.
func (t *LogsTab) Body(f Frame) []Row {
	rows := f.Rows()
	t.bodyRows = rows
	lines := t.filtered(t.selected, rows)
	if len(lines) == 0 {
		return []Row{{Text: " " + dim("waiting for output…")}}
	}
	out := make([]Row, 0, len(lines))
	for _, line := range lines {
		out = append(out, Row{
			ID: line.ID, Source: line.Source,
			Text: " " + highlight(line.Text, t.pages.query),
		})
	}
	return out
}

// filtered is the visible window with the severity floor applied. The floor is
// applied to the rendered ring rather than at ingest so that raising it back to
// everything shows the lines that were already there, instead of only what has
// arrived since.
func (t *LogsTab) filtered(ring string, rows int) []Row {
	if t.floor == logfmt.LevelNone {
		return t.pages.visible(ring, rows)
	}
	var kept []Row
	for _, row := range t.pages.lines[ring] {
		if admits(row.Text, t.floor) {
			kept = append(kept, row)
		}
	}
	return lastNRows(kept, rows)
}

// admits reports whether one rendered line clears the severity floor.
func admits(line string, floor logfmt.Level) bool {
	if rec, ok := logfmt.Parse(stripSGR(line)); ok {
		return levelRank[rec.Level] >= levelRank[floor]
	}
	return renderedLevel(line) >= levelRank[floor]
}

// renderedLevel reads the severity out of an already-rendered line, whose level
// column is a bare word between the lane and the message.
func renderedLevel(line string) int {
	fields := strings.Fields(stripSGR(line))
	for i, token := range fields {
		if i > 3 {
			break
		}
		if rank, ok := levelRank[logfmt.NormalizeLevel(token)]; ok && rank > 0 {
			return rank
		}
	}
	return 0
}

// subTabsLine renders the application sub-tabs, the selected one inverted.
func (t *LogsTab) subTabsLine() string {
	parts := []string{}
	for _, app := range t.SubTabs() {
		if app == t.selected {
			parts = append(parts, sgrReverse+" "+app+" "+sgrReset)
			continue
		}
		parts = append(parts, dim(" "+app+" "))
	}
	return strings.Join(parts, " ")
}

// Footer names the severity floor, the source, and where the muted lines went.
func (t *LogsTab) Footer() string {
	head := t.pages.footer(t.selected)
	parts := []string{floorLabel(t.floor)}
	if t.fromLoki {
		parts = append(parts, "source Loki")
	} else if t.lokiUp() {
		parts = append(parts, "info and debug lines are in Loki · L switches this sub-tab to it")
	}
	parts = append(parts, "[ ] moves between applications")
	return head + "\n " + dim(strings.Join(parts, " · "))
}

// floorLabel spells the severity floor for the footer.
func floorLabel(floor logfmt.Level) string {
	switch floor {
	case logfmt.LevelWarn:
		return "showing warn and above (a for everything)"
	case logfmt.LevelError:
		return "showing errors only (a for everything)"
	case logfmt.LevelNone, logfmt.LevelTrace, logfmt.LevelDebug, logfmt.LevelInfo, logfmt.LevelFatal:
		return "showing everything (w warn+, e errors)"
	}
	return "showing everything (w warn+, e errors)"
}

func (t *LogsTab) lokiUp() bool { return t.src.LokiUp != nil && t.src.LokiUp() }

// Key takes the level keys, the source switch, the sub-tab movement, and
// everything the pager owns.
func (t *LogsTab) Key(k string) bool {
	if t.pages.prompt {
		return t.pages.key(t.selected, k, 1)
	}
	switch k {
	case "w", "e", "a":
		t.floor = levelFloors[k]
		return true
	case "L":
		t.fromLoki = !t.fromLoki
		return true
	case "]":
		t.moveSubTab(1)
		return true
	case "[":
		t.moveSubTab(-1)
		return true
	case "esc":
		if t.pages.query != "" {
			t.pages.clearSearch()
			return true
		}
		return false
	}
	return t.pages.key(t.selected, k, maxInt(t.bodyRows, 1))
}

// moveSubTab cycles the application sub-tabs.
func (t *LogsTab) moveSubTab(delta int) {
	subs := t.SubTabs()
	at := 0
	for i, app := range subs {
		if app == t.selected {
			at = i
		}
	}
	t.selected = subs[((at+delta)%len(subs)+len(subs))%len(subs)]
}

// Rows is the tab's content as plain data: every line the current sub-tab and
// severity floor admits, newest last.
func (t *LogsTab) Rows() any {
	out := make([]sources.LogLine, 0, len(t.rows))
	for _, line := range t.rows {
		if t.selected != AllApps && line.App != t.selected {
			continue
		}
		if levelRank[logfmt.Level(line.Level)] < levelRank[t.floor] {
			continue
		}
		out = append(out, line)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].At.Before(out[j].At) })
	return out
}

// Lines exposes one sub-tab's rendered ring, for the tests that assert what
// landed where.
func (t *LogsTab) Lines(app string) []string {
	out := make([]string, 0, len(t.pages.lines[app]))
	for _, row := range t.pages.lines[app] {
		out = append(out, row.Text)
	}
	return out
}

// SelectSubTab moves to one application by name, ignoring a name with no
// output behind it.
func (t *LogsTab) SelectSubTab(app string) {
	if app == AllApps || t.apps[app] {
		t.selected = app
	}
}

func lastN(lines []string, n int) []string {
	if len(lines) <= n {
		return lines
	}
	return lines[len(lines)-n:]
}

func lastNRows(rows []Row, n int) []Row {
	if len(rows) <= n {
		return rows
	}
	return rows[len(rows)-n:]
}

// stripSGR removes the escape sequences a rendered line carries, so a level
// word can be read out of it.
func stripSGR(line string) string {
	var b strings.Builder
	for i := 0; i < len(line); i++ {
		if line[i] != 0x1b {
			b.WriteByte(line[i])
			continue
		}
		for i < len(line) && !isSGRFinal(line[i]) {
			i++
		}
	}
	return b.String()
}

func isSGRFinal(c byte) bool { return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' }
