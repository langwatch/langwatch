# openai

This package provides OpenTelemetry instrumentation middleware for the official `openai-go` client library (`github.com/openai/openai-go/v3`).

It automatically creates client spans for OpenAI API calls made through the instrumented client, adding relevant request and response attributes according to OpenTelemetry GenAI semantic conventions.

## Shape-based dispatch

The middleware sees the raw request and response bytes for **any** endpoint the
client calls. Rather than switching on the URL path, it dispatches by request /
response **shape**: it sniffs the body for discriminating fields and picks the
matching extractor from an ordered registry, using the URL path only as a hint /
tiebreaker. A generic fallback extractor is tried last, so unknown or
unsupported OpenAI-compatible endpoints still produce a useful span instead of
nothing.

| Extractor    | Request discriminator                                          | Response discriminator (`object`) | Streaming reconstruction |
| ------------ | -------------------------------------------------------------- | --------------------------------- | ------------------------ |
| `chat`       | `messages[]` (or a `chat/completions` path)                    | `chat.completion`                 | accumulate `choices[].delta.content`; terminated by `[DONE]`; usage from the final chunk |
| `responses`  | `input` + (`instructions`/`max_output_tokens`/`reasoning`/…)   | `response`                        | typed events: accumulate `response.output_text.delta`, read the final `response.completed` event (no `[DONE]`) |
| `embeddings` | `input` + (`encoding_format`/`dimensions`); never streams      | `list`                            | n/a                      |
| `generic`    | anything (terminal fallback)                                   | anything                          | best-effort chat-style delta probing |

## Supported OpenAI Operations

While the middleware is for the OpenAI Go SDK, most AI providers support the OpenAI API spec, meaning you can use it with any OpenAI-compatible client. Just update the client to point to the correct endpoint.

| API                        | Support             | Docs                                                                     |
| -------------------------- | ------------------- | ------------------------------------------------------------------------ |
| Chat Completions           | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/chat/create)       |
| Chat Completions Streaming | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/chat/create)       |
| Responses                  | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/responses/create)  |
| Responses Streaming        | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/responses/create)  |
| Embeddings                 | Full (Input/usage)  | [Docs](https://platform.openai.com/docs/api-reference/embeddings/create) |
| Other endpoints            | Generic fallback    | —                                                                        |

Chat Completions and the Responses API capture cached prompt tokens
(`gen_ai.usage.cached_input_tokens`) and reasoning tokens
(`gen_ai.usage.reasoning.output_tokens`) when the provider returns them.

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
package main

import (
	"context"
	"log"
	"os"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
)

func main() {
	ctx := context.Background()

	// Setup LangWatch exporter (reads LANGWATCH_API_KEY from env)
	exporter, err := langwatch.NewExporter(ctx)
	if err != nil {
		log.Fatalf("failed to create LangWatch exporter: %v", err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
	otel.SetTracerProvider(tp)
	defer tp.Shutdown(ctx)

	// Create instrumented OpenAI client. By default the middleware captures
	// both request (input) and response (output) content.
	client := openai.NewClient(
		option.WithAPIKey(os.Getenv("OPENAI_API_KEY")),
		option.WithMiddleware(otelopenai.Middleware("my-app",
			// Optional: narrow what content is captured (default: capture both).
			// otelopenai.WithDataCapture(langwatch.DataCaptureNone),
			// Optional: set provider name for OpenAI-compatible APIs (defaults to "openai").
			// otelopenai.WithGenAIProvider(semconv.GenAIProviderNameKey.String("azure.openai")),
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
```

## Data capture

The middleware records request (input) and response (output) **content** by
default — `langwatch.DataCaptureAll`. This is a deliberate change from the
previous opt-in `WithCaptureInput()` / `WithCaptureOutput()` options (now
removed). Use `WithDataCapture` to narrow it:

```go
otelopenai.Middleware("my-app", otelopenai.WithDataCapture(langwatch.DataCaptureInput)) // input only
otelopenai.Middleware("my-app", otelopenai.WithDataCapture(langwatch.DataCaptureNone))  // neither
```

The mode gates recording **at the source**: input content is only recorded when
`mode.CaptureInput()` is true, and output content only when
`mode.CaptureOutput()` is true. Span structure, models, usage, finish reasons
and identity are always recorded regardless of mode.

For cross-cutting control across **every** instrumentation (not just the OpenAI
middleware), prefer the exporter option `langwatch.WithDataCapture(...)`:

```go
exporter, _ := langwatch.NewExporter(ctx, langwatch.WithDataCapture(langwatch.DataCaptureNone))
```

The two **compose**: the middleware gates content at the source, and the
exporter strips content at export time. The exporter option is the recommended
place for a uniform policy; the middleware option is handy when you only want to
change behaviour for one client (for example, a client whose LLM span records
input/output manually).

## Filtering Spans

Use the LangWatch exporter's filtering to control which spans are exported:

```go
// Only export LangWatch and OpenAI instrumentation spans
exporter, err := langwatch.NewExporter(ctx,
	langwatch.WithFilters(
		langwatch.Include(langwatch.Criteria{
			ScopeName: []langwatch.Matcher{
				langwatch.StartsWith("github.com/langwatch/"),
				langwatch.Equals("my-app"),
			},
		}),
	),
)
```

See the [main SDK README](../../README.md#filtering-spans) for full filtering documentation.

## Configuration Options

The `Middleware` function accepts a required instrumentor name (string) to identify your application, followed by optional configuration functions:

- `WithTracerProvider(provider oteltrace.TracerProvider)`: Specifies the OTel `TracerProvider`. Defaults to the global provider.
- `WithPropagators(propagators propagation.TextMapPropagator)`: Specifies OTel propagators. Defaults to global propagators.
- `WithGenAIProvider(provider attribute.KeyValue)`: Sets the `gen_ai.provider.name` attribute on spans. Defaults to `"openai"`. Use this when the middleware is used with OpenAI-compatible APIs from other providers. (`WithGenAISystem` remains as a deprecated alias; `gen_ai.system` was removed from the GenAI semantic conventions in favour of `gen_ai.provider.name`.)
- `WithDataCapture(mode langwatch.DataCaptureMode)`: Controls whether request (input) and response (output) content is recorded. Defaults to `langwatch.DataCaptureAll`. See [Data capture](#data-capture).

## Collected Attributes

The middleware adds attributes to the client span, following [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) where applicable.

**Request Attributes:**

- `gen_ai.provider.name` (=`openai`)
- `gen_ai.request.model`
- `gen_ai.request.temperature`
- `gen_ai.request.top_p`
- `gen_ai.request.max_tokens` (from `max_completion_tokens`/`max_tokens`/`max_output_tokens`)
- `gen_ai.request.frequency_penalty`, `gen_ai.request.presence_penalty`
- `gen_ai.request.stop_sequences`, `gen_ai.request.seed`, `gen_ai.request.choice_count`
- `gen_ai.request.reasoning_effort`
- `gen_ai.request.encoding_formats`, `gen_ai.embeddings.dimension.count` (embeddings)
- `langwatch.instructions` (Responses API)
- `langwatch.gen_ai.streaming` (boolean)
- `gen_ai.operation.name` (e.g., `chat`, `embeddings`, `responses`)
- `langwatch.input` (when input capture is enabled)

**Response Attributes:**

- `gen_ai.response.id`
- `gen_ai.response.model`
- `gen_ai.response.finish_reasons`
- `gen_ai.response.status` (Responses API)
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.total_tokens`
- `gen_ai.usage.cached_input_tokens`, `gen_ai.usage.reasoning.output_tokens` (when returned)
- `gen_ai.openai.response.system_fingerprint`
- `langwatch.output` (when output capture is enabled; for streaming responses this is the reconstructed textual content)

Standard HTTP client attributes (`http.request.method`, `url.path`, `server.address`, `http.response.status_code`) are also included.

## Streaming Considerations

While this middleware operates at the HTTP level, it actively processes Server-Sent Events (SSE) for streaming responses, reconstructing the response without disturbing the bytes the client receives. The span is ended once the stream is fully drained.

**Chat Completions streaming** accumulates `choices[].delta.content` across
chunks, reads usage from the final chunk (when `stream_options.include_usage` is
set), and terminates on the `[DONE]` sentinel.

**Responses API streaming** is reconstructed from **typed events**, not the chat
shape, and has **no `[DONE]` sentinel**:

- `response.output_text.delta` events are accumulated into the output text;
- the terminal `response.completed` event carries the fully-formed response,
  which is the most reliable source of usage (including cached / reasoning
  tokens), output text and status;
- `error` / `response.failed` events set the span status to error from the
  event's message and code.

When output capture is enabled, the reconstructed content is recorded as the
`langwatch.output` attribute on the span once the stream concludes.
