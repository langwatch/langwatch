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
var TabNames = []string{"session", "logs", "jobs", "errors", "traces", "metrics", "profiles", "stores"}

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
	// Header is the rows pinned to the top of the body: drawn once, never
	// scrolled, never expanded. The log tab's application sub-tabs are the only
	// one today, and they were a body row until a frame taller than the
	// terminal started leaving them in the middle of the output.
	Header() []string
	// Body is the rendered screen, already painted, one entry per row, each
	// carrying the identity of the line it renders so the reader's expansion
	// follows the line rather than the place it was drawn. f.Rows() is the
	// budget the body has left AFTER the header, and it is exact: a tab that
	// returns more rows than that has them dropped from the top.
	Body(f Frame) []Row
	// Footer is the key hint line under the body.
	Footer() string
	// Key offers one keypress; true means the tab consumed it.
	Key(k string) bool
	// Rows is the same content the body renders, as plain data, for the tab's
	// `--json` command. A tab and its command can then never disagree.
	Rows() any
	// Attention is what has happened on this tab since the reader last had it on
	// screen. The tab answers "what is new" from its own data; the model owns
	// "when was this last seen", because only the model knows what is on screen.
	Attention(since time.Time) Attention
}

// Attention is how much a tab off screen wants to be looked at.
type Attention int

// The three states. Nothing between "quiet" and "a failure happened" is worth a
// second color: a tab bar that lights up in four shades is a tab bar nobody
// reads.
const (
	// AttentionNone is a tab with nothing new since it was last seen.
	AttentionNone Attention = iota
	// AttentionNotice is something new and ordinary - a job finished, a warning.
	AttentionNotice
	// AttentionFailure is something new that failed.
	AttentionFailure
)

// noHeader is embedded by every tab with nothing to pin above its body.
type noHeader struct{}

// Header reports that this tab pins no rows above its body.
func (noHeader) Header() []string { return nil }

// noAttention is embedded by the tabs whose content is a live reading rather
// than a stream of events. A trace list or a memory meter is never "new": it is
// whatever it is at the moment you look, and marking it would mark it forever.
type noAttention struct{}

// Attention reports that nothing on this tab is worth interrupting for.
func (noAttention) Attention(time.Time) Attention { return AttentionNone }

// newest returns the later of two instants, treating the zero time as absent.
func newest(a, b time.Time) time.Time {
	if b.After(a) {
		return b
	}
	return a
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
		NewJobsTab(src),
		NewErrorsTab(src),
		NewTracesTab(src),
		NewMetricsTab(src),
		NewProfilesTab(src),
		NewStoresTab(src),
	}
}

// stackDownBody is what a Grafana-backed tab shows instead of rows when the
// observability stack is not running. One line, naming the state and the
// command that fixes it - not an empty screen, which reads as "your stack is
// doing nothing" when it means "nothing was asked".
func stackDownBody() []Row {
	return textRows([]string{" " + dim(sources.ErrStackDown.Error()+" - start it with `"+sources.StartObservabilityCommand+"`")})
}
