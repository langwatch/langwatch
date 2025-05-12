package otelopenai

import (
	"go.opentelemetry.io/otel/propagation"
	oteltrace "go.opentelemetry.io/otel/trace"
)

// config is used to configure the middleware.
type config struct {
	tracerProvider                oteltrace.TracerProvider
	propagators                   propagation.TextMapPropagator
	traceIDResponseHeaderKey      string
	traceSampledResponseHeaderKey string
	recordInput                   bool
	recordOutput                  bool
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

// WithPropagators specifies propagators to use for extracting
// information from the HTTP requests. If none are specified, global
// ones will be used.
func WithPropagators(propagators propagation.TextMapPropagator) Option {
	return optionFunc(func(c *config) {
		c.propagators = propagators
	})
}

// WithCaptureInput enables recording the full request body content
// under the `langwatch.input.value` attribute.
// Be cautious with sensitive data.
func WithCaptureInput() Option {
	return optionFunc(func(c *config) {
		c.recordInput = true
	})
}

// WithCaptureOutput enables recording the full response body content
// (or accumulated stream content, if middleware could parse it)
// under the `langwatch.output.value` attribute.
// Be cautious with sensitive data.
func WithCaptureOutput() Option {
	return optionFunc(func(c *config) {
		c.recordOutput = true
	})
}
