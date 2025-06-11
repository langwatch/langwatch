# openai

This package provides OpenTelemetry instrumentation middleware for the official `openai-go` client library (`github.com/openai/openai-go`).

It automatically creates client spans for OpenAI API calls made through the instrumented client, adding relevant request and response attributes according to OpenTelemetry GenAI semantic conventions.

## Supported OpenAI Operations

While the middleware is for the OpenAI Go SDK, most AI providers support the OpenAI API spec, meaning you can use it with any OpenAI-compatible client. Just update the client to point to the correct endpoint.

While every request made through the instrumented client will be traced, some operations have enriched support to provide more detailed information.

| API                        | Support             | Docs                                                                     |
| -------------------------- | ------------------- | ------------------------------------------------------------------------ |
| Chat Completions           | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/chat/create)       |
| Chat Completions Streaming | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/chat/create)       |
| Responses                  | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/responses/create)  |
| Responses Streaming        | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/responses/create)  |
| Audio                      | Partial (Input)     | [Docs](https://platform.openai.com/docs/api-reference/audio/create)      |
| Images                     | Partial (Input)     | [Docs](https://platform.openai.com/docs/api-reference/images/create)     |
| Embeddings                 | Partial             | [Docs](https://platform.openai.com/docs/api-reference/embeddings/create) |

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/instrumentation/openai
```

## Usage

First, set your environment variables:

```bash
export LANGWATCH_API_KEY="your-langwatch-api-key"
export OPENAI_API_KEY="your-openai-api-key"
```

Then wrap the `openai.Middleware` using `option.WithMiddleware` when creating the `openai.Client`:

```go
package test

import (
	"context"
	"log"
	"os"

	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
)

func main() {
	ctx := context.Background()

	// Setup LangWatch tracer provider
	setupOTelWithLangWatch(ctx)

	// Create instrumented OpenAI client
	client := openai.NewClient(
		option.WithAPIKey(os.Getenv("OPENAI_API_KEY")),
		option.WithMiddleware(otelopenai.Middleware("my-app",
			// Optional: Capture request/response content (be mindful of sensitive data)
			otelopenai.WithCaptureInput(),
			otelopenai.WithCaptureOutput(),
		)),
	)

	// Make API call as usual
	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, OpenAI!"),
		},
	})
	if err != nil {
		log.Fatalf("Chat completion failed: %v", err)
	}

	log.Printf("Chat completion completed: %v\n", response)
}

func setupOTelWithLangWatch(ctx context.Context) func() {
	langwatchAPIKey := os.Getenv("LANGWATCH_API_KEY")
	if langwatchAPIKey == "" {
		log.Fatal("LANGWATCH_API_KEY environment variable not set")
	}

	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL("https://app.langwatch.ai/api/otel/v1/traces"),
		otlptracehttp.WithHeaders(map[string]string{"Authorization": "Bearer " + langwatchAPIKey}),
	)
	if err != nil {
		log.Fatalf("failed to create OTLP exporter: %v", err)
	}

	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
	)
	otel.SetTracerProvider(tp)

	// Return a function to shutdown the tracer provider
	return func() {
		if err := tp.Shutdown(ctx); err != nil {
			log.Fatalf("failed to shutdown TracerProvider: %v", err)
		}
	}
}
```

## Configuration Options

The `Middleware` function accepts a required instrumentor name (string) to identify your application, followed by optional configuration functions:

- `WithLogger(logger *slog.Logger)`: Specifies a structured logger to use for logging. Defaults to a zero-noise default (discard) logger. The logger should be configured by the caller with appropriate levels and outputs.
- `WithTracerProvider(provider oteltrace.TracerProvider)`: Specifies the OTel `TracerProvider`. Defaults to the global provider.
- `WithLoggerProvider(provider log.LoggerProvider)`: Specifies the OTel `LoggerProvider`. Defaults to the global provider.
- `WithPropagators(propagators propagation.TextMapPropagator)`: Specifies OTel propagators. Defaults to global propagators.
- `WithGenAISystem(system attribute.KeyValue)`: Sets the `gen_ai.system` attribute on spans. Defaults to `"openai"`. Use this when the middleware is used with OpenAI-compatible APIs from other providers.
- `WithCaptureAllInput()`: Capture all input content sent to an LLM.
- `WithCaptureSystemInput()`: Capture system and developer input content sent to an LLM.
- `WithCaptureOutput()`: Capture assistant output content from an LLM.

## Collected Attributes

The middleware adds attributes to the client span, following [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) where applicable.

**Request Attributes:**

- `gen_ai.system` (=`openai`)
- `gen_ai.request.model`
- `gen_ai.request.temperature`
- `gen_ai.request.top_p`
- `gen_ai.request.top_k`
- `gen_ai.request.frequency_penalty`
- `gen_ai.request.presence_penalty`
- `gen_ai.request.max_tokens`
- `langwatch.gen_ai.streaming` (boolean)
- `gen_ai.operation.name` (e.g., `completions`)

**Response Attributes:**

- `gen_ai.response.id`
- `gen_ai.response.model`
- `gen_ai.response.finish_reasons`
- `gen_ai.usage.input_tokens`
- `gen_ai.usage.output_tokens`
- `gen_ai.openai.response.system_fingerprint`

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
