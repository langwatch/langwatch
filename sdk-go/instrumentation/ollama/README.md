# ollama

This package provides OpenTelemetry instrumentation for the **official** Ollama
Go client `github.com/ollama/ollama/api`, covering its **native** `/api/*`
endpoints.

It automatically creates client spans for the API calls made through an
instrumented Ollama `api.Client`, recording request and response attributes
according to the OpenTelemetry GenAI semantic conventions and LangWatch's
extensions.

> **Native vs OpenAI-compatibility shim.** Ollama serves two surfaces: its native
> `/api/chat`, `/api/generate`, `/api/embed` endpoints (this package), and an
> OpenAI-compatible `/v1/*` shim. If you talk to Ollama through an OpenAI client,
> use the [`openai`](../openai) or [`gopenai`](../gopenai) instrumentation
> instead (point it at Ollama and set
> `WithGenAIProvider(semconv.GenAIProviderNameKey.String("ollama"))`).

The Ollama client takes its `*http.Client` at construction
(`api.NewClient(base, httpClient)`, and `api.ClientFromEnvironment()` uses
`http.DefaultClient`), so this package traces at that HTTP layer via the shared
[`otelhttp`](../otelhttp) base: it passes request and response bodies *through* to
the caller byte-for-byte while capturing a bounded copy off the critical path for
attribute extraction. Tracing adds negligible latency and memory.

## NDJSON streaming

Ollama's `/api/chat` and `/api/generate` **stream their responses as
newline-delimited JSON** (`Content-Type: application/x-ndjson`): each line is a
partial response and the **final line** carries `done: true` together with the
token counts (`prompt_eval_count` / `eval_count`) and `done_reason`. A
non-streamed call (`stream: false` in the request) returns a single
`application/json` object instead.

The base is configured with `StreamContentType = "application/x-ndjson"` and
`Framing = FramingNDJSON`, so it reconstructs the streamed shape line-by-line and
ends the span on **EOF** (NDJSON has no `[DONE]` sentinel). As the client drains
the stream the transport accumulates `message.content` (chat) / `response`
(generate) across lines, captures any `tool_calls`, and reads the final line's
`done_reason` and token counts. The span ends exactly once, when the stream ends
or the body is closed; bytes are never altered or pre-buffered.

## Shape-based dispatch

The transport sees the raw request and response bytes for **any** endpoint the
client calls. Ollama responses carry no top-level `object` discriminator, so the
package dispatches by request **shape** (and the URL path as a hint), and routes
each non-streaming response to the matching extractor by sniffing its body
fields. A generic fallback extractor is tried last, so unknown `/api/*` endpoints
still produce a useful span instead of nothing.

| Extractor    | Request discriminator                        | Response fields                          | Streaming reconstruction |
| ------------ | -------------------------------------------- | ---------------------------------------- | ------------------------ |
| `chat`       | `messages[]` (or an `/api/chat` path)        | `message{}`, `done_reason`, token counts | accumulate `message.content`; capture `tool_calls`; final-line `done_reason` + counts |
| `generate`   | top-level `prompt` (or an `/api/generate` path) | `response`, `done_reason`, token counts | accumulate `response` text; final-line `done_reason` + counts |
| `embeddings` | `input` / an `/api/embed`(`/api/embeddings`) path | `embeddings[][]` / `embedding[]`, `prompt_eval_count` | n/a (never streams) |
| `generic`    | anything (terminal fallback)                 | anything                                 | best-effort `response` / `message.content` probing |

## Supported operations

| API                       | Endpoint           | Support             |
| ------------------------- | ------------------ | ------------------- |
| Chat                      | `/api/chat`        | Full (Input/Output) |
| Chat (streaming)          | `/api/chat`        | Full (Input/Output) |
| Generate (text completion)| `/api/generate`    | Full (Input/Output) |
| Generate (streaming)      | `/api/generate`    | Full (Input/Output) |
| Embeddings                | `/api/embed`       | Full (Input/usage)  |
| Embeddings (legacy)       | `/api/embeddings`  | Full (Input)        |
| Other endpoints           | —                  | Generic fallback    |

Ollama reports `prompt_eval_count` (input tokens) and `eval_count` (output
tokens) on the response (the final line, when streaming); the total is derived as
their sum. All token usage is recorded as `gen_ai.usage.*` attributes, which feed
LangWatch cost reporting. The server-side phase durations (`load_duration`,
`prompt_eval_duration`, `eval_duration`, nanoseconds on the wire) are recorded in
seconds.

For chat and generate, model-emitted **tool calls are captured structurally** as
the assistant message's `tool_calls` (not flattened to text), in both the
streaming and non-streaming paths.

## Provider name

Ollama has no constant in the OTel GenAI semantic conventions, so
`gen_ai.provider.name` defaults to `ollama`. Override it with `WithGenAIProvider`
when pointing the client at a different backend:

```go
client := ollama.NewHTTPClient(
	ollama.WithGenAIProvider(semconv.GenAIProviderNameKey.String("my-ollama-proxy")),
)
```

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/instrumentation/ollama
```

> **Version note.** This module pins `github.com/ollama/ollama v0.23.0`, the most
> recent Ollama release whose module still declares `go 1.24.1` and is therefore
> compatible with this module's `go 1.25.0` (matching the rest of the SDK). Ollama
> `v0.23.1`+ and the whole `v0.30.x` line declare `go 1.26.0`; to build against
> those, bump this module's `go` directive to `1.26.0` and run
> `go get github.com/ollama/ollama/api@latest && go mod tidy`. The instrumentation
> parses the wire format directly, which is byte-identical across these versions,
> so no code changes are needed — only the `go` / dependency floors.

## Usage

Set your environment variables:

```bash
export LANGWATCH_API_KEY="your-langwatch-api-key"
export OLLAMA_HOST="http://localhost:11434"
```

### Option 1 — `NewHTTPClient` (recommended)

`NewHTTPClient` returns a ready `*http.Client` to pass to `api.NewClient`:

```go
package main

import (
	"context"
	"fmt"
	"log"
	"net/url"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/ollama"
	"github.com/ollama/ollama/api"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func main() {
	// ... set up and register your TracerProvider / LangWatch exporter ...
	tp := sdktrace.NewTracerProvider( /* ... */ )
	otel.SetTracerProvider(tp)
	defer func() { _ = tp.Shutdown(context.Background()) }()

	base, _ := url.Parse("http://localhost:11434")
	client := api.NewClient(base, ollama.NewHTTPClient()) // uses the global TracerProvider

	stream := false
	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Stream:   &stream,
		Messages: []api.Message{{Role: "user", Content: "Hello!"}},
	}, func(resp api.ChatResponse) error {
		fmt.Print(resp.Message.Content)
		return nil
	})
	if err != nil {
		log.Fatal(err)
	}
}
```

To preserve an existing `*http.Client`'s settings (timeout, cookie jar, redirect
policy) underneath the tracing layer, use `WrapHTTPClient(client, opts...)`.

### Option 2 — `NewTransport`

If you'd rather build the `*http.Client` yourself, `NewTransport` returns an
`http.RoundTripper` (wrapping `http.DefaultTransport`):

```go
base, _ := url.Parse("http://localhost:11434")
httpClient := &http.Client{Transport: ollama.NewTransport()}
client := api.NewClient(base, httpClient)
```

To chain a custom base transport, use `NewTransportWithBase(base, opts...)`.

## Options

| Option                   | Description                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `WithTracerProvider(tp)` | Tracer provider to use. Defaults to the global provider.                                                                                                       |
| `WithDataCapture(mode)`  | Gates input/output **content** capture at the source. Defaults to `langwatch.DataCaptureAll`. Span structure, models, usage and metrics are always recorded. |
| `WithGenAIProvider(kv)`  | Sets `gen_ai.provider.name`. Defaults to `ollama`.                                                                                                             |

`WithDataCapture` composes with the exporter-level
`langwatch.WithDataCapture(...)`: the transport gates content at the source and
the exporter strips it at export time.

## Captured attributes

- **Request**: `gen_ai.request.model`, `gen_ai.provider.name`,
  `gen_ai.operation.name` (`chat` / `text_completion` / `embeddings`), the
  generation parameters mapped from Ollama's `options{}`
  (`num_predict` → `gen_ai.request.max_tokens`,
  `gen_ai.request.{temperature,top_p,top_k,seed,frequency_penalty,presence_penalty,stop_sequences}`),
  `gen_ai.request.tools`, `gen_ai.request.structured_output` (the `format`),
  `gen_ai.embeddings.dimension_count`, `gen_ai.request.stream`, and the input
  (`langwatch.input`, as `chat_messages` for chat / text for generate +
  embeddings).
- **Response**: `gen_ai.response.model`, `gen_ai.response.finish_reasons` (the
  `done_reason`), token usage
  (`gen_ai.usage.{input_tokens,output_tokens,total_tokens}` from
  `prompt_eval_count` / `eval_count`), the server-side phase durations
  (`langwatch.ollama.{load_duration,prompt_eval_duration,eval_duration}`, seconds),
  `gen_ai.response.embeddings_count`, and the output (`langwatch.output`, as
  `chat_messages` for chat — preserving `tool_calls` — and text for generate).
- **HTTP / status**: `http.request.method`, `server.address`, `url.path`,
  `http.response.status_code`, plus span status / recorded error on failures.
