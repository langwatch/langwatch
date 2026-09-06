package openai

import (
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"
	oteltrace "go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdks/go"
)

type config struct {
	tracerProvider oteltrace.TracerProvider
	// dataCapture gates whether the middleware records input and/or output
	// content at the source. It defaults to langwatch.DataCaptureAll.
	dataCapture langwatch.DataCaptureMode
	// genAIProvider is recorded as gen_ai.provider.name — the current GenAI
	// semantic convention that supersedes the removed gen_ai.system.
	genAIProvider attribute.KeyValue
}

// Option specifies instrumentation configuration options.
type Option interface {
	apply(*config)
}

type optionFunc func(*config)

func (o optionFunc) apply(c *config) {
	o(c)
}

// WithTracerProvider specifies a tracer provider to use for creating a tracer.
// If none is specified, the global provider is used.
func WithTracerProvider(provider oteltrace.TracerProvider) Option {
	return optionFunc(func(c *config) {
		c.tracerProvider = provider
	})
}

// WithDataCapture controls whether the middleware records request (input) and
// response (output) content on the span. The mode gates recording at the
// source: input content is only recorded when mode.CaptureInput() is true, and
// output content only when mode.CaptureOutput() is true. Span structure,
// metrics, models, usage and identity are always recorded.
//
// The default, when this option is not passed, is langwatch.DataCaptureAll —
// the middleware captures both input and output. This is a deliberate breaking
// change from the previous opt-in WithCaptureInput()/WithCaptureOutput().
//
// For cross-cutting control across every instrumentation, prefer the exporter
// option langwatch.WithDataCapture(...): the two compose — the middleware gates
// at the source and the exporter strips content at export time.
func WithDataCapture(mode langwatch.DataCaptureMode) Option {
	return optionFunc(func(c *config) {
		c.dataCapture = mode
	})
}

// WithGenAIProvider sets the gen_ai.provider.name attribute on the span. By
// default it is set to "openai". Pass a value from the OTel GenAI semconv
// (e.g. semconv.GenAIProviderNameOpenAI) or a custom provider key/value.
func WithGenAIProvider(provider attribute.KeyValue) Option {
	return optionFunc(func(c *config) {
		c.genAIProvider = provider
	})
}

// WithGenAISystem sets the GenAI provider on the span. Only the value of the
// argument is used: it is re-keyed onto gen_ai.provider.name, so passing the old
// semconv.GenAISystemKey.String("openai") still records the current attribute
// rather than emitting the removed gen_ai.system key.
//
// Deprecated: gen_ai.system was removed from the GenAI semantic conventions in
// favour of gen_ai.provider.name. Use WithGenAIProvider; this alias forwards to
// it for backwards compatibility.
func WithGenAISystem(system attribute.KeyValue) Option {
	return WithGenAIProvider(semconv.GenAIProviderNameKey.String(system.Value.Emit()))
}
