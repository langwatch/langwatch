// Package genkit wires Firebase Genkit's OpenTelemetry traces to LangWatch.
//
// Genkit is OTEL-native: it emits its own gen_ai.* spans for flows, models and
// tools onto the global OpenTelemetry tracer provider. This package therefore
// does no body parsing — it builds a LangWatch span exporter, wraps it in a
// batching span processor, and registers that processor on the same tracer
// provider Genkit's spans flow through. Whatever gen_ai.* attributes Genkit
// records (model, token usage, prompts/completions, tool calls, …) are exported
// to LangWatch as-is; the data captured is exactly what Genkit emits.
//
// Typical usage:
//
//	g := genkit.Init(ctx, genkit.WithPlugins(&googlegenai.GoogleAI{}))
//	if err := lwgenkit.RegisterLangWatch(g); err != nil {
//		log.Fatal(err)
//	}
//
// RegisterLangWatch reads LANGWATCH_API_KEY (and LANGWATCH_ENDPOINT) from the
// environment by default; pass WithExporterOptions to configure them in code.
package genkit

import (
	"context"

	"github.com/firebase/genkit/go/core/tracing"
	"github.com/firebase/genkit/go/genkit"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// config holds the resolved options for registering LangWatch with Genkit.
type config struct {
	// ctx is passed to langwatch.NewExporter when building the default
	// processor. Defaults to context.Background().
	ctx context.Context
	// exporterOpts are forwarded to langwatch.NewExporter (API key, endpoint,
	// data-capture mode, filters, …).
	exporterOpts []langwatch.ExporterOption
	// processor, when set, is registered as-is instead of building a batching
	// processor around a LangWatch exporter.
	processor sdktrace.SpanProcessor
}

// Option configures RegisterLangWatch / SpanProcessor.
type Option interface {
	apply(*config)
}

type optionFunc func(*config)

func (o optionFunc) apply(c *config) { o(c) }

// WithContext sets the context used when constructing the LangWatch exporter
// (it governs the exporter's OTLP client setup). Defaults to
// context.Background(). Ignored when WithSpanProcessor is supplied.
func WithContext(ctx context.Context) Option {
	return optionFunc(func(c *config) {
		c.ctx = ctx
	})
}

// WithExporterOptions forwards options to langwatch.NewExporter — for example
// langwatch.WithAPIKey, langwatch.WithEndpoint, langwatch.WithDataCapture and
// langwatch.WithFilters. When omitted, the exporter is configured from the
// environment (LANGWATCH_API_KEY, LANGWATCH_ENDPOINT). Ignored when
// WithSpanProcessor is supplied.
func WithExporterOptions(opts ...langwatch.ExporterOption) Option {
	return optionFunc(func(c *config) {
		c.exporterOpts = append(c.exporterOpts, opts...)
	})
}

// WithSpanProcessor registers the given span processor directly instead of
// building a batching processor around a LangWatch exporter. Use this to supply
// a custom processor (e.g. a SimpleSpanProcessor in tests, or one wrapping a
// pre-built exporter). When set, WithContext and WithExporterOptions are
// ignored.
func WithSpanProcessor(sp sdktrace.SpanProcessor) Option {
	return optionFunc(func(c *config) {
		c.processor = sp
	})
}

// resolve applies options over the defaults.
func resolve(opts ...Option) *config {
	c := &config{ctx: context.Background()}
	for _, opt := range opts {
		opt.apply(c)
	}
	return c
}

// SpanProcessor builds the span processor that exports Genkit's OTEL spans to
// LangWatch, without registering it. Callers who manage their own tracer
// provider can register the returned processor themselves via
// sdktrace.WithSpanProcessor or TracerProvider.RegisterSpanProcessor.
//
// By default it constructs a langwatch.NewExporter (configured from the
// environment or via WithExporterOptions) wrapped in a
// sdktrace.NewBatchSpanProcessor. When WithSpanProcessor is supplied, that
// processor is returned unchanged.
func SpanProcessor(opts ...Option) (sdktrace.SpanProcessor, error) {
	c := resolve(opts...)
	if c.processor != nil {
		return c.processor, nil
	}
	exporter, err := langwatch.NewExporter(c.ctx, c.exporterOpts...)
	if err != nil {
		return nil, err
	}
	return sdktrace.NewBatchSpanProcessor(exporter), nil
}

// RegisterLangWatch registers a LangWatch span processor on the OpenTelemetry
// tracer provider that Genkit emits its spans onto, so Genkit's flow, model and
// tool spans (and the gen_ai.* attributes they carry) are exported to
// LangWatch.
//
// The Genkit instance g is accepted for API stability and to make the call read
// naturally at the Genkit setup site; registration targets the tracer provider
// Genkit uses (the global OpenTelemetry provider), which is shared by every
// *genkit.Genkit. Call this once after genkit.Init.
//
// By default the exporter is configured from the environment
// (LANGWATCH_API_KEY, LANGWATCH_ENDPOINT). Use WithExporterOptions to configure
// it in code, WithContext to control the exporter's setup context, or
// WithSpanProcessor to register a custom processor.
func RegisterLangWatch(g *genkit.Genkit, opts ...Option) error {
	sp, err := SpanProcessor(opts...)
	if err != nil {
		return err
	}
	tracing.TracerProvider().RegisterSpanProcessor(sp)
	return nil
}
