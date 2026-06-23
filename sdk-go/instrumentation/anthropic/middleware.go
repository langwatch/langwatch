// Package anthropic provides OpenTelemetry instrumentation for the official
// Anthropic Go SDK (github.com/anthropics/anthropic-sdk-go).
//
// It wires a Stainless option.Middleware that traces every call the client
// makes, recording gen_ai.* / langwatch.* attributes for the Messages API
// (/v1/messages) — both buffered and streamed — via the shared otelhttp base.
// The base owns the span lifecycle, the byte-exact body pass-through and the
// SSE reconstruction; this package owns only the Anthropic wire-shape mapping.
package anthropic

import (
	"net/http"

	"github.com/anthropics/anthropic-sdk-go/option"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

const (
	tracerName             = "github.com/langwatch/langwatch/sdk-go/instrumentation/anthropic"
	instrumentationVersion = "0.0.1"
)

// Middleware returns a Stainless option.Middleware that traces requests made by
// the Anthropic Go client. Wire it when constructing the client:
//
//	client := anthropic.NewClient(
//	    option.WithAPIKey(os.Getenv("ANTHROPIC_API_KEY")),
//	    option.WithMiddleware(otelanthropic.Middleware()),
//	)
//
// By default the middleware records both request (input) and response (output)
// content and sets gen_ai.provider.name to "anthropic". Use the options to
// narrow capture, override the provider, or pin the tracer provider.
func Middleware(opts ...Option) option.Middleware {
	cfg := config{
		genAIProvider: semconv.GenAIProviderNameAnthropic, // Default to "anthropic".
		dataCapture:   langwatch.DataCaptureAll,           // Capture input + output by default.
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
		Extractors:     []otelhttp.Extractor{messagesExtractor{}},
		OperationAttrs: operationAttrs,
	})

	return func(req *http.Request, next option.MiddlewareNext) (*http.Response, error) {
		return tr.Handle(req, next)
	}
}

// operationAttrs derives gen_ai.operation.name from the Anthropic endpoint. The
// Messages API is a chat operation; everything else is named after its path
// segment so unknown endpoints still carry a useful operation attribute.
func operationAttrs(req *http.Request) []attribute.KeyValue {
	if isMessagesPath(req.URL.Path) {
		return []attribute.KeyValue{semconv.GenAIOperationNameChat}
	}
	return nil
}
