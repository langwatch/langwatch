package googlegenai

import (
	"go.opentelemetry.io/otel/attribute"
	oteltrace "go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// config holds the resolved options for a traced transport. It mirrors the
// shape of instrumentation/gopenai's config so the Go instrumentations expose
// the same knobs.
type config struct {
	// tracerProvider supplies the tracer; defaults to the global provider.
	tracerProvider oteltrace.TracerProvider
	// dataCapture gates whether the transport records input and/or output
	// content at the source. It defaults to langwatch.DataCaptureAll.
	dataCapture langwatch.DataCaptureMode
	// genAIProvider is recorded as gen_ai.provider.name — the current GenAI
	// semantic convention that supersedes the removed gen_ai.system.
	genAIProvider attribute.KeyValue
}

// Option configures a traced transport (NewTransport / WrapClientConfig).
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

// WithDataCapture controls whether the transport records request (input) and
// response (output) content on the span. The mode gates recording at the
// source: input content is only recorded when mode.CaptureInput() is true, and
// output content only when mode.CaptureOutput() is true. Span structure,
// metrics, models, usage and identity are always recorded.
//
// The default, when this option is not passed, is langwatch.DataCaptureAll —
// the transport captures both input and output.
//
// For cross-cutting control across every instrumentation, prefer the exporter
// option langwatch.WithDataCapture(...): the two compose — the transport gates
// at the source and the exporter strips content at export time.
func WithDataCapture(mode langwatch.DataCaptureMode) Option {
	return optionFunc(func(c *config) {
		c.dataCapture = mode
	})
}

// WithGenAIProvider sets the gen_ai.provider.name attribute on the span. By
// default it is set to "gcp.gemini" (semconv.GenAIProviderNameGCPGemini), which
// covers both the Gemini Developer API and Vertex AI backends of the unified
// google.golang.org/genai SDK. Pass a custom provider key/value when pointing
// the client at a Gemini-compatible gateway.
func WithGenAIProvider(provider attribute.KeyValue) Option {
	return optionFunc(func(c *config) {
		c.genAIProvider = provider
	})
}
