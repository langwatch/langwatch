package scenario

import (
	"context"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// langwatchSDKAttributes are the attributes langwatch.Tracer appends after
// the caller's on every span it starts. The executor starts its spans on the
// OpenTelemetry tracer directly and puts these at the same place itself, so
// the span carries the same attributes in the same order (which the judge's
// span digest renders) while the start takes one attribute list instead of
// three SetAttributes calls. TestSpanStarterMatchesLangWatchTracer pins the
// equivalence against the LangWatch tracer.
var langwatchSDKAttributes = [...]attribute.KeyValue{
	langwatch.AttributeLangWatchSDKName.String("langwatch-sdk-go"),
	langwatch.AttributeLangWatchSDKLanguage.String("go"),
	langwatch.AttributeLangWatchSDKVersion.String(langwatch.Version),
}

// agentSpanType is the langwatch.span.type of an agent call span.
var agentSpanType = langwatch.AttributeLangWatchSpanType.String(string(langwatch.SpanTypeAgent))

// spanStarter starts the executor's spans (run, turn, agent call) under the
// SDK's instrumentation scope, with the full attribute list at start.
type spanStarter struct {
	tracer trace.Tracer
}

// newSpanStarter resolves the tracer from the global provider, as
// langwatch.Tracer does.
func newSpanStarter() spanStarter {
	return spanStarter{tracer: otel.GetTracerProvider().Tracer(TracerName, trace.WithInstrumentationVersion(Version))}
}

// start starts a span with attrs, which must already hold the LangWatch SDK
// attributes (see the *SpanAttributes builders).
func (s spanStarter) start(ctx context.Context, name string, attrs []attribute.KeyValue) (context.Context, *langwatch.Span) {
	ctx, span := s.tracer.Start(ctx, name, trace.WithAttributes(attrs...))
	return ctx, &langwatch.Span{Span: span}
}

// runSpanAttributes are the attributes of the "Scenario Run" span. With
// turn >= 0 they are those of a "Scenario Turn" span (with scenario.turn).
func runSpanAttributes(runID string, cfg ScenarioConfig, turn int) []attribute.KeyValue {
	attrs := make([]attribute.KeyValue, 0, 11)
	attrs = append(attrs,
		attribute.String("langwatch.origin", "simulation"),
		sdkAttributes[0], sdkAttributes[1],
		attribute.String("scenario.run_id", runID),
		attribute.String("scenario.name", cfg.Name),
		attribute.String("scenario.id", cfg.ID),
		attribute.String(threadIDKey, cfg.ThreadID),
	)
	if turn >= 0 {
		attrs = append(attrs, attribute.Int("scenario.turn", turn))
	}
	return append(attrs, langwatchSDKAttributes[:]...)
}

// agentSpanAttributes are the attributes of an agent call span: thread and
// role, the LangWatch SDK attributes, the span type, and the input when
// withInput is set. This is the order the attributes had when the span was
// started on langwatch.Tracer and the type and input set right after.
func agentSpanAttributes(threadID string, role AgentRole, input string, withInput bool) []attribute.KeyValue {
	attrs := make([]attribute.KeyValue, 0, 7)
	attrs = append(attrs,
		attribute.String(threadIDKey, threadID),
		attribute.String("scenario.role", string(role)),
	)
	attrs = append(attrs, langwatchSDKAttributes[:]...)
	attrs = append(attrs, agentSpanType)
	if withInput {
		attrs = append(attrs, langwatch.AttributeLangWatchInput.String(input))
	}
	return attrs
}
