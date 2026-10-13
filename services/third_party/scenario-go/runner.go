package scenario

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// RunOptions are per-invocation options of Run.
type RunOptions struct {
	// LangWatch overrides ScenarioConfig.LangWatch and the environment.
	LangWatch LangWatchConfig
	// BatchRunID groups runs; defaults to BatchRunID().
	BatchRunID string
	// RunID pre-assigns the run id (platform use).
	RunID string
	// SendGranularEvents selects granular message events for this run,
	// overriding SCENARIO_SEND_GRANULAR_EVENTS and Configure. Default off.
	SendGranularEvents *bool
	// Values are merged over ScenarioConfig.Values.
	Values map[any]any
	// OnEvent receives every event of the run, in order, as it is
	// delivered.
	OnEvent func(Event)
	// HTTPClient posts the run's events; defaults to a shared keep-alive
	// client. Embedders pass their own (for example an egress-fenced one).
	HTTPClient *http.Client
	// Quiet suppresses the console banners (greeting, live link) regardless
	// of SCENARIO_DISABLE_SIMULATION_REPORT_INFO.
	Quiet bool
}

// RunOption configures RunOptions.
type RunOption func(*RunOptions)

// WithLangWatch sets the LangWatch project of the run.
func WithLangWatch(c LangWatchConfig) RunOption { return func(o *RunOptions) { o.LangWatch = c } }

// WithBatchRunID sets the batch run id.
func WithBatchRunID(id string) RunOption { return func(o *RunOptions) { o.BatchRunID = id } }

// WithRunID pre-assigns the run id.
func WithRunID(id string) RunOption { return func(o *RunOptions) { o.RunID = id } }

// WithGranularEventsForRun selects granular message events for this run.
func WithGranularEventsForRun(on bool) RunOption {
	return func(o *RunOptions) { o.SendGranularEvents = &on }
}

// WithValue sets a per-run value read through Executor.Value.
func WithValue(key, value any) RunOption {
	return func(o *RunOptions) {
		if o.Values == nil {
			o.Values = map[any]any{}
		}
		o.Values[key] = value
	}
}

// WithHTTPClient sets the client that posts the run's events.
func WithHTTPClient(c *http.Client) RunOption { return func(o *RunOptions) { o.HTTPClient = c } }

// WithQuiet suppresses the console banners.
func WithQuiet() RunOption { return func(o *RunOptions) { o.Quiet = true } }

// WithEventListener receives every event of the run.
func WithEventListener(fn func(Event)) RunOption { return func(o *RunOptions) { o.OnEvent = fn } }

// Run executes a scenario and returns its result. Runs are independent and
// safe to execute in parallel (t.Parallel()).
//
// The error is non-nil when the configuration is invalid (result nil), or
// when the run ended in an error or a failed assertion; the result is then
// the error result that was reported to LangWatch. A scenario that merely
// fails its criteria returns a result with Success false and a nil error.
func Run(ctx context.Context, cfg ScenarioConfig, opts ...RunOption) (*ScenarioResult, error) {
	var o RunOptions
	for _, opt := range opts {
		opt(&o)
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	cfg = cfg.withDefaults()
	if len(o.Values) > 0 {
		merged := make(map[any]any, len(cfg.Values)+len(o.Values))
		for k, v := range cfg.Values {
			merged[k] = v
		}
		for k, v := range o.Values {
			merged[k] = v
		}
		cfg.Values = merged
	}

	settings := currentSettings()
	tracing := ensureTracing()
	lw := resolveLangWatch(o.LangWatch, cfg.LangWatch)
	cfg.LangWatch = lw
	batchID := o.BatchRunID
	if batchID == "" {
		batchID = BatchRunID()
	}
	runID := o.RunID
	if runID == "" {
		runID = generateRunID()
	}
	granular := settings.GranularEvents
	if o.SendGranularEvents != nil {
		granular = *o.SendGranularEvents
	}

	alerts := newAlertLogger(batchID, settings)
	alerts.disabled = alerts.disabled || o.Quiet
	alerts.greeting(lw.APIKey)
	reporter := newEventReporter(lw)
	if o.HTTPClient != nil {
		reporter.client = o.HTTPClient
	}
	var bus *eventBus
	var publish func(Event)
	if reporter.enabled() || o.OnEvent != nil {
		delivery := &eventDelivery{reporter: reporter, listener: o.OnEvent, alerts: alerts, setID: cfg.SetID, lw: lw}
		bus = newEventBus(delivery.deliver)
		publish = bus.publish
	}

	ex := newExecutor(cfg, runID, batchID, publish, granular)
	// Deferred so a run that panics or exits its goroutine (t.FailNow in a
	// step) still delivers its events and releases its spans.
	defer func() {
		if bus != nil {
			bus.drain(eventBusDrainTimeout)
		}
		tracing.flush(context.WithoutCancel(ctx))
		DefaultSpanCollector().ClearThread(cfg.ThreadID)
		if f := settings.RemoteTraceFetcher; f != nil {
			f.ClearThread(cfg.ThreadID)
		}
		if f := defaultFetcher.Load(); f != nil {
			f.ClearThread(cfg.ThreadID)
		}
	}()
	result, err := ex.execute(ctx)

	if cfg.Verbose && result != nil && !result.Success {
		printFailure(os.Stdout, cfg.Name, result)
	}
	return result, err
}

// printFailure prints a failed run like the JS verbose output.
func printFailure(w io.Writer, name string, r *ScenarioResult) {
	fmt.Fprintf(w, "Scenario failed: %s\n", name)
	fmt.Fprintf(w, "Reasoning: %s\n", r.Reasoning)
	fmt.Fprintln(w, "--------------------------------")
	fmt.Fprintf(w, "Met criteria: %s\n", strings.Join(r.MetCriteria, "\n- "))
	fmt.Fprintf(w, "Unmet criteria: %s\n", strings.Join(r.UnmetCriteria, "\n- "))
	for _, m := range r.Messages {
		fmt.Fprintln(w, formatMessage(m))
	}
}

func formatMessage(m Message) string {
	switch m.Role {
	case RoleUser:
		return "User: " + messageText(m)
	case RoleAssistant:
		parts := []string{}
		if t := m.Text(); t != "" {
			parts = append(parts, t)
		}
		for _, tc := range m.ToolCalls {
			parts = append(parts, "(tool call): "+tc.Name+" id:"+tc.ID+" args:("+tc.Arguments+")")
		}
		if len(parts) == 1 {
			return "Assistant: " + parts[0]
		}
		return "Assistant: \n" + strings.Join(parts, "\n")
	case RoleTool:
		return "Tool: (tool result): " + m.ToolName + " id:" + m.ToolCallID + " result:(" + m.Text() + ")"
	}
	return string(m.Role) + ": " + m.Text()
}
