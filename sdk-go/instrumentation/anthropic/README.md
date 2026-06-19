# anthropic

This package provides OpenTelemetry instrumentation for the official Anthropic Go SDK (`github.com/anthropics/anthropic-sdk-go`).

It wires a Stainless `option.Middleware` that automatically creates a client span for every API call the instrumented client makes, recording request and response attributes for the **Messages API** (`/v1/messages`) — both buffered and streamed — following the OpenTelemetry GenAI semantic conventions.

It is built on the shared `otelhttp` base, which owns the span lifecycle, the byte-exact body pass-through and the SSE stream reconstruction. This package owns only the Anthropic wire-shape mapping, so tracing adds negligible latency and memory: the response body is never pre-buffered or restored — it is passed through to the caller while a bounded copy is captured for attribute extraction off the critical path.

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/instrumentation/anthropic
```

## Usage

First, set your environment variables:

```bash
export LANGWATCH_API_KEY="your-langwatch-api-key"
export ANTHROPIC_API_KEY="your-anthropic-api-key"
```

Then wrap `anthropic.Middleware` using `option.WithMiddleware` when creating the `anthropic.Client`:

```go
package main

import (
	"context"
	"log"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	otelanthropic "github.com/langwatch/langwatch/sdk-go/instrumentation/anthropic"
)

func main() {
	ctx := context.Background()

	// Setup LangWatch exporter (reads LANGWATCH_API_KEY from env).
	exporter, err := langwatch.NewExporter(ctx)
	if err != nil {
		log.Fatalf("failed to create LangWatch exporter: %v", err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
	otel.SetTracerProvider(tp)
	defer tp.Shutdown(ctx)

	// Create an instrumented Anthropic client. By default the middleware
	// captures both request (input) and response (output) content.
	client := anthropic.NewClient(
		option.WithAPIKey(os.Getenv("ANTHROPIC_API_KEY")),
		option.WithMiddleware(otelanthropic.Middleware(
			// Optional: narrow what content is captured (default: capture both).
			// otelanthropic.WithDataCapture(langwatch.DataCaptureNone),
			// Optional: override the provider name for an Anthropic-compatible
			// gateway (defaults to "anthropic").
			// otelanthropic.WithGenAIProvider(semconv.GenAIProviderNameKey.String("aws.bedrock")),
		)),
	)

	message, err := client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeHaiku4_5,
		MaxTokens: 1024,
		System:    []anthropic.TextBlockParam{{Text: "You are a helpful assistant."}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello, Claude!")),
		},
	})
	if err != nil {
		log.Fatalf("messages call failed: %v", err)
	}

	log.Printf("response: %v\n", message)
}
```

Streaming works identically — drive `client.Messages.NewStreaming(...)` and drain it; the span is recorded once the stream concludes:

```go
stream := client.Messages.NewStreaming(ctx, params)
for stream.Next() {
	event := stream.Current()
	// ... handle event ...
}
if err := stream.Err(); err != nil {
	log.Fatal(err)
}
```

## Configuration Options

The `Middleware` function accepts optional configuration functions:

- `WithTracerProvider(provider oteltrace.TracerProvider)`: Specifies the OTel `TracerProvider`. Defaults to the global provider.
- `WithGenAIProvider(provider attribute.KeyValue)`: Sets the `gen_ai.provider.name` attribute on spans. Defaults to `semconv.GenAIProviderNameAnthropic` (`"anthropic"`). Use this when the client points at an Anthropic-compatible gateway (e.g. AWS Bedrock, Google Vertex).
- `WithDataCapture(mode langwatch.DataCaptureMode)`: Controls whether request (input) and response (output) content is recorded. Defaults to `langwatch.DataCaptureAll`. See [Data capture](#data-capture).

## Data capture

The middleware records request (input) and response (output) **content** by default — `langwatch.DataCaptureAll`. Use `WithDataCapture` to narrow it:

```go
otelanthropic.Middleware(otelanthropic.WithDataCapture(langwatch.DataCaptureInput)) // input only
otelanthropic.Middleware(otelanthropic.WithDataCapture(langwatch.DataCaptureNone))  // neither
```

The mode gates recording **at the source**: input content (the chat messages and the system prompt) is only recorded when `mode.CaptureInput()` is true, and output content only when `mode.CaptureOutput()` is true. Span structure, models, usage, finish reasons and identity are always recorded regardless of mode.

For cross-cutting control across **every** instrumentation, prefer the exporter option `langwatch.WithDataCapture(...)`:

```go
exporter, _ := langwatch.NewExporter(ctx, langwatch.WithDataCapture(langwatch.DataCaptureNone))
```

The two **compose**: the middleware gates content at the source and the exporter strips content at export time.

## Collected Attributes

The middleware adds attributes to the client span, following the [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/) where applicable.

**Request Attributes:**

- `gen_ai.provider.name` (= `anthropic`)
- `gen_ai.operation.name` (= `chat` for the Messages API)
- `gen_ai.request.model`
- `gen_ai.request.max_tokens` (from the required `max_tokens`)
- `gen_ai.request.temperature`, `gen_ai.request.top_p`, `gen_ai.request.top_k`
- `gen_ai.request.stop_sequences`
- `gen_ai.request.tools` (tool definitions, JSON)
- `gen_ai.system_instructions` (from the top-level `system` prompt; gated as input content)
- `langwatch.gen_ai.streaming` (boolean)
- `langwatch.span.type` (= `llm`)
- `langwatch.input` (chat messages; when input capture is enabled)

**Response Attributes:**

- `gen_ai.response.id`
- `gen_ai.response.model`
- `gen_ai.response.finish_reasons` (from `stop_reason`)
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.total_tokens` (= input + output + cache_read + cache_creation)
- `gen_ai.usage.cached_input_tokens` (from `usage.cache_read_input_tokens`)
- `gen_ai.usage.cache_creation.input_tokens` (raw attribute, from `usage.cache_creation_input_tokens`)
- `langwatch.metrics` (a JSON blob with `prompt_tokens`, `completion_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` for LangWatch cost/metric rollups)
- `langwatch.output` (the textual content; when output capture is enabled — for streaming this is the reconstructed content)

Standard HTTP client attributes (`http.request.method`, `url.path`, `server.address`, `http.response.status_code`) are also included.

### Token usage

Anthropic's `usage` object reports four distinct token counts, all of which are captured:

| Anthropic field               | `gen_ai.usage.*` attribute               | `langwatch.metrics` field    |
| ----------------------------- | ---------------------------------------- | ---------------------------- |
| `input_tokens`                | `input_tokens`                           | `prompt_tokens`              |
| `output_tokens`               | `output_tokens`                          | `completion_tokens`          |
| `cache_read_input_tokens`     | `cached_input_tokens`                    | `cache_read_input_tokens`    |
| `cache_creation_input_tokens` | `cache_creation.input_tokens` (raw attr) | `cache_creation_input_tokens`|

`total_tokens` is synthesized as `input_tokens + output_tokens + cache_read_input_tokens + cache_creation_input_tokens` (Anthropic does not return a total; cache-read and cache-creation are real input tokens, so excluding them would understate usage).

## Streaming Considerations

While this middleware operates at the HTTP level, it actively processes Server-Sent Events (SSE) for streaming responses, reconstructing the response without disturbing the bytes the client receives. The span is ended once the stream is fully drained.

Unlike OpenAI's chat completions, **Anthropic streams use typed events and have NO `[DONE]` sentinel** — the base ends the stream when the body reaches EOF. Each SSE frame is `event: <type>\ndata: {json}`; the reconstruction switches on the `data:` payload's own `type` field:

- `message_start` — carries `message.id`, `message.model` and the initial `message.usage` (`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`);
- `content_block_start` — opens a content block; a `tool_use` block carries the tool's `id` + `name`, which seed the streamed tool call at this block index;
- `content_block_delta` — `text_delta.text` and `thinking_delta.thinking` are accumulated into the output text; `input_json_delta.partial_json` (tool-call argument fragments) is reassembled onto the `tool_use` block at this index;
- `message_delta` — carries the final, authoritative `usage.output_tokens` and `delta.stop_reason`;
- `message_stop` — terminates the message; `content_block_stop` is structural; `ping` is a keep-alive.

When output capture is enabled, the reconstructed content is recorded as the `langwatch.output` attribute once the stream concludes, alongside the response id, model, finish reason and the full token-usage breakdown. If the response carried any `tool_use` block, the output is recorded as `chat_messages` carrying the visible text plus each tool call as a `tool_call` part; otherwise it is recorded as plain text.

## Filtering Spans

Use the LangWatch exporter's filtering to control which spans are exported:

```go
exporter, err := langwatch.NewExporter(ctx,
	langwatch.WithFilters(
		langwatch.Include(langwatch.Criteria{
			ScopeName: []langwatch.Matcher{
				langwatch.StartsWith("github.com/langwatch/"),
			},
		}),
	),
)
```

See the [main SDK README](../../README.md#filtering-spans) for full filtering documentation.
