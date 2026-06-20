// Package openai provides OpenTelemetry instrumentation for the official OpenAI
// Go SDK (github.com/openai/openai-go).
//
// It wires a Stainless option.Middleware that traces every call the client
// makes, recording gen_ai.* / langwatch.* attributes for chat completions, the
// Responses API and embeddings — both buffered and streamed — via the shared
// otelhttp base. The base owns the span lifecycle, the byte-exact body
// pass-through and the SSE reconstruction; the OpenAI wire-shape mapping lives in
// the shared, dependency-free openaiformat package (the same extractors the
// gopenai instrumentation uses), so both OpenAI clients produce identical spans.
package openai

import (
	"net/http"

	oaioption "github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/openaiformat"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
	instrumentationVersion = "0.0.1"
)

// Middleware sets up a handler to start tracing the requests made to OpenAI by
// the OpenAI library. It dispatches by request/response *shape* rather than by
// URL path, so it traces chat completions, the Responses API, embeddings and any
// other OpenAI-compatible endpoint uniformly.
//
// Tracing is designed to add negligible latency and memory: the response body is
// never pre-buffered or restored — it is passed through to the caller while a
// bounded copy is captured for attribute extraction, and parsing happens off the
// request/response critical path once the body is drained.
//
// The name argument is the client identifier; it is retained for API
// compatibility (the tracer scope is the instrumentation name, as before).
func Middleware(name string, opts ...Option) oaioption.Middleware {
	cfg := config{
		genAIProvider: semconv.GenAIProviderNameOpenAI, // Default to "openai"
		dataCapture:   langwatch.DataCaptureAll,        // Capture input + output by default
	}
	for _, opt := range opts {
		opt.apply(&cfg)
	}

	tr := otelhttp.New(otelhttp.Config{
		TracerName:     tracerName,
		TracerVersion:  instrumentationVersion,
		Provider:       cfg.genAIProvider,
		DataCapture:    cfg.dataCapture,
		TracerProvider: cfg.tracerProvider,
		Extractors:     openaiformat.Extractors(),
		OperationAttrs: func(req *http.Request) []attribute.KeyValue {
			return openaiformat.OperationAttrs(req.URL.Path)
		},
	})

	return func(req *http.Request, next oaioption.MiddlewareNext) (*http.Response, error) {
		return tr.Handle(req, next)
	}
}
