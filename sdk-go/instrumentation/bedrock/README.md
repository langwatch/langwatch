# bedrock

This package provides OpenTelemetry instrumentation for the AWS Bedrock Runtime
client (`github.com/aws/aws-sdk-go-v2/service/bedrockruntime`).

Unlike the HTTP-bytes instrumentations in this SDK, Bedrock is traced via the AWS
**smithy-go middleware stack**. The middleware reads the *typed* operation input
and output structs (`*bedrockruntime.ConverseInput` /
`*bedrockruntime.ConverseOutput`, …) rather than parsing SigV4-signed HTTP
bodies. This is cleaner and more robust: there is no body buffering, and the
attribute extraction works directly against the SDK's Go types.

It creates one client span per Bedrock Runtime call, annotated with the
OpenTelemetry GenAI semantic conventions and LangWatch's span input/output,
metrics and usage attributes.

## Supported operations

| Operation        | Support                                  | Notes |
| ---------------- | ---------------------------------------- | ----- |
| `Converse`       | Full (input + output + usage + metrics)  | The unified messages API. Priority surface. |
| `ConverseStream` | Full (input + accumulated output + usage)| The event stream is wrapped, so output text and the final `metadata` usage are captured after the stream is consumed. |
| `InvokeModel`    | Best-effort                              | Body is provider-specific JSON; usage is parsed for the common Anthropic / Amazon Titan shapes, otherwise the model id + raw body are recorded. |

Other Bedrock Runtime operations pass through untouched (no span).

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/instrumentation/bedrock
```

## Usage

Instrument an `aws.Config` once, and every Bedrock Runtime client built from it
is traced:

```go
package main

import (
	"context"
	"log"

	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/bedrock"
)

func main() {
	ctx := context.Background()

	// ... set up your OTel TracerProvider + LangWatch exporter here ...

	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		log.Fatal(err)
	}

	// Add the tracing middleware to the config.
	bedrock.InstrumentConfig(&cfg)

	client := bedrockruntime.NewFromConfig(cfg)

	_, err = client.Converse(ctx, &bedrockruntime.ConverseInput{
		ModelId: aws.String("anthropic.claude-3-5-sonnet-20240620-v1:0"),
		Messages: []types.Message{{
			Role:    types.ConversationRoleUser,
			Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "Hello!"}},
		}},
	})
	if err != nil {
		log.Fatal(err)
	}
}
```

### Instrumenting a single client or operation

If you do not want to mutate the shared `aws.Config`, add the middleware to a
single client (or a single operation call) via `APIOptions`:

```go
client := bedrockruntime.NewFromConfig(cfg, func(o *bedrockruntime.Options) {
	o.APIOptions = append(o.APIOptions, bedrock.WithTracing())
})
```

`WithTracing` returns a `func(*middleware.Stack) error`, the standard smithy-go
stack mutator shape, so it composes with any other API options you pass.

## Configuration

Both `InstrumentConfig` and `WithTracing` accept the same options:

| Option                          | Default                              | Effect |
| ------------------------------- | ------------------------------------ | ------ |
| `WithTracerProvider(tp)`        | global provider                      | Tracer provider used to create spans. |
| `WithDataCapture(mode)`         | `langwatch.DataCaptureAll`           | Gates recording of input/output **content** at the source (`All` / `Input` / `Output` / `None`). Structure, models, usage and metrics are always recorded. |
| `WithGenAIProvider(kv)`         | `semconv.GenAIProviderNameAWSBedrock`| Value recorded as `gen_ai.provider.name` and used as the span-name prefix. Override to attribute by the underlying foundation-model vendor. |

`WithDataCapture` composes with the exporter-level
`langwatch.WithDataCapture(...)`: the middleware gates at the source and the
exporter strips content at export time.

## Captured attributes

Every span is a client span with:

- `gen_ai.provider.name` = `aws.bedrock` (or your `WithGenAIProvider` override)
- `gen_ai.operation.name` = `chat`
- `langwatch.span.type` = `llm`
- `gen_ai.request.stream` = whether the operation streams
- span name `"<provider>.<modelId>"`, e.g. `aws.bedrock.anthropic.claude-3-5-sonnet-20240620-v1:0`

### Converse / ConverseStream

**Request** (`ConverseInput` / `ConverseStreamInput`):

| Source field                       | Recorded as |
| ---------------------------------- | ----------- |
| `ModelId`                          | `gen_ai.request.model` + span name |
| `InferenceConfig.MaxTokens`        | `gen_ai.request.max_tokens` |
| `InferenceConfig.Temperature`      | `gen_ai.request.temperature` |
| `InferenceConfig.TopP`             | `gen_ai.request.top_p` |
| `InferenceConfig.StopSequences`    | `gen_ai.request.stop_sequences` |
| `ToolConfig.Tools`                 | `gen_ai.request.tools` (JSON) |
| `System` (text blocks)             | `gen_ai.system_instructions` (gated by capture) |
| `Messages` (all content blocks)    | `langwatch.input` as `chat_messages` (gated by capture) |

Message content blocks are expanded into LangWatch chat content: `text` →
plain text, `image`/`document` → binary parts (MIME type, filename), `toolUse` →
a tool-call part (name, id, JSON args), `toolResult` → a tool-result part,
`reasoningContent` → text.

**Response** (`ConverseOutput` / accumulated `ConverseStream` events):

| Source field                                            | Recorded as |
| ------------------------------------------------------- | ----------- |
| `Output` message (Converse) / accumulated message (stream) | `langwatch.output` (gated by capture) — recorded as `chat_messages` carrying any `toolUse` blocks as `tool_call` parts, else as text |
| `StopReason` / `messageStop.stopReason`                 | `gen_ai.response.finish_reasons` |
| `Usage.InputTokens`                                     | `gen_ai.usage.input_tokens` |
| `Usage.OutputTokens`                                    | `gen_ai.usage.output_tokens` |
| `Usage.TotalTokens`                                     | `gen_ai.usage.total_tokens` |
| `Usage.CacheReadInputTokens`                            | `gen_ai.usage.cached_input_tokens` |
| `Usage.CacheWriteInputTokens`                           | `gen_ai.usage.cache_creation.input_tokens` |

Token usage is recorded via `SetGenAIUsage` (the OTel `gen_ai.usage.*`
attributes, including the cache-read and cache-creation counts for cache-aware
cost attribution); `SetMetrics` carries only the cost + `tokens_estimated` flag.

### ConverseStream details

`ConverseStream` returns an event stream that the caller drains via
`output.GetStream().Events()`. The middleware wraps the typed event-stream
reader (`ConverseStreamEventStream.Reader`, a public, mockable field) with a
forwarding decorator:

- request attributes are recorded when the operation starts;
- every event is observed as the SDK drains it (accumulating
  `contentBlockDelta.Delta.Text`, the streamed `toolUse` blocks — name + id from
  `contentBlockStart`, JSON args reassembled from `toolUse` deltas — and reading
  the final `metadata` `Usage` / `Metrics`), then forwarded unchanged to the
  caller;
- the span is ended when the stream is fully consumed, the reader is closed, or
  the operation's `context.Context` is cancelled — whichever happens first — so
  streamed output and usage are captured without the caller missing any events.

> **Close the stream.** The span (and the single forwarding goroutine) are
> finalised when the upstream stream drains, `Close()` is called, or the
> operation context is cancelled. A consumer that reads a few events and walks
> away **without** calling `Close()` and **without** cancelling the request
> context would leave the span open and the goroutine parked. The AWS SDK's
> `ConverseStreamEventStream` is an `io.Closer`; always `defer stream.Close()`
> (or pass a cancellable context), exactly as you would for any event stream.

The decorator adds a single goroutine per streaming call and is race-clean
(verified under `go test -race`). Output (text + tool calls) and the final usage
are captured for streaming exactly as for non-streaming Converse. The natural
caveat for any streaming span applies — the span ends when the consumer finishes
(or abandons via Close / ctx-cancel) the stream, not when the HTTP response
returns.

### InvokeModel details

`InvokeModel` bodies are provider-specific JSON, so this is best-effort:

- `ModelId` → `gen_ai.request.model` + span name (always);
- request/response body → `langwatch.input` / `langwatch.output` (gated by
  capture; recorded as structured JSON when valid). **A size guard skips the body
  content when it exceeds 256 KiB** so image/audio-model payloads (large base64
  blobs) do not bloat spans; the model id and usage are still recorded;
- usage is parsed for the common shapes:
  - Anthropic Messages: `usage.input_tokens` / `usage.output_tokens` plus
    `cache_read_input_tokens` / `cache_creation_input_tokens` (+ `stop_reason`).
    The synthesized `total_tokens` includes the cache tokens (they are real input
    tokens);
  - Amazon Titan: `inputTextTokenCount` / `results[].tokenCount` (+
    `results[].completionReason`);
- unknown body shapes record the model and body only (no fabricated usage).

## Testing

The tests cover Converse non-streaming thoroughly via a full client round-trip
(`bedrockruntime.NewFromConfig` with a stub `aws.HTTPClient` returning a canned
Converse JSON response and stub credentials), asserting model, all token types
(including cache read/write), stop reason, latency, and input/output. Rich
multimodal/tool content, data-capture gating and the HTTP-error path are also
covered. `ConverseStream` is tested at the event-stream-wrapper level (output
accumulation, final usage, early close, capture gating) and `InvokeModel` at the
round-trip and mapping levels.
