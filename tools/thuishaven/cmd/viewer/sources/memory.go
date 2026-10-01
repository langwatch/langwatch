package sources

import "fmt"

// The memory doubles. Every datasource has one, so a tab's behavior - what it
// renders, what it does on a key, whether it polls at all - is provable without
// a container, a network, or a stack. Each counts its own queries, which is how
// "nothing is polled" and "only the visible tab polls" are tested: those are
// claims about calls that must NOT happen, and an assertion on an empty screen
// would pass for the wrong reason.

// MemoryLogs replays a fixed set of lines, handing out everything not yet read
// on each Fresh call, exactly as a file tail does.
type MemoryLogs struct {
	Lines []LogLine
	read  int
	// Calls counts Fresh calls, so a test can prove a source was left alone.
	Calls int
}

// Fresh returns the lines appended since the previous call.
func (m *MemoryLogs) Fresh() []LogLine {
	m.Calls++
	out := m.Lines[m.read:]
	m.read = len(m.Lines)
	return out
}

// Append adds lines a later Fresh will hand out, the way a live lane writes.
func (m *MemoryLogs) Append(lines ...LogLine) { m.Lines = append(m.Lines, lines...) }

// MemoryTraces answers from fixed slices. Down makes it behave as a stack that
// is not running: Up is false and any query is a failure, not an empty list.
type MemoryTraces struct {
	Down      bool
	RootSpans []RootSpan
	Trees     map[string][]Span
	// Queries counts the calls that would have reached Tempo.
	Queries int
}

// Up reports whether the observability stack is listening.
func (m *MemoryTraces) Up() bool { return !m.Down }

// Roots lists the recent root spans, optionally only the failed ones.
func (m *MemoryTraces) Roots(errorsOnly bool) ([]RootSpan, error) {
	m.Queries++
	if m.Down {
		return nil, ErrStackDown
	}
	if !errorsOnly {
		return m.RootSpans, nil
	}
	var out []RootSpan
	for _, r := range m.RootSpans {
		if r.Error {
			out = append(out, r)
		}
	}
	return out, nil
}

// Tree returns one trace's spans.
func (m *MemoryTraces) Tree(traceID string) ([]Span, error) {
	m.Queries++
	if m.Down {
		return nil, ErrStackDown
	}
	return m.Trees[traceID], nil
}

// GrafanaURL is the browser destination for one trace.
func (m *MemoryTraces) GrafanaURL(traceID string) string {
	return "http://127.0.0.1:3000/explore?traceId=" + traceID
}

// MemoryMetrics answers the fixed panel from a fixed slice.
type MemoryMetrics struct {
	Down    bool
	Series  []Series
	Queries int
}

// Up reports whether the observability stack is listening.
func (m *MemoryMetrics) Up() bool { return !m.Down }

// Panel returns the fixed panel's series in order.
func (m *MemoryMetrics) Panel() ([]Series, error) {
	m.Queries++
	if m.Down {
		return nil, ErrStackDown
	}
	return m.Series, nil
}

// MemoryProfiles answers the per-service top-ten lists from a fixed slice.
type MemoryProfiles struct {
	Down     bool
	Services []ServiceProfile
	Queries  int
}

// Up reports whether the observability stack is listening.
func (m *MemoryProfiles) Up() bool { return !m.Down }

// Top returns each service's hottest functions.
func (m *MemoryProfiles) Top() ([]ServiceProfile, error) {
	m.Queries++
	if m.Down {
		return nil, ErrStackDown
	}
	return m.Services, nil
}

// GrafanaURL is the browser destination for one service's flame graph.
func (m *MemoryProfiles) GrafanaURL(service string) string {
	return fmt.Sprintf("http://127.0.0.1:3000/a/grafana-pyroscope-app/single?query=%s", service)
}

// MemoryStores answers the store panel from a fixed slice.
type MemoryStores struct {
	StoreStats []StoreStat
	Queries    int
}

// Stats returns each managed server against its limit.
func (m *MemoryStores) Stats() ([]StoreStat, error) {
	m.Queries++
	return m.StoreStats, nil
}

// MemoryJobs answers the one-shot history from a fixed slice.
type MemoryJobs struct {
	History []JobRun
}

// Runs returns the one-shot lanes' history, newest last as it was recorded.
func (m *MemoryJobs) Runs() []JobRun { return m.History }
