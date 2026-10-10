// Package sources is where the up viewer's tabs get their rows.
//
// Every tab is one datasource and nothing more: logs come from the capture
// files (or from Loki), traces from Tempo, metrics from Prometheus, profiles
// from Pyroscope, stores and jobs from what haven already manages. Each one is
// an interface here with a memory double beside it, so every tab's behavior is
// provable without a running stack - which is the whole reason the viewer's
// datasources are not simply inlined into the bubbletea model.
package sources

import (
	"errors"
	"time"
)

// ErrStackDown is what a Grafana-backed source returns when the observability
// stack is not listening. It is a distinct error rather than an empty result
// because "no data in this window" and "nothing to ask" read identically on
// screen and mean opposite things: one is a quiet stack, the other is a missing
// one, and only the second has a command that fixes it.
var ErrStackDown = errors.New("the observability stack is not running")

// StartObservabilityCommand is the command the tabs name when the stack is
// down. It is the same `up` that starts everything else: the observability
// stack is managed, not a separate thing to remember.
const StartObservabilityCommand = "haven up"

// Health is the cheap "is there anything to ask" probe every Grafana-backed
// source answers. It is a port check, never a query: a tab whose stack is down
// must poll nothing at all, and asking that question with an HTTP query would
// be the very poll the tab is supposed to be skipping.
type Health interface {
	Up() bool
}

// LogLine is one captured line, already attributed to the application that
// wrote it rather than only to the lane that hosted it.
type LogLine struct {
	At time.Time `json:"time"`
	// Lane is the supervised lane the line was captured from (ui, backend, go).
	Lane string `json:"lane"`
	// App is the application inside that lane the line belongs to (api, worker,
	// gateway, nlp). For a single-application lane it is the lane's own name.
	App string `json:"app"`
	// Level is the normalized severity, empty for a line that named none.
	Level string `json:"level,omitempty"`
	// Text is the payload exactly as the child wrote it.
	Text string `json:"text"`
	// Rendered is the reader form, painted, as `haven logs` prints it.
	Rendered string `json:"-"`
}

// Logs is the log tab's source: everything appended since the previous call.
// Both backings answer it - the capture files on disk, and Loki for the window
// the muted console never printed.
type Logs interface {
	Fresh() []LogLine
}

// RootSpan is one trace as the traces list shows it.
type RootSpan struct {
	TraceID  string        `json:"traceId"`
	At       time.Time     `json:"time"`
	Service  string        `json:"service"`
	Name     string        `json:"name"`
	Duration time.Duration `json:"duration"`
	// Error is whether the root span carries an error status.
	Error bool `json:"error"`
}

// Span is one node of a trace's tree, with the depth it hangs at.
type Span struct {
	Depth    int           `json:"depth"`
	Name     string        `json:"name"`
	Service  string        `json:"service"`
	Duration time.Duration `json:"duration"`
}

// Traces is the traces tab's source: this worktree's recent root spans, and
// one trace's whole tree on demand.
type Traces interface {
	Health
	Roots(errorsOnly bool) ([]RootSpan, error)
	Tree(traceID string) ([]Span, error)
	// GrafanaURL is where `o` sends the browser for one trace.
	GrafanaURL(traceID string) string
}

// Series is one metric panel: a label, its current value already formatted for
// a person, and the samples the sparkline is drawn from (oldest first).
type Series struct {
	Label   string    `json:"label"`
	Value   string    `json:"value"`
	Samples []float64 `json:"samples"`
}

// Metrics is the metrics tab's source: the fixed panel, in panel order.
type Metrics interface {
	Health
	Panel() ([]Series, error)
}

// ProfileEntry is one hot function in a service's profile.
type ProfileEntry struct {
	Function string `json:"function"`
	// Share is the fraction of the profile this function accounts for, 0..1.
	Share float64 `json:"share"`
}

// ServiceProfile is one service's two top-ten lists over the profile window.
type ServiceProfile struct {
	Service string         `json:"service"`
	CPU     []ProfileEntry `json:"cpu"`
	Heap    []ProfileEntry `json:"heap"`
}

// Profiles is the profiles tab's source.
type Profiles interface {
	Health
	Top() ([]ServiceProfile, error)
	// GrafanaURL is where `o` sends the browser for one service's flame graph.
	GrafanaURL(service string) string
}

// StoreStat is one database server against the limit it was given.
type StoreStat struct {
	Name string `json:"name"`
	// Measure names what is being counted ("connections", "memory").
	Measure string  `json:"measure"`
	Used    float64 `json:"used"`
	Limit   float64 `json:"limit"`
	// Unit is how Used and Limit are spelled for a person ("", "bytes").
	Unit string `json:"unit"`
}

// Fraction is how much of the limit is in use, 0 when there is no limit to
// measure against.
func (s StoreStat) Fraction() float64 {
	if s.Limit <= 0 {
		return 0
	}
	return s.Used / s.Limit
}

// StoreWarnFraction is the share of a limit past which a store is marked. Nine
// tenths of a connection pool or a memory cap is not a problem yet, but it is
// the last moment at which it is still cheap to do something about it.
const StoreWarnFraction = 0.9

// Marked reports whether this store is past the warning share of its limit.
func (s StoreStat) Marked() bool { return s.Fraction() >= StoreWarnFraction }

// Stores is the stores tab's source.
type Stores interface {
	Stats() ([]StoreStat, error)
}

// JobRun is one one-shot lane's run during this up.
type JobRun struct {
	Name     string        `json:"name"`
	At       time.Time     `json:"time"`
	Duration time.Duration `json:"duration"`
	// Exit is the process exit status; 0 is success.
	Exit int `json:"exit"`
	// Output is the lines the job wrote, for the drill-in.
	Output []string `json:"output,omitempty"`
}

// OK reports whether the run succeeded.
func (j JobRun) OK() bool { return j.Exit == 0 }

// Jobs is the jobs tab's source: the history of the one-shot lanes.
type Jobs interface {
	Runs() []JobRun
}
