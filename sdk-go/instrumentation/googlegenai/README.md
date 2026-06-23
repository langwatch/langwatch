# googlegenai

This package provides OpenTelemetry instrumentation for Google's **unified Gen
AI Go SDK**, [`google.golang.org/genai`](https://pkg.go.dev/google.golang.org/genai),
which covers both the **Gemini Developer API** (`generativelanguage.googleapis.com`)
and **Vertex AI** (`aiplatform.googleapis.com`) backends behind one client.

It automatically creates client spans for the API calls made through an
instrumented `genai` client, recording request and response attributes according
to the OpenTelemetry GenAI semantic conventions and LangWatch's extensions.

The `genai` client lets you inject the HTTP client it uses
(`ClientConfig.HTTPClient`, a `*http.Client` that is honored verbatim). This
package traces at that HTTP layer via the shared [`otelhttp`](../otelhttp) base:
it passes request and response bodies *through* to the caller byte-for-byte while
capturing a bounded copy off the critical path for attribute extraction. Tracing
adds negligible latency and memory.

## Model in the URL, not the body

Unlike OpenAI and Anthropic, the Gemini REST API encodes the **model** and the
**action** in the URL path rather than the request body:

```
POST /v1beta/models/gemini-2.5-flash:generateContent
POST /v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse
POST /v1beta1/projects/{p}/locations/{l}/publishers/google/models/gemini-2.5-flash:generateContent   (Vertex)
```

So `gen_ai.request.model` and `gen_ai.operation.name` are derived from the **path**
(via `otelhttp.Config.OperationAttrs`), while the rest of the call — request
params, input/output content, usage and finish reasons — is read from the JSON
**body** by the content extractor. The request body the extractor matches on
carries a `contents[]` array (no `model` field).

| Extractor          | Request discriminator                       | Streaming reconstruction |
| ------------------ | ------------------------------------------- | ------------------------ |
| `generate_content` | `contents[]` (or a `:generateContent` path) | accumulate `candidates[].content.parts[].text`; **no `[DONE]` sentinel** — ends on EOF; usage / finish reason / model version from the final chunk |
| `generic`          | anything (terminal fallback)                | best-effort Gemini-chunk probing |

A Gemini `GenerateContentResponse` carries no top-level `object` discriminator, so
the base routes non-streaming responses to the terminal fallback, which decodes
them as a `GenerateContentResponse` and records identical attributes to the typed
request/response pairing.

## Supported operations

| API                                    | Support             | Docs                                                                            |
| -------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `generateContent`                      | Full (Input/Output) | [Docs](https://ai.google.dev/api/generate-content#method:-models.generatecontent)       |
| `streamGenerateContent` (SSE)          | Full (Input/Output) | [Docs](https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent) |
| Other endpoints (embeddings, caches …) | Generic fallback    | —                                                                               |

Both the Gemini Developer API and the Vertex AI backend are supported — the model
is parsed from either path shape.

## Token usage

All token kinds Gemini reports in `usageMetadata` are captured and mapped onto the
LangWatch `gen_ai.usage.*` attributes:

| Gemini `usageMetadata`    | `gen_ai.usage.*`        |
| ------------------------- | ----------------------- |
| `promptTokenCount`        | `input_tokens`          |
| `candidatesTokenCount`    | `output_tokens`         |
| `totalTokenCount`         | `total_tokens`          |
| `cachedContentTokenCount` | `cached_input_tokens`   |
| `thoughtsTokenCount`      | `reasoning.output_tokens` |

Usage is recorded as `gen_ai.usage.*` attributes (the OTel-native view), which
feed LangWatch cost reporting.

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/instrumentation/googlegenai
```

## Usage

Set your environment variables:

```bash
export LANGWATCH_API_KEY="your-langwatch-api-key"
export GEMINI_API_KEY="your-gemini-api-key"
```

### Option 1 — `WrapClientConfig` (recommended)

`WrapClientConfig` sets `cc.HTTPClient` to a traced client in place, preserving any
transport you already configured (timeouts, proxies, Vertex auth, …) as the base
of the chain:

```go
package main

import (
	"context"
	"log"
	"os"

	"github.com/langwatch/langwatch/sdk-go/instrumentation/googlegenai"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"google.golang.org/genai"
)

func main() {
	// ... set up and register your TracerProvider / LangWatch exporter ...
	tp := sdktrace.NewTracerProvider( /* ... */ )
	otel.SetTracerProvider(tp)
	defer func() { _ = tp.Shutdown(context.Background()) }()

	ctx := context.Background()

	cc := &genai.ClientConfig{
		APIKey:  os.Getenv("GEMINI_API_KEY"),
		Backend: genai.BackendGeminiAPI,
	}
	googlegenai.WrapClientConfig(cc) // uses the global TracerProvider by default

	client, err := genai.NewClient(ctx, cc)
	if err != nil {
		log.Fatal(err)
	}

	resp, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text("Hello!"), nil)
	if err != nil {
		log.Fatal(err)
	}
	log.Println(resp.Text())
}
```

### Option 2 — `NewTransport`

If you'd rather build the `*http.Client` yourself, `NewTransport` returns an
`http.RoundTripper` (wrapping `http.DefaultTransport`):

```go
cc := &genai.ClientConfig{
	APIKey:     os.Getenv("GEMINI_API_KEY"),
	HTTPClient: &http.Client{Transport: googlegenai.NewTransport()},
}
client, err := genai.NewClient(ctx, cc)
```

To chain a custom base transport, use `NewTransportWithBase(base, opts...)`. For
the **Vertex AI** backend the base transport must perform the OAuth
authentication `genai`'s default client would otherwise add, so pass the
authenticated transport as the base.

## Options

| Option                   | Description                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------- |
| `WithTracerProvider(tp)` | Tracer provider to use. Defaults to the global provider.                                           |
| `WithDataCapture(mode)`  | Gates input/output **content** capture at the source. Defaults to `langwatch.DataCaptureAll`. Span structure, models, usage and metrics are always recorded. |
| `WithGenAIProvider(kv)`  | Sets `gen_ai.provider.name`. Defaults to `gcp.gemini` (`semconv.GenAIProviderNameGCPGemini`).      |

`WithDataCapture` composes with the exporter-level
`langwatch.WithDataCapture(...)`: the transport gates content at the source and
the exporter strips it at export time. When content capture is off, the input
messages, output text **and** `gen_ai.system_instructions` are all withheld,
while structure, models, usage and finish reasons are still recorded.

## Captured attributes

- **Request** (from the URL path): `gen_ai.request.model`, `gen_ai.operation.name`
  (`generate_content`); plus `gen_ai.provider.name`.
- **Request** (from the body's `generationConfig`):
  `gen_ai.request.{temperature,top_p,top_k,max_tokens,choice_count,stop_sequences}`,
  a `gen_ai.request.thinking_config` JSON blob, `gen_ai.request.tools`, the
  `gen_ai.system_instructions` / `langwatch.instructions` system prompt, and the
  input (`langwatch.input`, as `chat_messages` with Gemini's `model` role mapped
  to `assistant`).
- **Response**: `gen_ai.response.{id,model,finish_reasons}`, all token usage
  (`gen_ai.usage.{input_tokens,output_tokens,total_tokens,cached_input_tokens,reasoning.output_tokens}`),
  and the output text (`langwatch.output`).
- **HTTP / status**: `http.request.method`, `server.address`, `url.path`,
  `http.response.status_code`, plus span status / recorded error on failures.

## Streaming reconstruction

For `streamGenerateContent` the response is an SSE stream where each `data:` line
is a `GenerateContentResponse` chunk. Crucially, Gemini's stream has **no
`data: [DONE]` sentinel** — it ends when the connection closes (EOF). As the
client drains the stream, the transport:

- accumulates `candidates[0].content.parts[].text` into the output text (skipping
  thought parts), mirroring `GenerateContentResponse.Text()`,
- records `candidates[].finishReason` and the response `id` / `modelVersion` from
  the chunks,
- reads token usage from the final chunk's `usageMetadata`.

The span ends exactly once, when the stream terminates or the body is closed.
Bytes are never altered or pre-buffered — the client's own reads drive the
reconstruction.
