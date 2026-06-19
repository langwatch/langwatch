// Package ollama is a LangWatch OpenTelemetry instrumentation for the official
// Ollama Go client github.com/ollama/ollama/api, covering its NATIVE /api/*
// endpoints (/api/chat, /api/generate, /api/embed, /api/embeddings). The
// OpenAI-compatibility shim Ollama also serves under /v1/* is already covered by
// the openai and gopenai instrumentations and is out of scope here.
//
// The Ollama client takes its *http.Client at construction
// (api.NewClient(base, httpClient), and api.ClientFromEnvironment() uses
// http.DefaultClient), so the instrumentation traces at the HTTP layer via the
// shared otelhttp base: it passes request and response bodies through to the
// caller byte-for-byte while capturing a bounded copy off the critical path for
// attribute extraction, then records gen_ai.* / langwatch.* attributes from
// Ollama's JSON wire shapes.
//
// Ollama's /api/chat and /api/generate stream their responses as newline-
// delimited JSON (Content-Type application/x-ndjson): each line is a partial
// response and the final line carries done:true together with the token counts
// (prompt_eval_count / eval_count) and done_reason. A non-streamed call
// (stream:false in the request) returns a single application/json object
// instead. The base is configured with StreamContentType "application/x-ndjson"
// and FramingNDJSON so it reconstructs the streamed shape line-by-line and ends
// on EOF (NDJSON has no [DONE] sentinel).
//
// Two entry points are provided:
//
//	// 1. NewHTTPClient — a ready *http.Client to pass to api.NewClient.
//	client := ollama.NewHTTPClient()
//	oc := api.NewClient(baseURL, client)
//
//	// 2. NewTransport — an http.RoundTripper to compose yourself.
//	client := &http.Client{Transport: ollama.NewTransport()}
//	oc := api.NewClient(baseURL, client)
//
// Ollama has no constant in the OTel GenAI semantic conventions, so
// gen_ai.provider.name defaults to "ollama"; override it with WithGenAIProvider
// when pointing the client at a different backend.
package ollama

import (
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdk-go/instrumentation/ollama"
	instrumentationVersion = "0.0.1"

	// streamContentType is the Content-Type the Ollama server sends for a
	// streamed (NDJSON) response. A non-streamed call returns application/json.
	streamContentType = "application/x-ndjson"
)

// extractors lists the shape extractors in priority order. The permissive
// generic fallback MUST be last so unknown /api/* endpoints still produce a
// useful span.
func extractors() []otelhttp.Extractor {
	return []otelhttp.Extractor{
		chatExtractor{},
		generateExtractor{},
		embeddingsExtractor{},
		genericExtractor{},
	}
}

// NewTransport returns an http.RoundTripper that traces the Ollama client's HTTP
// calls to LangWatch. It wraps http.DefaultTransport; to chain a custom base
// transport, use NewTransportWithBase.
//
//	client := &http.Client{Transport: ollama.NewTransport()}
//	oc := api.NewClient(baseURL, client)
func NewTransport(opts ...Option) http.RoundTripper {
	return NewTransportWithBase(http.DefaultTransport, opts...)
}

// NewTransportWithBase returns an http.RoundTripper that traces the Ollama
// client's HTTP calls to LangWatch, chaining the given base round tripper. When
// base is nil, http.DefaultTransport is used.
func NewTransportWithBase(base http.RoundTripper, opts ...Option) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return newTracer(opts...).RoundTripper(base)
}

// NewHTTPClient returns an *http.Client whose transport traces the Ollama
// client's HTTP calls to LangWatch, ready to pass to api.NewClient. It wraps
// http.DefaultTransport.
//
//	oc := api.NewClient(baseURL, ollama.NewHTTPClient())
func NewHTTPClient(opts ...Option) *http.Client {
	return &http.Client{Transport: NewTransport(opts...)}
}

// WrapHTTPClient returns a copy of client whose transport traces the Ollama
// client's HTTP calls to LangWatch, preserving the original client's settings
// (timeout, cookie jar, redirect policy) and chaining its transport as the base
// of the tracing chain. When client is nil, it behaves like NewHTTPClient.
//
//	base := &http.Client{Timeout: 30 * time.Second}
//	oc := api.NewClient(baseURL, ollama.WrapHTTPClient(base))
func WrapHTTPClient(client *http.Client, opts ...Option) *http.Client {
	if client == nil {
		return NewHTTPClient(opts...)
	}
	wrapped := *client
	wrapped.Transport = NewTransportWithBase(client.Transport, opts...)
	return &wrapped
}

// newTracer builds the otelhttp.Tracer that owns the span lifecycle, body
// pass-through and NDJSON reconstruction, configured with the ollama extractors.
func newTracer(opts ...Option) *otelhttp.Tracer {
	cfg := config{
		genAIProvider: defaultProvider, // default to "ollama"
		dataCapture:   langwatch.DataCaptureAll,
	}
	for _, opt := range opts {
		opt.apply(&cfg)
	}

	return otelhttp.New(otelhttp.Config{
		TracerName:        tracerName,
		TracerVersion:     instrumentationVersion,
		Provider:          cfg.genAIProvider,
		DataCapture:       cfg.dataCapture,
		TracerProvider:    cfg.tracerProvider,
		Extractors:        extractors(),
		OperationAttrs:    operationAttrs,
		StreamContentType: streamContentType,
		Framing:           otelhttp.FramingNDJSON,
	})
}

// defaultProvider is the gen_ai.provider.name recorded when WithGenAIProvider is
// not set. The OTel GenAI semconv has no Ollama constant, so we set "ollama"
// directly.
var defaultProvider = semconv.GenAIProviderNameKey.String("ollama")

// operationAttrs derives gen_ai.operation.name from the request URL path.
func operationAttrs(req *http.Request) []attribute.KeyValue {
	return []attribute.KeyValue{genAIOperationFromPath(req.URL.Path)}
}
