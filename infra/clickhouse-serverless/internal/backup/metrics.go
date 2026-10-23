package backup

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

// Metrics is the sidecar's own telemetry: Prometheus text on /metrics and
// the same as JSON on /status.
type Metrics struct {
	mu          sync.Mutex
	state       SidecarMode
	started     time.Time
	runner      bool
	runnerKnown bool
	configError string
	modes       map[Mode]*modeMetrics
	decisions   map[string]uint64 // observe mode, "<mode>/<action>"
}

type modeMetrics struct {
	LastSuccess   time.Time `json:"last_success,omitzero"`
	LastAttempt   time.Time `json:"last_attempt,omitzero"`
	LastFailure   time.Time `json:"last_failure,omitzero"`
	LastDuration  float64   `json:"last_duration_seconds"`
	LastBytes     uint64    `json:"last_size_bytes"`
	LastBackup    string    `json:"last_backup,omitempty"`
	LastOutcome   string    `json:"last_outcome,omitempty"`
	LastError     string    `json:"last_error,omitempty"`
	LastDecision  string    `json:"last_decision,omitempty"`
	Failures      uint64    `json:"failures_total"`
	InFlight      bool      `json:"in_flight"`
	NextScheduled time.Time `json:"next_scheduled,omitzero"`
}

// NewMetrics starts the telemetry of a sidecar in state.
func NewMetrics(state SidecarMode, started time.Time) *Metrics {
	m := &Metrics{state: state, started: started, modes: map[Mode]*modeMetrics{}, decisions: map[string]uint64{}}
	for _, mode := range Modes {
		m.modes[mode] = &modeMetrics{}
	}
	return m
}

// SetConfigError reports a configuration the sidecar cannot back up with.
func (m *Metrics) SetConfigError(err error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.configError = ""
	if err != nil {
		m.configError = err.Error()
	}
}

// SetRunner records whether this server is the runner.
func (m *Metrics) SetRunner(runner bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runner, m.runnerKnown = runner, true
}

// ObserveSuccess raises the last-success time from backup_log; it never
// moves backwards, whoever wrote the backup.
func (m *Metrics) ObserveSuccess(mode Mode, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if mm := m.modes[mode]; at.After(mm.LastSuccess) {
		mm.LastSuccess = at
	}
}

// LastSuccess is the newest success known for mode.
func (m *Metrics) LastSuccess(mode Mode) time.Time {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.modes[mode].LastSuccess
}

// SetNext records the next firing of mode's schedule.
func (m *Metrics) SetNext(mode Mode, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.modes[mode].NextScheduled = at
}

// Begin marks a run of mode as in flight from at.
func (m *Metrics) Begin(mode Mode, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mm := m.modes[mode]
	mm.LastAttempt, mm.InFlight = at, true
}

// Finish records how a run ended.
func (m *Metrics) Finish(r Result, at time.Time) {
	m.mu.Lock()
	defer m.mu.Unlock()
	mm := m.modes[r.Mode]
	mm.InFlight = false
	mm.LastOutcome = string(r.Outcome)
	mm.LastDecision = string(r.Decision.Action)
	mm.LastError = ""
	if r.Outcome == WouldRun {
		m.decisions[string(r.Mode)+"/"+string(r.Decision.Action)]++
		return
	}
	if r.Backup.Path != "" {
		mm.LastBackup = r.Backup.Path
	}
	switch r.Outcome {
	case Succeeded:
		if r.Backup.End.After(mm.LastSuccess) {
			mm.LastSuccess = r.Backup.End
		}
		mm.LastDuration = r.Duration().Seconds()
		mm.LastBytes = r.Backup.Bytes
	case Failed:
		mm.Failures++
		mm.LastFailure = at
		if r.Err != nil {
			mm.LastError = r.Err.Error()
		}
	}
}

// WritePrometheus writes the text exposition format.
func (m *Metrics) WritePrometheus(w io.Writer) {
	m.mu.Lock()
	defer m.mu.Unlock()
	family := func(name, typ, help string) {
		fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s %s\n", name, help, name, typ)
	}
	sample := func(name, labels string, v float64) {
		if labels != "" {
			labels = "{" + labels + "}"
		}
		fmt.Fprintf(w, "%s%s %s\n", name, labels, strconv.FormatFloat(v, 'f', -1, 64))
	}
	ts := func(t time.Time) float64 { return float64(t.UnixNano()) / 1e9 }
	b2f := func(b bool) float64 {
		if b {
			return 1
		}
		return 0
	}

	family("clickhouse_backup_sidecar_info", "gauge", "Backup sidecar state: run or observe.")
	sample("clickhouse_backup_sidecar_info", fmt.Sprintf("state=%q", m.state), 1)
	family("clickhouse_backup_sidecar_start_timestamp_seconds", "gauge", "When this sidecar process started.")
	sample("clickhouse_backup_sidecar_start_timestamp_seconds", "", ts(m.started))
	family("clickhouse_backup_config_error", "gauge", "1 when the backup configuration is invalid and no backup can run.")
	sample("clickhouse_backup_config_error", "", b2f(m.configError != ""))
	if m.runnerKnown {
		family("clickhouse_backup_runner", "gauge", "1 when this server is the elected backup runner.")
		sample("clickhouse_backup_runner", "", b2f(m.runner))
	}

	perMode := func(name, typ, help string, value func(*modeMetrics) (float64, bool)) {
		family(name, typ, help)
		for _, mode := range Modes {
			if v, ok := value(m.modes[mode]); ok {
				sample(name, fmt.Sprintf("mode=%q", mode), v)
			}
		}
	}
	perMode("clickhouse_backup_last_success_timestamp_seconds", "gauge", "End of the newest completed backup of the mode, from system.backup_log or this runner.",
		func(mm *modeMetrics) (float64, bool) { return ts(mm.LastSuccess), !mm.LastSuccess.IsZero() })
	perMode("clickhouse_backup_last_attempt_timestamp_seconds", "gauge", "When this sidecar last started a run of the mode.",
		func(mm *modeMetrics) (float64, bool) { return ts(mm.LastAttempt), !mm.LastAttempt.IsZero() })
	perMode("clickhouse_backup_last_failure_timestamp_seconds", "gauge", "When a run of the mode last failed in this sidecar.",
		func(mm *modeMetrics) (float64, bool) { return ts(mm.LastFailure), !mm.LastFailure.IsZero() })
	perMode("clickhouse_backup_last_duration_seconds", "gauge", "Server-side duration of the last backup this sidecar completed.",
		func(mm *modeMetrics) (float64, bool) { return mm.LastDuration, mm.LastBackup != "" })
	perMode("clickhouse_backup_last_size_bytes", "gauge", "total_size of the last backup this sidecar completed.",
		func(mm *modeMetrics) (float64, bool) { return float64(mm.LastBytes), mm.LastBackup != "" })
	perMode("clickhouse_backup_failures_total", "counter", "Runs of the mode that failed in this sidecar.",
		func(mm *modeMetrics) (float64, bool) { return float64(mm.Failures), true })
	perMode("clickhouse_backup_in_flight", "gauge", "1 while this sidecar runs or waits for a backup of the mode.",
		func(mm *modeMetrics) (float64, bool) { return b2f(mm.InFlight), true })

	if m.state == SidecarObserve {
		family("clickhouse_backup_dry_run_decisions_total", "counter", "Decisions taken in observe mode, by action.")
		keys := make([]string, 0, len(m.decisions))
		for k := range m.decisions {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			mode, action := splitKey(k)
			sample("clickhouse_backup_dry_run_decisions_total", fmt.Sprintf("mode=%q,action=%q", mode, action), float64(m.decisions[k]))
		}
	}
}

func splitKey(k string) (string, string) {
	for i := range k {
		if k[i] == '/' {
			return k[:i], k[i+1:]
		}
	}
	return k, ""
}

// Status is the /status document.
type Status struct {
	State       SidecarMode          `json:"state"`
	Started     time.Time            `json:"started"`
	Runner      *bool                `json:"runner,omitempty"`
	ConfigError string               `json:"config_error,omitempty"`
	Modes       map[Mode]modeMetrics `json:"modes"`
	Decisions   map[string]uint64    `json:"dry_run_decisions,omitempty"`
}

// Status snapshots the telemetry.
func (m *Metrics) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	s := Status{State: m.state, Started: m.started, ConfigError: m.configError, Modes: map[Mode]modeMetrics{}}
	if m.runnerKnown {
		r := m.runner
		s.Runner = &r
	}
	for mode, mm := range m.modes {
		s.Modes[mode] = *mm
	}
	if len(m.decisions) > 0 {
		s.Decisions = map[string]uint64{}
		for k, v := range m.decisions {
			s.Decisions[k] = v
		}
	}
	return s
}

// Handler serves /metrics, /status and /healthz.
func (m *Metrics) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /metrics", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		m.WritePrometheus(w)
	})
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		_ = enc.Encode(m.Status())
	})
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = io.WriteString(w, "ok\n")
	})
	return mux
}
