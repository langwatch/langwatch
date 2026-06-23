package bedrock

import (
	"go.opentelemetry.io/otel/attribute"
	oteltrace "go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// config holds the resolved instrumentation options for the tracing middleware.
type config struct {
	tracerProvider oteltrace.TracerProvider
	// dataCapture gates whether the middleware records input and/or output
	// content at the source. It defaults to langwatch.DataCaptureAll.
	dataCapture langwatch.DataCaptureMode
	// genAIProvider is recorded as gen_ai.provider.name — the current GenAI
	// semantic convention that supersedes the removed gen_ai.system. It defaults
	// to semconv.GenAIProviderNameAWSBedrock ("aws.bedrock").
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
// the middleware captures both input and output.
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
// default it is set to semconv.GenAIProviderNameAWSBedrock ("aws.bedrock"). Pass
// a value from the OTel GenAI semconv or a custom provider key/value when, for
// example, you want to attribute by the underlying foundation-model vendor.
func WithGenAIProvider(provider attribute.KeyValue) Option {
	return optionFunc(func(c *config) {
		c.genAIProvider = provider
	})
}

// newConfig resolves the supplied options against the defaults.
func newConfig(opts ...Option) config {
	cfg := config{
		genAIProvider: defaultGenAIProvider,     // "aws.bedrock"
		dataCapture:   langwatch.DataCaptureAll, // capture input + output by default
	}
	for _, opt := range opts {
		opt.apply(&cfg)
	}
	return cfg
}
