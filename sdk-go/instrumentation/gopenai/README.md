# gopenai

This package provides OpenTelemetry instrumentation for the popular **community**
OpenAI Go client `github.com/sashabaranov/go-openai` (often imported as
`openai`).

It automatically creates client spans for the API calls made through an
instrumented `go-openai` client, recording request and response attributes
according to the OpenTelemetry GenAI semantic conventions and LangWatch's
extensions.

`go-openai` doesn't expose a middleware hook, but it does let you inject the HTTP
client it uses (`ClientConfig.HTTPClient`, typed as the `HTTPDoer` interface that
`*http.Client` satisfies). This package traces at that HTTP layer via the shared
[`otelhttp`](../otelhttp) base: it passes request and response bodies *through* to
the caller byte-for-byte while capturing a bounded copy off the critical path for
attribute extraction. Tracing adds negligible latency and memory.

## Shape-based dispatch

The transport sees the raw request and response bytes for **any** endpoint the
client calls. Rather than switching on the URL path, it dispatches by request /
response **shape**: it sniffs the body for discriminating fields and picks the
matching extractor from an ordered registry, using the URL path only as a hint /
tiebreaker. A generic fallback extractor is tried last, so unknown or
unsupported OpenAI-compatible endpoints still produce a useful span instead of
nothing.

| Extractor    | Request discriminator                                     | Response discriminator (`object`)      | Streaming reconstruction |
| ------------ | --------------------------------------------------------- | -------------------------------------- | ------------------------ |
| `chat`       | `messages[]` (or a `chat/completions`/`completions` path) | `chat.completion` / `text_completion`  | accumulate `choices[].delta.content` (or `.text`); terminated by `[DONE]`; usage from the final chunk |
| `embeddings` | `input` + (`encoding_format`/`dimensions`); never streams | `list`                                 | n/a                      |
| `generic`    | anything (terminal fallback)                              | anything                               | best-effort chat-style delta probing |

## Supported operations

| API                        | Support             | Docs                                                                     |
| -------------------------- | ------------------- | ------------------------------------------------------------------------ |
| Chat Completions           | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/chat/create)       |
| Chat Completions Streaming | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/chat/create)       |
| Completions (legacy)       | Full (Input/Output) | [Docs](https://platform.openai.com/docs/api-reference/completions)       |
| Embeddings                 | Full (Input/usage)  | [Docs](https://platform.openai.com/docs/api-reference/embeddings/create) |
| Other endpoints            | Generic fallback    | —                                                                        |

Chat Completions capture cached prompt tokens
(`gen_ai.usage.cached_input_tokens`) and reasoning tokens
(`gen_ai.usage.reasoning.output_tokens`) when the provider returns them in
`usage.prompt_tokens_details` / `usage.completion_tokens_details`. All token
usage is recorded **both** as `gen_ai.usage.*` attributes and as the
`langwatch.metrics` token rollup that feeds LangWatch cost reporting.

## OpenAI-compatible providers

`go-openai` is very commonly pointed at OpenAI-compatible providers (Groq,
Together, Fireworks, Ollama, …). The `gen_ai.provider.name` attribute defaults to
`openai` but is overridable with `WithGenAIProvider`:

```go
gopenai.WrapConfig(&config,
	gopenai.WithGenAIProvider(semconv.GenAIProviderNameKey.String("groq")),
)
```

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/instrumentation/gopenai
```

## Usage

Set your environment variables:

```bash
export LANGWATCH_API_KEY="your-langwatch-api-key"
export OPENAI_API_KEY="your-openai-api-key"
```

### Option 1 — `WrapConfig` (recommended)

`WrapConfig` sets `config.HTTPClient` to a traced client in place, preserving any
transport you already configured (timeouts, proxies, …) as the base of the chain:

```go
package main

import (
	"context"
	"log"
	"os"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/gopenai"
	openai "github.com/sashabaranov/go-openai"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func main() {
	// ... set up and register your TracerProvider / LangWatch exporter ...
	tp := sdktrace.NewTracerProvider( /* ... */ )
	otel.SetTracerProvider(tp)
	defer func() { _ = tp.Shutdown(context.Background()) }()

	config := openai.DefaultConfig(os.Getenv("OPENAI_API_KEY"))
	gopenai.WrapConfig(&config) // uses the global TracerProvider by default
	client := openai.NewClientWithConfig(config)

	resp, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:    openai.GPT4oMini,
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "Hello!"}},
	})
	if err != nil {
		log.Fatal(err)
	}
	log.Println(resp.Choices[0].Message.Content)
}
```

### Option 2 — `NewTransport`

If you'd rather build the `*http.Client` yourself, `NewTransport` returns an
`http.RoundTripper` (wrapping `http.DefaultTransport`):

```go
config := openai.DefaultConfig(os.Getenv("OPENAI_API_KEY"))
config.HTTPClient = &http.Client{Transport: gopenai.NewTransport()}
client := openai.NewClientWithConfig(config)
```

To chain a custom base transport, use `NewTransportWithBase(base, opts...)`.

## Options

| Option                          | Description                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `WithTracerProvider(tp)`        | Tracer provider to use. Defaults to the global provider.                                           |
| `WithDataCapture(mode)`         | Gates input/output **content** capture at the source. Defaults to `langwatch.DataCaptureAll`. Span structure, models, usage and metrics are always recorded. |
| `WithGenAIProvider(kv)`         | Sets `gen_ai.provider.name`. Defaults to `openai`; override for OpenAI-compatible providers.       |

`WithDataCapture` composes with the exporter-level
`langwatch.WithDataCapture(...)`: the transport gates content at the source and
the exporter strips it at export time.

## Captured attributes

- **Request**: `gen_ai.request.model`, `gen_ai.provider.name`,
  `gen_ai.operation.name`, `gen_ai.request.{temperature,top_p,max_tokens,frequency_penalty,presence_penalty,seed,choice_count,stop_sequences,reasoning_effort}`,
  `gen_ai.request.tools`, `langwatch.gen_ai.streaming`, and the input
  (`langwatch.input`, as `chat_messages` for chat / JSON for legacy prompts).
- **Response**: `gen_ai.response.{id,model,finish_reasons}`,
  `openai.response.system_fingerprint`, all token usage
  (`gen_ai.usage.{input_tokens,output_tokens,total_tokens,cached_input_tokens,reasoning.output_tokens}`),
  the `langwatch.metrics` token rollup, and the output (`langwatch.output`).
- **Embeddings**: `gen_ai.request.encoding_formats`,
  `gen_ai.embeddings.dimension_count`, `gen_ai.usage.{input_tokens,total_tokens}`,
  and `gen_ai.response.embeddings_count`.
- **HTTP / status**: `http.request.method`, `server.address`, `url.path`,
  `http.response.status_code`, plus span status / recorded error on failures.

## Streaming reconstruction

For streaming chat completions the response is an OpenAI SSE stream terminated by
a `data: [DONE]` sentinel. As the client drains the stream, the transport:

- accumulates `choices[].delta.content` into the output text,
- records `choices[].finish_reason`, and the response `id` / `model` /
  `system_fingerprint` from the chunks,
- reads token usage from the final usage chunk when the request set
  `stream_options.include_usage` (`StreamOptions{IncludeUsage: true}`).

The span ends exactly once, when the stream terminates or the body is closed.
Bytes are never altered or pre-buffered — the client's own reads drive the
reconstruction.
