// Package gopenai is a LangWatch OpenTelemetry instrumentation for the popular
// community OpenAI Go client github.com/sashabaranov/go-openai.
//
// go-openai exposes an injectable HTTP client on its config (the HTTPClient
// field, typed as the HTTPDoer interface that *http.Client satisfies), so the
// instrumentation traces at the HTTP layer via the shared otelhttp base: it
// passes request and response bodies through to the caller byte-for-byte while
// capturing a bounded copy off the critical path for attribute extraction, then
// records gen_ai.* / langwatch.* attributes from OpenAI's JSON wire shapes.
//
// Two entry points are provided:
//
//	// 1. WrapConfig — set the traced client on a go-openai config in place.
//	config := openai.DefaultConfig(token)
//	gopenai.WrapConfig(&config)
//	client := openai.NewClientWithConfig(config)
//
//	// 2. NewTransport — get an http.RoundTripper to compose yourself.
//	config := openai.DefaultConfig(token)
//	config.HTTPClient = &http.Client{Transport: gopenai.NewTransport()}
//	client := openai.NewClientWithConfig(config)
//
// Because go-openai is widely used against OpenAI-compatible providers (Groq,
// Together, Fireworks, Ollama, …), the gen_ai.provider.name defaults to "openai"
// but is overridable with WithGenAIProvider.
package gopenai

import (
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
	openai "github.com/sashabaranov/go-openai"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdk-go/instrumentation/gopenai"
	instrumentationVersion = "0.0.1"
)

// extractors lists the shape extractors in priority order. The permissive
// generic fallback MUST be last so unknown OpenAI-compatible endpoints still
// produce a useful span.
func extractors() []otelhttp.Extractor {
	return []otelhttp.Extractor{
		chatExtractor{},
		embeddingsExtractor{},
		genericExtractor{},
	}
}

// NewTransport returns an http.RoundTripper that traces go-openai's HTTP calls
// to LangWatch. It wraps http.DefaultTransport; to chain a custom base
// transport, use NewTransportWithBase.
//
//	config := openai.DefaultConfig(token)
//	config.HTTPClient = &http.Client{Transport: gopenai.NewTransport()}
//	client := openai.NewClientWithConfig(config)
func NewTransport(opts ...Option) http.RoundTripper {
	return NewTransportWithBase(http.DefaultTransport, opts...)
}

// NewTransportWithBase returns an http.RoundTripper that traces go-openai's HTTP
// calls to LangWatch, chaining the given base round tripper. When base is nil,
// http.DefaultTransport is used.
func NewTransportWithBase(base http.RoundTripper, opts ...Option) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return newTracer(opts...).RoundTripper(base)
}

// WrapConfig sets cfg.HTTPClient to an *http.Client whose transport traces
// go-openai's HTTP calls to LangWatch. An existing cfg.HTTPClient's transport is
// preserved as the base of the chain when it is an *http.Client; otherwise the
// traced client wraps http.DefaultTransport.
//
//	config := openai.DefaultConfig(token)
//	gopenai.WrapConfig(&config)
//	client := openai.NewClientWithConfig(config)
func WrapConfig(cfg *openai.ClientConfig, opts ...Option) {
	if cfg == nil {
		return
	}
	base := baseTransport(cfg.HTTPClient)
	cfg.HTTPClient = &http.Client{Transport: NewTransportWithBase(base, opts...)}
}

// baseTransport extracts a usable base round tripper from go-openai's configured
// HTTPDoer, so an already-customised *http.Client keeps its transport (timeouts,
// proxies, …) underneath the tracing layer.
func baseTransport(doer openai.HTTPDoer) http.RoundTripper {
	if client, ok := doer.(*http.Client); ok && client != nil && client.Transport != nil {
		return client.Transport
	}
	return http.DefaultTransport
}

// newTracer builds the otelhttp.Tracer that owns the span lifecycle, body
// pass-through and SSE reconstruction, configured with the gopenai extractors.
func newTracer(opts ...Option) *otelhttp.Tracer {
	cfg := config{
		genAIProvider: semconv.GenAIProviderNameOpenAI, // default to "openai"
		dataCapture:   langwatch.DataCaptureAll,        // capture input + output by default
	}
	for _, opt := range opts {
		opt.apply(&cfg)
	}

	return otelhttp.New(otelhttp.Config{
		TracerName:     tracerName,
		TracerVersion:  instrumentationVersion,
		Provider:       cfg.genAIProvider,
		DataCapture:    cfg.dataCapture,
		TracerProvider: cfg.tracerProvider,
		Extractors:     extractors(),
		OperationAttrs: operationAttrs,
	})
}

// operationAttrs derives gen_ai.operation.name from the request URL path, the
// same mapping the openai instrumentation uses.
func operationAttrs(req *http.Request) []attribute.KeyValue {
	return []attribute.KeyValue{genAIOperationFromPath(req.URL.Path)}
}
