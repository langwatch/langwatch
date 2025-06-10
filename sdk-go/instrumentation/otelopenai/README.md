# otelopenai

This package provides OpenTelemetry instrumentation middleware for the official `openai-go` client library (`github.com/openai/openai-go`).

It automatically creates client spans for OpenAI API calls made through the instrumented client, adding relevant request and response attributes according to OpenTelemetry GenAI semantic conventions.

## Installation

```bash
go get github.com/langwatch/go-sdk/instrumentation/otelopenai
```

## Usage

Wrap the `otelopenai.Middleware` using `option.WithMiddleware` when creating the `openai.Client`:

```go
package main

import (
	"context"
	"log"

	"github.com/langwatch/go-sdk/instrumentation/otelopenai"
	"github.com/openai/openai-go"
	oaioption "github.com/openai/openai-go/option"
	"go.opentelemetry.io/otel"
)

func main() {
	ctx := context.Background()

	// Setup LangWatch tracer provider
	setupOTelWithLangWatch(ctx)

	// Create instrumented OpenAI client
	client := openai.NewClient(
		oaioption.WithAPIKey("YOUR_API_KEY"),
		oaioption.WithMiddleware(otelopenai.Middleware("my-openai-client",
			// Optional: Capture request/response bodies (be mindful of sensitive data)
			otelopenai.WithCaptureInput(),
			otelopenai.WithCaptureOutput(),
		)),
	)

	// Make API calls as usual
	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, OpenAI!"),
		},
	})
	if err != nil {
		log.Fatalf("Chat completion failed: %v", err)
	}
}

func setupOTelWithLangWatch(ctx context.Context) {
	tracerProvider, err := newLangWatchTracerProvider(ctx, resource)
	if err != nil {
		panic(err)
	}

	otel.SetTracerProvider(tracerProvider)
}

func newLangWatchTracerProvider(ctx context.Context, res *resource.Resource) *trace.TracerProvider {
	opts := []otlptracehttp.Option{
		otlptracehttp.WithEndpointURL("https://app.langwatch.ai/api/otel"),
		otlptracehttp.WithHeaders(map[string]string{
			"Authorization": "Bearer " + os.Getenv("LANGWATCH_API_KEY"),
		}),
	}

	traceExporter, err := otlptracehttp.New(ctx, opts...)
	if err != nil {
		panic(err)
	}

	return trace.NewTracerProvider(
		trace.WithBatcher(traceExporter, trace.WithBatchTimeout(time.Second)),
		trace.WithResource(res),
	)
}
```

## Configuration Options

The `Middleware` function accepts optional configuration functions:

- `WithTracerProvider(provider oteltrace.TracerProvider)`: Specifies the OTel `TracerProvider`. Defaults to the global provider.
- `WithPropagators(propagators propagation.TextMapPropagator)`: Specifies OTel propagators. Defaults to global propagators.
- `WithCaptureInput()`: Records the full conversation input as the `langwatch.input.value` span attribute. Use with caution if conversations contain sensitive data.
- `WithCaptureOutput()`: Records the conversation output as the `langwatch.output.value` span attribute. For streaming responses, this attribute will contain the accumulated textual content from stream events. Use with caution if conversations contain sensitive data.

## Collected Attributes

The middleware adds attributes to the client span, following [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/general/) where applicable.

**Request Attributes:**

- `gen_ai.system` (=`openai`)
- `gen_ai.request.model`
- `gen_ai.request.temperature`
- `gen_ai.request.top_p`
- `gen_ai.request.top_k`
- `gen_ai.request.frequency_penalty`
- `gen_ai.request.presence_penalty`
- `gen_ai.request.max_tokens`
- `gen_ai.request.stream` (boolean)
- `gen_ai.operation.name` (e.g., `completions`)
- `langwatch.input.value` (if `WithCaptureInput()` is used)

**Response Attributes:**

- `gen_ai.response.id`
- `gen_ai.response.model`
- `gen_ai.response.finish_reasons`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.openai.response.system_fingerprint`
- `langwatch.output.value` (if `WithCaptureOutput()` is used; for streaming responses, this is the accumulated textual content from stream events)

Standard HTTP client attributes (`http.request.method`, `url.path`, `server.address`, `http.response.status_code`) are also included.

## Streaming Considerations

While this middleware operates at the HTTP level, it actively processes Server-Sent Events (SSE) for streaming responses from the OpenAI API.

For streaming API calls:

- **Request attributes** (including `gen_ai.request.stream=true`) are captured correctly.
- **Response attributes from stream events**: The middleware parses individual stream events to extract and record the following attributes as they become available:
    - `gen_ai.response.id`
    - `gen_ai.response.model`
    - `gen_ai.openai.response.system_fingerprint`
    - `gen_ai.usage.input_tokens` (if provided in the stream, typically by Azure OpenAI or in the final event)
    - `gen_ai.usage.output_tokens` (if provided in the stream)
    - `gen_ai.response.finish_reasons` (accumulated from choices in stream events)
- **Content Capture with `WithCaptureOutput()`**: If the `WithCaptureOutput()` option is enabled:
    - The textual content from `delta` objects within stream events is accumulated.
    - This accumulated content is recorded as the `langwatch.output.value` attribute on the span once the stream concludes.
- **Attribute Aggregation**: Attributes like `finish_reasons` are aggregated from all relevant events in the stream. Usage tokens are captured if present in any event (often the last one or a separate `usage` event).

The primary difference compared to non-streaming responses is that attributes are pieced together from multiple events rather than a single, complete JSON response body. However, most key GenAI response attributes are still captured.
