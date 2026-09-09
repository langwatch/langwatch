package viewer

import (
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/cmd/viewer/sources"
)

// The top row is fixed. Before this the tabs were whatever capture files
// happened to exist, which meant the row changed shape as a stack booted and
// two of the lanes hosted two applications each with no way to tell them apart.
// A fixed row is one a person learns once: the digit that opens traces today
// opens traces tomorrow, on every stack.

// TabNames is the top row, in order. The digit keys index it directly.
var TabNames = []string{"session", "logs", "errors", "traces", "metrics", "profiles", "stores", "jobs"}

// SessionTab is the leading tab's name. The session dashboard is rendered by
// the model that owns the stack's action surface rather than here, because it
// is the one tab whose datasource is haven itself.
const SessionTab = "session"

// Tab is one screen: it renders, it takes the keys it owns, and it says what
// its rows are for an agent. Poll is called only while the tab is visible.
type Tab interface {
	// Name is the tab's label in the top row and its command name.
	Name() string
	// Poll refreshes the tab from its datasource. Called on the viewer's beat,
	// and only for the tab currently on screen.
	Poll()
	// Body is the rendered screen, already painted, one string per row.
	Body(f Frame) []string
	// Footer is the key hint line under the body.
	Footer() string
	// Key offers one keypress; true means the tab consumed it.
	Key(k string) bool
	// Rows is the same content the body renders, as plain data, for the tab's
	// `--json` command. A tab and its command can then never disagree.
	Rows() any
}

// Sources is every datasource the tabs read, injected as interfaces so each
// tab's behavior is provable against a memory double.
type Sources struct {
	Files    sources.Logs
	Loki     sources.Logs
	LokiUp   func() bool
	Traces   sources.Traces
	Metrics  sources.Metrics
	Profiles sources.Profiles
	Stores   sources.Stores
	Jobs     sources.Jobs
	// Render turns one captured line into the reader form the log tab shows.
	Render func(line sources.LogLine) string
	// Open sends a URL to the browser, for `o`.
	Open func(url string) error
	// Now is the clock, injected so a row's "3s ago" is testable.
	Now func() time.Time
}

// New builds every tab but the session dashboard, in the top row's order.
func New(src Sources) []Tab {
	if src.Now == nil {
		src.Now = time.Now
	}
	return []Tab{
		NewLogsTab(src),
		NewErrorsTab(src),
		NewTracesTab(src),
		NewMetricsTab(src),
		NewProfilesTab(src),
		NewStoresTab(src),
		NewJobsTab(src),
	}
}

// stackDownBody is what a Grafana-backed tab shows instead of rows when the
// observability stack is not running. One line, naming the state and the
// command that fixes it - not an empty screen, which reads as "your stack is
// doing nothing" when it means "nothing was asked".
func stackDownBody() []string {
	return []string{" " + dim(sources.ErrStackDown.Error()+" - start it with `"+sources.StartObservabilityCommand+"`")}
}
