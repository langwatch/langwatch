// Package googlegenai is a LangWatch OpenTelemetry instrumentation for Google's
// unified Gen AI Go SDK, google.golang.org/genai, covering both the Gemini
// Developer API and Vertex AI backends.
//
// The genai client accepts an injectable *http.Client on its ClientConfig
// (the HTTPClient field, honored verbatim), so the instrumentation traces at the
// HTTP layer via the shared otelhttp base: it passes request and response bodies
// through to the caller byte-for-byte while capturing a bounded copy off the
// critical path for attribute extraction, then records gen_ai.* / langwatch.*
// attributes from Gemini's JSON wire shapes.
//
// Unlike OpenAI and Anthropic, the Gemini REST API encodes the model and the
// action in the URL path (".../models/{model}:generateContent"), not the request
// body. The model and gen_ai.operation.name are therefore derived from the path
// (via otelhttp.Config.OperationAttrs); the rest of the call — request params,
// input/output content, usage and finish reasons — is read from the body by the
// content extractor.
//
// Two entry points are provided:
//
//	// 1. WrapClientConfig — set the traced client on a genai ClientConfig in place.
//	cc := &genai.ClientConfig{APIKey: key}
//	googlegenai.WrapClientConfig(cc)
//	client, _ := genai.NewClient(ctx, cc)
//
//	// 2. NewTransport — get an http.RoundTripper to compose yourself.
//	cc := &genai.ClientConfig{
//	    APIKey:     key,
//	    HTTPClient: &http.Client{Transport: googlegenai.NewTransport()},
//	}
//	client, _ := genai.NewClient(ctx, cc)
package googlegenai

import (
	"net/http"

	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
	"google.golang.org/genai"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdk-go/instrumentation/googlegenai"
	instrumentationVersion = "0.0.1"
)

// extractors lists the shape extractors in priority order. The permissive
// generic fallback MUST be last so unknown Gemini endpoints still produce a
// useful span.
func extractors() []otelhttp.Extractor {
	return []otelhttp.Extractor{
		generateContentExtractor{},
		genericExtractor{},
	}
}

// NewTransport returns an http.RoundTripper that traces genai's HTTP calls to
// LangWatch. It wraps http.DefaultTransport; to chain a custom base transport,
// use NewTransportWithBase.
//
//	cc := &genai.ClientConfig{
//	    APIKey:     key,
//	    HTTPClient: &http.Client{Transport: googlegenai.NewTransport()},
//	}
//	client, _ := genai.NewClient(ctx, cc)
func NewTransport(opts ...Option) http.RoundTripper {
	return NewTransportWithBase(http.DefaultTransport, opts...)
}

// NewTransportWithBase returns an http.RoundTripper that traces genai's HTTP
// calls to LangWatch, chaining the given base round tripper. When base is nil,
// http.DefaultTransport is used. For the Vertex AI backend the base transport
// must perform the OAuth authentication genai's default client would otherwise
// add, so pass the authenticated transport here.
func NewTransportWithBase(base http.RoundTripper, opts ...Option) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return newTracer(opts...).RoundTripper(base)
}

// WrapClientConfig sets cc.HTTPClient to an *http.Client whose transport traces
// genai's HTTP calls to LangWatch. An existing cc.HTTPClient's transport is
// preserved as the base of the chain, so an already-customised client (timeouts,
// proxies, Vertex auth, …) keeps its transport underneath the tracing layer.
//
//	cc := &genai.ClientConfig{APIKey: key}
//	googlegenai.WrapClientConfig(cc)
//	client, _ := genai.NewClient(ctx, cc)
func WrapClientConfig(cc *genai.ClientConfig, opts ...Option) {
	if cc == nil {
		return
	}
	base := baseTransport(cc.HTTPClient)
	cc.HTTPClient = &http.Client{Transport: NewTransportWithBase(base, opts...)}
}

// baseTransport extracts a usable base round tripper from a genai ClientConfig's
// HTTPClient, so an already-customised *http.Client keeps its transport
// underneath the tracing layer.
func baseTransport(client *http.Client) http.RoundTripper {
	if client != nil && client.Transport != nil {
		return client.Transport
	}
	return http.DefaultTransport
}

// newTracer builds the otelhttp.Tracer that owns the span lifecycle, body
// pass-through and SSE reconstruction, configured with the googlegenai
// extractors and the path-based model/operation extraction.
func newTracer(opts ...Option) *otelhttp.Tracer {
	cfg := config{
		genAIProvider: semconv.GenAIProviderNameGCPGemini, // default to "gcp.gemini"
		dataCapture:   langwatch.DataCaptureAll,           // capture input + output by default
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
		OperationAttrs: func(req *http.Request) []attribute.KeyValue {
			return operationAttrs(req.URL.Path)
		},
	})
}
