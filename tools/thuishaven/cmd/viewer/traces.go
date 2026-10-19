package viewer

import (
	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// TracesTab lists this worktree's recent root spans and opens one as a tree.
// Everything it asks Tempo carries the worktree attribute: one collector serves
// every worktree on the machine, so an unfiltered list is somebody else's stack
// and looks exactly like your own.

// TracesTab is the traces screen.
type TracesTab struct {
	noHeader
	noAttention
	src    Sources
	roots  []sources.RootSpan
	cursor int
	// errorsOnly narrows the list to traces whose root span failed.
	errorsOnly bool
	// openTrace is the trace drilled into, empty on the list.
	openTrace string
	tree      []sources.Span
	down      bool
	toast     string
}

// NewTracesTab builds the traces screen over Tempo.
func NewTracesTab(src Sources) *TracesTab { return &TracesTab{src: src} }

// Name is the tab's label and command name.
func (t *TracesTab) Name() string { return "traces" }

// Poll refreshes the list, or the open trace's tree. Nothing is asked when the
// observability stack is not listening.
func (t *TracesTab) Poll() {
	if t.src.Traces == nil {
		return
	}
	if t.down = !t.src.Traces.Up(); t.down {
		return
	}
	if t.openTrace != "" {
		if tree, err := t.src.Traces.Tree(t.openTrace); err == nil {
			t.tree = tree
		}
		return
	}
	if roots, err := t.src.Traces.Roots(t.errorsOnly); err == nil {
		t.roots = roots
	}
}

// Body renders the trace list, or the open trace's span tree.
func (t *TracesTab) Body(f Frame) []Row {
	if t.down {
		return stackDownBody()
	}
	if t.openTrace != "" {
		return t.treeBody(f)
	}
	if len(t.roots) == 0 {
		return emptyBody("traces in the last ten minutes")
	}
	out := make([]string, 0, len(t.roots))
	keys := make([]string, 0, len(t.roots))
	for i, root := range t.roots {
		out = append(out, t.row(i, root))
		keys = append(keys, root.TraceID)
	}
	return lastNRows(keyedRows(out, keys), f.Rows())
}

// row renders one trace: time, service, root span name, duration and status.
func (t *TracesTab) row(i int, root sources.RootSpan) string {
	status := green("ok")
	if root.Error {
		status = red("error")
	}
	line := " " + dim(root.At.Local().Format(clock)) + "  " +
		pad(root.Service, 22) + " " + pad(root.Name, 34) + " " +
		pad(shortDuration(root.Duration), 8) + " " + status
	if i == t.cursor {
		return sgrReverse + "›" + line + sgrReset
	}
	return " " + line
}

// treeBody renders the open trace as an indented span tree.
func (t *TracesTab) treeBody(f Frame) []Row {
	if len(t.tree) == 0 {
		return emptyBody("spans for this trace")
	}
	out := make([]string, 0, len(t.tree)+1)
	out = append(out, " "+bold(t.openTrace))
	for _, span := range t.tree {
		out = append(out, " "+indent(span.Depth)+span.Name+"  "+
			dim(span.Service)+"  "+dim(shortDuration(span.Duration)))
	}
	return lastNRows(indexedRows(out), f.Rows())
}

// indent is one span's depth, two spaces per level.
func indent(depth int) string {
	out := ""
	for i := 0; i < depth; i++ {
		out += "  "
	}
	return out
}

// Footer names the keys, and any toast the last `o` left behind.
func (t *TracesTab) Footer() string {
	if t.toast != "" {
		return dim(t.toast)
	}
	if t.openTrace != "" {
		return dim("o opens this trace in Grafana · esc back to the list")
	}
	scope := "e shows only failed traces"
	if t.errorsOnly {
		scope = "showing only failed traces · e shows all"
	}
	return dim("↑↓ move · enter opens the span tree · o opens it in Grafana · " + scope)
}

// Key moves the cursor, toggles the errors filter, drills in and opens Grafana.
func (t *TracesTab) Key(k string) bool {
	t.toast = ""
	switch k {
	case "up", "k":
		t.cursor = maxInt(t.cursor-1, 0)
	case "down", "j":
		t.cursor = minInt(t.cursor+1, maxInt(len(t.roots)-1, 0))
	case "e":
		t.errorsOnly = !t.errorsOnly
		t.cursor = 0
		t.Poll()
	case "enter":
		t.drillIn()
	case "o":
		t.openInGrafana()
	case "esc":
		if t.openTrace == "" {
			return false
		}
		t.openTrace, t.tree = "", nil
	default:
		return false
	}
	return true
}

// drillIn opens the highlighted trace's tree.
func (t *TracesTab) drillIn() {
	if t.cursor >= len(t.roots) {
		return
	}
	t.openTrace = t.roots[t.cursor].TraceID
	t.Poll()
}

// openInGrafana sends the selected trace to the browser.
func (t *TracesTab) openInGrafana() {
	id := t.openTrace
	if id == "" && t.cursor < len(t.roots) {
		id = t.roots[t.cursor].TraceID
	}
	if id == "" || t.src.Traces == nil || t.src.Open == nil {
		return
	}
	if err := t.src.Open(t.src.Traces.GrafanaURL(id)); err != nil {
		t.toast = "could not open the browser: " + err.Error()
	}
}

// Rows is the trace list as plain data.
func (t *TracesTab) Rows() any { return t.roots }

// Open is the trace drilled into, empty on the list.
func (t *TracesTab) Open() string { return t.openTrace }

// Tree is the open trace's spans, for the tests.
func (t *TracesTab) Tree() []sources.Span { return t.tree }
