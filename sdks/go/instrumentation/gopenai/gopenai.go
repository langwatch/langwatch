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
	semconv "go.opentelemetry.io/otel/semconv/v1.41.0"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/langwatch/langwatch/sdks/go/instrumentation/openaiformat"
	"github.com/langwatch/langwatch/sdks/go/instrumentation/otelhttp"
	openai "github.com/sashabaranov/go-openai"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdks/go/instrumentation/gopenai"
	instrumentationVersion = "0.0.1"
)

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
// go-openai's HTTP calls to LangWatch. The caller's configuration is preserved:
// an existing *http.Client keeps its Timeout, CheckRedirect and Jar, and its
// transport becomes the base of the tracing chain; a caller-supplied HTTPDoer
// that is not an *http.Client is adapted into the chain rather than dropped, so
// its behaviour (retries, auth, circuit breaking, …) still runs underneath the
// tracing layer.
//
//	config := openai.DefaultConfig(token)
//	gopenai.WrapConfig(&config)
//	client := openai.NewClientWithConfig(config)
func WrapConfig(cfg *openai.ClientConfig, opts ...Option) {
	if cfg == nil {
		return
	}
	traced := tracedClient(cfg.HTTPClient)
	traced.Transport = NewTransportWithBase(traced.Transport, opts...)
	cfg.HTTPClient = traced
}

// tracedClient returns the *http.Client to install on the config, carrying over
// every field of an already-customised *http.Client (Timeout lives on the
// client, not on its Transport, so rebuilding a bare client would silently drop
// it). Its Transport field is the base for the tracing chain.
func tracedClient(doer openai.HTTPDoer) *http.Client {
	if client, ok := doer.(*http.Client); ok {
		if client == nil {
			return &http.Client{Transport: http.DefaultTransport}
		}
		copied := *client
		if copied.Transport == nil {
			copied.Transport = http.DefaultTransport
		}
		return &copied
	}
	return &http.Client{Transport: doerTransport(doer)}
}

// doerTransport adapts a non-*http.Client HTTPDoer into an http.RoundTripper so
// a custom doer stays in the chain underneath the tracing layer. A nil doer
// falls back to http.DefaultTransport.
func doerTransport(doer openai.HTTPDoer) http.RoundTripper {
	if doer == nil {
		return http.DefaultTransport
	}
	return doerRoundTripper{doer: doer}
}

// doerRoundTripper bridges go-openai's HTTPDoer onto http.RoundTripper. The
// contracts are identical in shape (Do and RoundTrip both take a *http.Request
// and return a *http.Response), so the call is a straight delegation.
type doerRoundTripper struct{ doer openai.HTTPDoer }

func (d doerRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	return d.doer.Do(req)
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
		Extractors:     openaiformat.Extractors(),
		OperationAttrs: operationAttrs,
	})
}

// operationAttrs derives gen_ai.operation.name from the request URL path via the
// shared OpenAI-format mapper, so go-openai and the official client agree.
func operationAttrs(req *http.Request) []attribute.KeyValue {
	return openaiformat.OperationAttrs(req.URL.Path)
}
