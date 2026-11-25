package scenario

import (
	"context"
	"sync"
	"time"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/propagation"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

// Tracing identity.
const (
	// TracerName is the instrumentation scope of every span the SDK starts.
	TracerName = "github.com/langwatch/scenario/go"
	// SDKName identifies this SDK on scenario spans.
	SDKName = TracerName
	// AttrSDKName and AttrSDKVersion carry the SDK identity on scenario spans.
	AttrSDKName    = "scenario.sdk.name"
	AttrSDKVersion = "scenario.sdk.version"
)

// sdkAttributes are stamped on the run and turn spans.
var sdkAttributes = [...]attribute.KeyValue{
	attribute.String(AttrSDKName, SDKName),
	attribute.String(AttrSDKVersion, Version),
}

// TracingOptions configure SetupScenarioTracing.
type TracingOptions struct {
	// LangWatch selects the LangWatch project spans are exported to; empty
	// fields fall back to the environment. Without an API key no LangWatch
	// exporter is installed (the judge still sees spans).
	LangWatch LangWatchConfig
	// Filters restrict which spans the LangWatch exporter sends, for example
	// ScenarioOnly() or WithCustomScopes(...).
	Filters []langwatch.Filter
	// SpanProcessors are added to the provider.
	SpanProcessors []sdktrace.SpanProcessor
	// TraceExporter is an extra exporter, batched.
	TraceExporter sdktrace.SpanExporter
	// DisableLangWatchExporter skips the LangWatch exporter.
	DisableLangWatchExporter bool
}

// tracingState is the process-wide tracing setup.
type tracingState struct {
	provider *sdktrace.TracerProvider // the SDK provider spans go to
	owned    bool                     // installed by us (vs attached to)
	export   bool                     // an exporter is installed
	err      error
}

var (
	tracingOnce sync.Once
	tracing     tracingState
)

// SetupScenarioTracing configures OpenTelemetry for scenario runs, once per
// process; later calls are no-ops. Run calls it lazily with defaults, so
// call it first only to customize. When the global TracerProvider is
// already an SDK provider (set up by your app), the span collector and
// exporters are attached to it; otherwise a provider is installed globally.
// The provider is never replaced or shut down per run, so parallel runs
// share it safely.
func SetupScenarioTracing(opts TracingOptions) error {
	tracingOnce.Do(func() { tracing = setupTracing(context.Background(), opts) })
	return tracing.err
}

func ensureTracing() *tracingState {
	tracingOnce.Do(func() { tracing = setupTracing(context.Background(), TracingOptions{}) })
	return &tracing
}

func setupTracing(ctx context.Context, opts TracingOptions) tracingState {
	var st tracingState
	processors := make([]sdktrace.SpanProcessor, 0, 4)
	processors = append(processors, DefaultSpanCollector())
	processors = append(processors, opts.SpanProcessors...)
	if opts.TraceExporter != nil {
		processors = append(processors, sdktrace.NewBatchSpanProcessor(opts.TraceExporter))
		st.export = true
	}
	lw := resolveLangWatch(opts.LangWatch)
	if !opts.DisableLangWatchExporter && lw.APIKey != "" {
		exp, err := langwatch.NewExporter(ctx,
			langwatch.WithAPIKey(lw.APIKey),
			langwatch.WithEndpoint(lw.Endpoint),
			langwatch.WithProjectID(lw.ProjectID),
			langwatch.WithFilters(opts.Filters...),
		)
		if err != nil {
			st.err = err
		} else {
			processors = append(processors, sdktrace.NewBatchSpanProcessor(exp))
			st.export = true
		}
	}

	if existing, ok := otel.GetTracerProvider().(*sdktrace.TracerProvider); ok {
		for _, p := range processors {
			existing.RegisterSpanProcessor(p)
		}
		st.provider = existing
		return st
	}
	popts := make([]sdktrace.TracerProviderOption, 0, len(processors))
	for _, p := range processors {
		popts = append(popts, sdktrace.WithSpanProcessor(p))
	}
	st.provider = sdktrace.NewTracerProvider(popts...)
	st.owned = true
	otel.SetTracerProvider(st.provider)
	otel.SetTextMapPropagator(propagation.NewCompositeTextMapPropagator(propagation.TraceContext{}, propagation.Baggage{}))
	return st
}

// flush exports the spans of finished runs without shutting the provider
// down, so a test binary exiting right after a run loses nothing.
func (st *tracingState) flush(ctx context.Context) {
	if st.provider == nil || !st.export {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	if err := st.provider.ForceFlush(ctx); err != nil {
		logger().Warn("flushing scenario spans failed", "error", err.Error())
	}
}

// FlushTracing exports every finished span now. Run flushes after each run;
// call it before exiting a process that started spans of its own.
func FlushTracing(ctx context.Context) error {
	st := ensureTracing()
	if st.provider == nil {
		return nil
	}
	return st.provider.ForceFlush(ctx)
}

// ShutdownTracing flushes and stops the tracing the SDK installed. A provider
// the SDK attached to (owned by the application) is only flushed. Call it
// once, when no run is in progress.
func ShutdownTracing(ctx context.Context) error {
	st := ensureTracing()
	if st.provider == nil {
		return nil
	}
	if !st.owned {
		return st.provider.ForceFlush(ctx)
	}
	return st.provider.Shutdown(ctx)
}

// ScenarioOnly is a LangWatch exporter filter that keeps only the spans the
// scenario SDK starts.
func ScenarioOnly() langwatch.Filter {
	return langwatch.Include(langwatch.Criteria{ScopeName: []langwatch.Matcher{langwatch.Equals(TracerName)}})
}

// WithCustomScopes keeps the scenario SDK's spans plus the given
// instrumentation scopes.
func WithCustomScopes(scopes ...string) langwatch.Filter {
	m := make([]langwatch.Matcher, 0, len(scopes)+1)
	m = append(m, langwatch.Equals(TracerName))
	for _, s := range scopes {
		m = append(m, langwatch.Equals(s))
	}
	return langwatch.Include(langwatch.Criteria{ScopeName: m})
}

// propagationHeaders returns the W3C trace context of ctx as headers.
func propagationHeaders(ctx context.Context) map[string]string {
	carrier := propagation.MapCarrier{}
	if trace.SpanContextFromContext(ctx).IsValid() {
		propagation.TraceContext{}.Inject(ctx, carrier)
	}
	return carrier
}

// TraceIDFromHeaders returns the trace id of a traceparent header, or "".
func TraceIDFromHeaders(headers map[string]string) string {
	tp := headers["traceparent"]
	// version-traceid-spanid-flags
	if len(tp) < 55 || tp[2] != '-' || tp[35] != '-' {
		return ""
	}
	return tp[3:35]
}
