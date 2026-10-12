package scenario

import (
	"context"
	"os"
	"sync"
	"sync/atomic"
	"time"
)

// Settings are process-wide defaults, the Go counterpart of the JS
// scenario.config.js project config plus scenario.configure().
type Settings struct {
	// DefaultModel is used by the user simulator and the judge when their
	// config leaves the model unset.
	DefaultModel ModelConfig
	// Headless stops the SDK from opening the browser on the first run.
	// Defaults to SCENARIO_HEADLESS being set.
	Headless bool
	// FetchRemoteTraces is the project default of ScenarioConfig.FetchRemoteTraces.
	FetchRemoteTraces bool
	// TraceWaitTimeout, TraceWaitExtension and TraceQuietPeriod are the project
	// defaults of the ScenarioConfig fields with the same names.
	TraceWaitTimeout   time.Duration
	TraceWaitExtension time.Duration
	TraceQuietPeriod   *time.Duration
	// EvaluatorRunner runs ScenarioConfig.Evaluators when the scenario sets
	// no runner of its own.
	EvaluatorRunner EvaluatorRunner
	// RemoteTraceFetcher fetches remote traces for the judge when
	// FetchRemoteTraces is on and the judge sets no fetcher of its own.
	RemoteTraceFetcher RemoteTraceFetcher
	// BatchRunOpener shows the live batch run. By default the batch is handed
	// to this machine's open LangWatch tab, or a tab is opened, following
	// SCENARIO_BROWSER (auto, never, always), Headless and CI. A custom
	// opener is not called when Headless is set.
	BatchRunOpener BatchRunOpener
	// GranularEvents streams message lifecycle events instead of snapshots.
	// Defaults to SCENARIO_SEND_GRANULAR_EVENTS.
	GranularEvents bool
}

// BatchRunInfo describes the live view of a batch run.
type BatchRunInfo struct {
	BatchURL      string
	BatchRunID    string
	ScenarioSetID string
	LangWatch     LangWatchConfig
}

// BatchRunOpener presents a batch run to the user and reports whether it was
// handed to an already open LangWatch tab.
type BatchRunOpener func(ctx context.Context, info BatchRunInfo) (handedOff bool)

// ConfigureOption changes Settings.
type ConfigureOption func(*Settings)

// WithDefaultModel sets the default model of the built-in agents.
func WithDefaultModel(m ModelConfig) ConfigureOption {
	return func(s *Settings) { s.DefaultModel = m }
}

// WithHeadless enables or disables opening the browser.
func WithHeadless(headless bool) ConfigureOption {
	return func(s *Settings) { s.Headless = headless }
}

// WithFetchRemoteTraces sets the project default for remote trace fetching.
func WithFetchRemoteTraces(on bool) ConfigureOption {
	return func(s *Settings) { s.FetchRemoteTraces = on }
}

// WithTraceWait sets the project defaults of the remote trace wait budgets.
// Zero values keep the built-in defaults.
func WithTraceWait(timeout, extension time.Duration) ConfigureOption {
	return func(s *Settings) { s.TraceWaitTimeout, s.TraceWaitExtension = timeout, extension }
}

// WithTraceQuietPeriod sets the project default of the quiet period.
func WithTraceQuietPeriod(d time.Duration) ConfigureOption {
	return func(s *Settings) { s.TraceQuietPeriod = &d }
}

// WithEvaluatorRunner registers the runner for ScenarioConfig.Evaluators.
func WithEvaluatorRunner(r EvaluatorRunner) ConfigureOption {
	return func(s *Settings) { s.EvaluatorRunner = r }
}

// WithRemoteTraceFetcher registers the remote trace fetcher of the judge.
func WithRemoteTraceFetcher(f RemoteTraceFetcher) ConfigureOption {
	return func(s *Settings) { s.RemoteTraceFetcher = f }
}

// WithBatchRunOpener replaces how a batch run is shown.
func WithBatchRunOpener(o BatchRunOpener) ConfigureOption {
	return func(s *Settings) { s.BatchRunOpener = o }
}

// WithGranularEvents selects granular message events for every run.
func WithGranularEvents(on bool) ConfigureOption {
	return func(s *Settings) { s.GranularEvents = on }
}

var (
	settingsPtr  atomic.Pointer[Settings]
	settingsOnce sync.Once
)

// Configure updates the process-wide settings. Safe for concurrent use;
// runs already started keep the settings they read.
func Configure(opts ...ConfigureOption) {
	for {
		old := currentSettings()
		next := *old
		for _, opt := range opts {
			opt(&next)
		}
		if settingsPtr.CompareAndSwap(old, &next) {
			return
		}
	}
}

// CurrentSettings returns a copy of the process-wide settings.
func CurrentSettings() Settings { return *currentSettings() }

func currentSettings() *Settings {
	settingsOnce.Do(func() {
		settingsPtr.CompareAndSwap(nil, &Settings{
			Headless:       os.Getenv("SCENARIO_HEADLESS") != "",
			GranularEvents: envFlag("SCENARIO_SEND_GRANULAR_EVENTS"),
		})
	})
	return settingsPtr.Load()
}

// envFlag parses a boolean environment variable: true/1/yes/on enable it;
// anything else, including "false" and "0", leaves it off.
func envFlag(name string) bool {
	switch lower(os.Getenv(name)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func lower(s string) string {
	b := []byte(s)
	for i, c := range b {
		if c >= 'A' && c <= 'Z' {
			b[i] = c + 'a' - 'A'
		}
	}
	return string(b)
}
