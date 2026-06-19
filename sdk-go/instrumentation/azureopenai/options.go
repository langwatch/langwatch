package azureopenai

import (
	oteltrace "go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
)

// WithTracerProvider specifies the OTel TracerProvider used to create the
// tracer. If none is specified, the global provider is used. It is a
// pass-through to the OpenAI instrumentation's option of the same name.
func WithTracerProvider(provider oteltrace.TracerProvider) Option {
	return otelopenai.WithTracerProvider(provider)
}

// WithDataCapture controls whether request (input) and response (output)
// content is recorded on the span. It defaults to langwatch.DataCaptureAll. It
// is a pass-through to the OpenAI instrumentation's option of the same name.
func WithDataCapture(mode langwatch.DataCaptureMode) Option {
	return otelopenai.WithDataCapture(mode)
}
