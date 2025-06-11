package openai

import (
	"log/slog"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openai/events"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/log"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/trace"
)

// Config holds configuration for OpenAI instrumentation
type Config struct {
	genAISystemName     string
	contentRecordPolicy events.RecordPolicy
}

// config is used to configure the middleware.
type config struct {
	tracerProvider                trace.TracerProvider
	loggerProvider                log.LoggerProvider
	propagators                   propagation.TextMapPropagator
	traceIDResponseHeaderKey      string
	traceSampledResponseHeaderKey string
	genAISystem                   attribute.KeyValue

	contentRecordPolicy events.RecordPolicy

	tracer langwatch.LangWatchTracer
	logger log.Logger

	// caller can inject their own for more control
	slogger *slog.Logger
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
func WithTracerProvider(provider trace.TracerProvider) Option {
	return optionFunc(func(c *config) {
		c.tracerProvider = provider
	})
}

// WithLoggerProvider specifies a logger provider to use for creating a logger.
// If none is specified, the global provider is used.
func WithLoggerProvider(provider log.LoggerProvider) Option {
	return optionFunc(func(c *config) {
		c.loggerProvider = provider
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

// WithCaptureAllInput enables recording of all input content.
func WithCaptureAllInput() Option {
	return optionFunc(func(c *config) {
		if c.contentRecordPolicy == nil {
			c.contentRecordPolicy = events.NewProtectedContentRecordPolicy()
		}
		c.contentRecordPolicy.SetRecordSystemInputContent(true)
		c.contentRecordPolicy.SetRecordUserInputContent(true)
	})
}

// WithCaptureSystemInput enables recording of system and developer input.
func WithCaptureSystemInput() Option {
	return optionFunc(func(c *config) {
		if c.contentRecordPolicy == nil {
			c.contentRecordPolicy = events.NewProtectedContentRecordPolicy()
		}
		c.contentRecordPolicy.SetRecordSystemInputContent(true)
	})
}

// WithCaptureUserInput enables recording of user input.
func WithCaptureUserInput() Option {
	return optionFunc(func(c *config) {
		if c.contentRecordPolicy == nil {
			c.contentRecordPolicy = events.NewProtectedContentRecordPolicy()
		}
		c.contentRecordPolicy.SetRecordUserInputContent(true)
	})
}

// WithCaptureOutput enables recording of the full response body content.
func WithCaptureOutput() Option {
	return optionFunc(func(c *config) {
		if c.contentRecordPolicy == nil {
			c.contentRecordPolicy = events.NewProtectedContentRecordPolicy()
		}
		c.contentRecordPolicy.SetRecordOutputContent(true)
	})
}

// WithGenAISystem sets the gen_ai.system attribute on the span. By
// default, it is set to "openai".
func WithGenAISystem(system attribute.KeyValue) Option {
	return optionFunc(func(c *config) {
		c.genAISystem = system
	})
}

// WithLogger specifies a structured logger to use for logging.
// If none is specified, a zero-noise default (discard) logger is used.
// The logger should be configured by the caller with appropriate levels and outputs.
func WithLogger(logger *slog.Logger) Option {
	return optionFunc(func(c *config) {
		c.slogger = logger
	})
}
