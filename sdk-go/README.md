# LangWatch Go SDK

The Go SDK for tracing LLM applications using [LangWatch](https://langwatch.ai).

**Get complete visibility into your LLM applications** - Automatically capture requests, responses, token usage, costs, and performance metrics from OpenAI, Anthropic, and other providers.

## Quick Start

### 1. Get Your API Keys

```bash
# Required
export LANGWATCH_API_KEY="your-langwatch-api-key"  # Get free at https://langwatch.ai
export OPENAI_API_KEY="your-openai-api-key"        # For OpenAI examples
```

### 2. Install

```bash
go get github.com/langwatch/langwatch/sdk-go
go get github.com/langwatch/langwatch/sdk-go/instrumentation/openai
```

### 3. Add 3 Bits of Code

Here's a complete example that instruments OpenAI API calls and sends traces to LangWatch:

```go
package main

import (
	"context"
	"log"
	"os"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"

	"github.com/openai/openai-go/v3"
	oaioption "github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func main() {
	ctx := context.Background()

	// 🔸 First - setup LangWatch tracing (reads LANGWATCH_API_KEY from env)
	exporter, err := langwatch.NewExporter(ctx)
	if err != nil {
		log.Fatalf("failed to create LangWatch exporter: %v", err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
	otel.SetTracerProvider(tp)
	defer tp.Shutdown(ctx)

	// 🔸 Second - add the middleware to your OpenAI client.
	// The middleware captures request + response content by default; pass
	// otelopenai.WithDataCapture(langwatch.DataCaptureNone) to opt out.
	client := openai.NewClient(
		oaioption.WithAPIKey(os.Getenv("OPENAI_API_KEY")),
		oaioption.WithMiddleware(otelopenai.Middleware("my-app")),
	)

	// 🔸 Optionally, create spans for your operations (recommended)
	tracer := langwatch.Tracer("my-app", trace.WithInstrumentationVersion("v1.0.0"))
	ctx, span := tracer.Start(ctx, "ChatWithUser")
	defer span.End()

	// Nothing here has changed!
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

	log.Printf("Response: %s", response.Choices[0].Message.Content)
	// 🎉 View your traces at https://app.langwatch.ai
}
```

**That's it!** 🎉 Your LLM interactions are now being traced and will appear in your [LangWatch dashboard](https://app.langwatch.ai).

## LangWatch Exporter

The SDK provides a pre-configured exporter that handles authentication and filtering:

```go
// Basic usage - reads LANGWATCH_API_KEY from environment
exporter, err := langwatch.NewExporter(ctx)

// With explicit configuration
exporter, err := langwatch.NewExporter(ctx,
	langwatch.WithAPIKey("lw_..."),
	langwatch.WithEndpoint("https://custom.langwatch.ai"),
)

// With default filtering (excludes HTTP spans)
exporter, err := langwatch.NewDefaultExporter(ctx)
```

### Filtering Spans

Control which spans are exported to LangWatch:

```go
exporter, err := langwatch.NewExporter(ctx,
	langwatch.WithFilters(
		// Preset: exclude HTTP request spans (GET /api, POST /data, etc.)
		langwatch.ExcludeHTTPRequests(),

		// Preset: keep only LangWatch instrumentation
		langwatch.LangWatchOnly(),

		// Custom: include specific scopes
		langwatch.Include(langwatch.Criteria{
			ScopeName: []langwatch.Matcher{
				langwatch.StartsWith("github.com/langwatch/"),
				langwatch.Equals("my-service"),
			},
		}),

		// Custom: exclude by span name
		langwatch.Exclude(langwatch.Criteria{
			SpanName: []langwatch.Matcher{
				langwatch.StartsWith("database."),
				langwatch.MatchRegex(regexp.MustCompile(`internal\..*`)),
			},
		}),
	),
)
```

**Filter semantics:**
- Multiple filters: AND (all must pass)
- Multiple matchers in a field: OR (any can match)
- Multiple fields in Criteria: AND (all fields must match)

**Available matchers:**
- `Equals(s)` / `EqualsIgnoreCase(s)`
- `StartsWith(prefix)` / `StartsWithIgnoreCase(prefix)`
- `MatchRegex(re)` / `MustMatchRegex(pattern)`

## OpenAI + Multi-Provider Support

### Automatic OpenAI Instrumentation

The OpenAI instrumentation automatically captures:

- ✅ **All request parameters** - Model, temperature, max tokens, etc.
- ✅ **Complete responses** - Token usage, finish reasons, response ID
- ✅ **Streaming support** - Real-time capture of streaming responses
- ✅ **Input/Output capture** - Full conversation context (when enabled)
- ✅ **Performance metrics** - Latency, first token time, throughput

### Works with Any OpenAI-Compatible Provider

The same code works with multiple AI providers that support the OpenAI API specification:

| Provider | What to Change | Example Model |
|----------|---------------|---------------|
| **OpenAI** | Nothing! | `gpt-4o` |
| **Anthropic** | Base URL + API key | `claude-3-5-sonnet-20241022` |
| **Azure OpenAI** | Base URL + API key | `gpt-4` |
| **OpenRouter** | Base URL + API key | `anthropic/claude-3.5-sonnet` |
| **Local (Ollama)** | Base URL only | `llama3.1` |

#### Example: Anthropic (Claude)

```go
client := openai.NewClient(
	option.WithBaseURL("https://api.anthropic.com/v1"),
	option.WithAPIKey(os.Getenv("ANTHROPIC_API_KEY")),
	option.WithMiddleware(otelopenai.Middleware("my-app-anthropic",
		otelopenai.WithGenAIProvider(semconv.GenAIProviderNameKey.String("anthropic")),
	)),
)
```

#### Example: Azure OpenAI

```go
client := openai.NewClient(
	option.WithBaseURL("https://your-resource.openai.azure.com/openai/deployments/your-deployment"),
	option.WithAPIKey(os.Getenv("AZURE_OPENAI_API_KEY")),
	option.WithMiddleware(otelopenai.Middleware("my-app-azure",
		otelopenai.WithGenAIProvider(semconv.GenAIProviderNameKey.String("azure.openai")),
	)),
)
```

#### Example: Local Models (Ollama)

```go
client := openai.NewClient(
	option.WithBaseURL("http://localhost:11434/v1"),
	option.WithAPIKey("not-needed"),
	option.WithMiddleware(otelopenai.Middleware("my-app-local",
		otelopenai.WithGenAIProvider(semconv.GenAIProviderNameKey.String("ollama")),
	)),
)
```

## Instrumentations

Each provider instrumentation is a **separate Go module** so that importing one
never pulls in the others' SDKs — and the core SDK (`github.com/langwatch/langwatch/sdk-go`)
has **no provider dependencies at all**. Add only the one(s) you use:

| Module | Provider SDK | Hook | What it captures |
|--------|--------------|------|------------------|
| `…/instrumentation/openai` | `github.com/openai/openai-go/v3` | `option.Middleware` | Chat / Responses / Embeddings, streaming, all token + cached/reasoning |
| `…/instrumentation/anthropic` | `github.com/anthropics/anthropic-sdk-go` | `option.Middleware` | Messages API, streaming, input/output/**cache-read + cache-creation** tokens, thinking |
| `…/instrumentation/gopenai` | `github.com/sashabaranov/go-openai` | `http.RoundTripper` | OpenAI-wire chat/embeddings (+ OpenAI-compatible providers), cached/reasoning |
| `…/instrumentation/googlegenai` | `google.golang.org/genai` | `http.RoundTripper` | Gemini generateContent (+ Vertex), streaming, cached + thoughts(reasoning) tokens |
| `…/instrumentation/bedrock` | `github.com/aws/aws-sdk-go-v2/service/bedrockruntime` | smithy-go middleware | Converse / ConverseStream / InvokeModel, cache read+write tokens, latency |
| `…/instrumentation/ollama` | `github.com/ollama/ollama/api` | `http.RoundTripper` | Native `/api/chat`/`generate`/`embed`, NDJSON streaming, eval-count tokens, durations |
| `…/instrumentation/azureopenai` | (via the openai module) | `option.Middleware` | Azure OpenAI — reuses all OpenAI capture, provider `azure.openai` |
| `…/instrumentation/genkit` | `github.com/firebase/genkit/go` | OTel-native | Exports Genkit's own flow/model/tool spans to LangWatch |

All HTTP-based instrumentations (openai, anthropic, gopenai, googlegenai) share a
lightweight base, `…/instrumentation/otelhttp`, which **passes request/response
bodies through to the caller** while capturing a bounded copy off the critical
path — so tracing adds negligible latency and memory. Every instrumentation
captures the maximum available GenAI data: request + response model, every token
type (input / output / total / cache-read / cache-creation / reasoning), cost
where the provider returns it, finish reasons, request params, system
instructions, tool definitions, and (capture-gated) input/output. Data capture
is controlled per-instrumentation via `WithDataCapture(...)` and globally via the
exporter's `langwatch.WithDataCapture(...)`. See each module's README for setup.

```go
// e.g. Anthropic — pulls in only anthropic-sdk-go + the core SDK
import (
	langwatch "github.com/langwatch/langwatch/sdk-go"
	otelanthropic "github.com/langwatch/langwatch/sdk-go/instrumentation/anthropic"
	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
)

client := anthropic.NewClient(option.WithMiddleware(otelanthropic.Middleware("my-app")))
```

## API Client SDK

Separate from tracing, [`…/sdk-go/client`](./client/) is a typed REST client for
the LangWatch API — prompts, datasets, traces, annotations, triggers, monitors,
scenarios, projects. It is generated from the OpenAPI spec with oapi-codegen and
wrapped in a hand-written, fully-documented service layer. It lives in its **own
module** so the generated code stays out of the core graph:

```go
import "github.com/langwatch/langwatch/sdk-go/client"

lw, _ := client.New(client.WithAPIKey("pat-lw-..."), client.WithProjectID("project_abc"))
prompt, err := lw.Prompts.Get(ctx, "support-greeting", &client.GetPromptOptions{Tag: "production"})
```

Auth uses the same credentials as the exporter (`sk-lw-*` keys or `pat-lw-*` PATs
with a project id). See [`client/README.md`](./client/README.md) for the full
service list, pagination, retries and typed error handling.

## Examples

### Self-Contained Examples (`examples/`)

No API keys required:

| Example | Description |
|---------|-------------|
| [`filtering/`](./examples/filtering/) | Demonstrates all filter capabilities with mock exporter |

```bash
cd examples && go run ./filtering
```

### E2E Examples (`e2e/`)

Require `LANGWATCH_API_KEY` and `OPENAI_API_KEY`:

| Example | Description |
|---------|-------------|
| [`openai-simple/`](./e2e/openai-simple/) | Basic OpenAI instrumentation |
| [`openai-filtered/`](./e2e/openai-filtered/) | Filtering spans by scope |
| [`openai-streaming/`](./e2e/openai-streaming/) | Streaming completions |
| [`openai-threads/`](./e2e/openai-threads/) | Grouping conversations |
| [`openai-responses/`](./e2e/openai-responses/) | OpenAI Responses API |
| [`custom-input-output/`](./e2e/custom-input-output/) | Recording custom data |

```bash
cd e2e
go run cmd/main.go run-example openai-simple   # Run one
go run cmd/main.go run-examples                # Run all
```

## Features

* 🔗 **Seamless OpenTelemetry integration** - Works with your existing OTel setup
* 🚀 **OpenAI instrumentation** - Automatic tracing for OpenAI API calls
* 🌐 **Multi-provider support** - OpenAI, Anthropic, Azure, local models, and more
* 📊 **Rich LLM telemetry** - Capture inputs, outputs, token usage, and model information
* 🔍 **Specialized span types** - LLM, Chain, Tool, Agent, RAG, and more
* 🧵 **Thread support** - Group related LLM interactions together
* 📝 **Custom input/output recording** - Fine-grained control over what's captured
* 🔄 **Streaming support** - Real-time capture of streaming responses
* 🎛️ **Span filtering** - Control exactly which spans are exported

## Core Concepts

### LangWatch Tracer

The `LangWatchTracer` wraps OpenTelemetry tracers to provide LangWatch-specific functionality:

```go
import langwatch "github.com/langwatch/langwatch/sdk-go"

tracer := langwatch.Tracer("my-service")
ctx, span := tracer.Start(context.Background(), "my-operation")
defer span.End()
```

### LangWatch Spans

`LangWatchSpan` embeds the standard OpenTelemetry span with additional helper methods:

All LangWatch setters return the span, so they can be chained:

```go
span.
    // Set span type for LangWatch categorization
    SetType(langwatch.SpanTypeLLM).
    // Record typed input and output (type is inferred; see typed variants below)
    SetInput("What is the capital of France?").
    SetOutput("The capital of France is Paris.").
    // Set model information
    SetRequestModel("gpt-4-turbo").
    SetResponseModel("gpt-4-turbo-2024-04-09").
    // Attach trace identity (hoisted to the trace by the server)
    SetThreadID("conversation-123").
    SetUserID("user-42").
    SetLabels("production", "qa")
```

### Span Types

LangWatch categorizes spans to provide specialized processing and visualization:

```go
langwatch.SpanTypeLLM        // LLM API calls
langwatch.SpanTypeChain      // Chain of operations
langwatch.SpanTypeTool       // Tool/function calls
langwatch.SpanTypeAgent      // Agent operations
langwatch.SpanTypeRAG        // Retrieval Augmented Generation
langwatch.SpanTypeGuardrail  // Guardrail checks
langwatch.SpanTypeEvaluation // Evaluations
langwatch.SpanTypePrompt     // Prompt rendering
langwatch.SpanTypeWorkflow   // Workflow / component / module
langwatch.SpanTypeTask       // Background tasks
langwatch.SpanTypeSpan       // Generic span (default)
```

## Advanced Features

### Recording Typed Input/Output

`SetInput` / `SetOutput` infer a value type (text, json, chat_messages, list,
…) from the Go value, or you can force one with a typed variant:

```go
// Inferred: a string becomes "text", a struct/map becomes "json".
span.SetInput("What's the weather like?")
span.SetOutput(response.Choices[0].Message.Content)

// Explicit value types when you want control:
span.SetInputJSON(map[string]any{"query": "weather", "units": "metric"})
span.SetOutputChatMessages([]langwatch.ChatMessage{
    langwatch.TextMessage(langwatch.ChatRoleAssistant, "It's sunny."),
})
```

#### Multimodal / binary attachments ("data content")

Binary parts carry audio/image/video/file attachments inside a chat message.
Inline bytes are externalised to a stored object by the ingest pipeline:

```go
span.SetInputChatMessages([]langwatch.ChatMessage{
    langwatch.MultiContentMessage(langwatch.ChatRoleUser,
        langwatch.TextPart("What is in this image?"),
        langwatch.BinaryPart("image/png", pngBytes, "screenshot.png"), // inline base64
        // or reference an already-hosted file / stored object:
        // langwatch.BinaryURLPart("audio/mpeg", "https://example.com/a.mp3"),
        // langwatch.BinaryRefPart("application/pdf", "file-123"),
    ),
})
```

### Recording Metrics

Token counts are recorded via `SetGenAIUsage` (the OTel-native `gen_ai.usage.*`
attributes); `SetMetrics` carries only the cost + estimated-flag rollup:

```go
span.SetGenAIUsage(langwatch.GenAIUsage{
    InputTokens:  langwatch.Int(120),
    OutputTokens: langwatch.Int(48),
    TotalTokens:  langwatch.Int(168),
})

span.SetMetrics(langwatch.SpanMetrics{
    Cost: langwatch.Float64(0.0021),
})
```

### Recording Metadata (hoisted to the trace)

Reserved keys (`thread_id`, `user_id`, `customer_id`, `labels`) become trace
identity; every other key is hoisted as a `metadata.<key>` trace attribute:

```go
span.SetMetadata(map[string]any{
    "thread_id": "conversation-123",
    "user_id":   "user-42",
    "labels":    []string{"production"},
    "feature":   "checkout",
})
```

### Recording RAG Context

For Retrieval Augmented Generation operations:

```go
chunks := []langwatch.SpanRAGContextChunk{
	{DocumentID: "doc1", ChunkID: "chunk1", Content: "Relevant context..."},
	{DocumentID: "doc2", ChunkID: "chunk2", Content: "More context..."},
}
span.SetRAGContexts(chunks)
```

### Custom Timestamps

Record precise timing information:

```go
firstTokenAt := firstTokenTime.UnixMilli()
span.SetTimestamps(langwatch.SpanTimestamps{
	StartedAtUnix:    startTime.UnixMilli(),
	FirstTokenAtUnix: &firstTokenAt,
	FinishedAtUnix:   endTime.UnixMilli(),
})
```

### Thread Management

Group related interactions into conversations:

```go
threadID := "user-session-123"
span.SetThreadID(threadID)
```

## API Reference

### Exporter

```go
// Create exporter (reads LANGWATCH_API_KEY and LANGWATCH_ENDPOINT from env)
langwatch.NewExporter(ctx, opts...)

// Create with default ExcludeHTTPRequests filter
langwatch.NewDefaultExporter(ctx, opts...)

// Options
langwatch.WithAPIKey(key string)
langwatch.WithEndpoint(url string)
langwatch.WithFilters(filters ...Filter)
langwatch.WithDataCapture(mode DataCaptureMode)            // none | input | output | all
langwatch.WithDataCaptureFunc(predicate DataCapturePredicate)

// Wrap any exporter with filtering
langwatch.NewFilteringExporter(wrapped, filters...)
```

### Data Capture

Data capture controls whether span **input/output content** leaves the process.
It is enforced at export time, so one setting governs every instrumentation
(the OpenAI middleware, manual spans, …). Span structure, metrics, metadata,
models and identity are always kept; only the content attributes
(`langwatch.input`/`output` and the `gen_ai.*` message/prompt/completion
equivalents) are stripped. The default, unconfigured, captures everything.

```go
// Fixed mode for all spans
exporter, _ := langwatch.NewExporter(ctx, langwatch.WithDataCapture(langwatch.DataCaptureNone))

// Or decide per span from its type / name / attributes
exporter, _ := langwatch.NewExporter(ctx, langwatch.WithDataCaptureFunc(
	func(c langwatch.DataCaptureContext) langwatch.DataCaptureMode {
		if c.SpanType == "tool" {
			return langwatch.DataCaptureNone // never capture tool I/O
		}
		return langwatch.DataCaptureAll
	},
))
```

### Filters

```go
// Presets
langwatch.ExcludeHTTPRequests()  // Remove GET/POST/etc spans
langwatch.LangWatchOnly()        // Keep only LangWatch instrumentation

// Custom
langwatch.Include(criteria)      // Keep matching spans
langwatch.Exclude(criteria)      // Remove matching spans

// Criteria
langwatch.Criteria{
	ScopeName: []Matcher{...},   // Match InstrumentationScope.Name
	SpanName:  []Matcher{...},   // Match Span.Name
}

// Matchers
langwatch.Equals(s)
langwatch.EqualsIgnoreCase(s)
langwatch.StartsWith(prefix)
langwatch.StartsWithIgnoreCase(prefix)
langwatch.MatchRegex(re)
langwatch.MustMatchRegex(pattern)
```

### LangWatchSpan Methods

The `*Span` embeds the standard `go.opentelemetry.io/otel/trace.Span`, so you can use all standard OpenTelemetry span methods. The LangWatch helpers below all return the span for chaining.

**Input/Output (`langwatch.input` / `langwatch.output`):**
- `SetInput(input any)` / `SetOutput(output any)` - Records a value, inferring the type (text, json, chat_messages, list, …)
- `SetInputText` / `SetOutputText` - Force the `text` type
- `SetInputJSON` / `SetOutputJSON` - Force the `json` type
- `SetInputChatMessages` / `SetOutputChatMessages` - Force `chat_messages` (`[]langwatch.ChatMessage`)
- `SetInputRaw` / `SetOutputRaw` - Force the `raw` type
- `SetInputList` / `SetOutputList` - Force a `list` of nested typed values
- `SetInputGuardrailResult` / `SetOutputGuardrailResult` and `…EvaluationResult` - Record an `EvaluationResult`
- `SetInputTyped` / `SetOutputTyped` - Record an explicit `langwatch.TypedValue`

**Metrics, metadata & identity:**
- `SetMetrics(metrics SpanMetrics)` - Cost and `tokens_estimated` flag (`langwatch.metrics`); token counts go via `SetGenAIUsage`
- `SetMetadata(metadata map[string]any)` - Metadata blob hoisted to the trace (`langwatch.metadata`)
- `SetThreadID` / `SetUserID` / `SetCustomerID` / `SetLabels(...string)` - Reserved trace identity
- `SetParams(params map[string]any)` - LLM invocation parameters (`langwatch.params`)
- `SetSelectedPrompt(prompt SelectedPrompt)` - Attach a saved prompt to the trace

**Model, provider & GenAI (handy for manual instrumentation):**
- `SetRequestModel(model string)` - `gen_ai.request.model`
- `SetResponseModel(model string)` - `gen_ai.response.model`
- `SetGenAIProvider(provider string)` - `gen_ai.provider.name`
- `SetGenAIOperation(op string)` - `gen_ai.operation.name`
- `SetGenAIRequestParams(GenAIRequestParams)` - temperature, top_p, max_tokens, stop, reasoning_effort, … (`gen_ai.request.*`)
- `SetGenAIUsage(GenAIUsage)` - input/output/total/cached/reasoning tokens (`gen_ai.usage.*`)
- `SetGenAIResponseFinishReasons(...string)` - `gen_ai.response.finish_reasons`

**Categorization & context:**
- `SetType(spanType SpanType)` - Span type for LangWatch processing
- `SetRAGContexts(contexts []SpanRAGContextChunk)` / `SetRAGContext(context)` - RAG context (`langwatch.rag.contexts`)
- `SetTimestamps(timestamps SpanTimestamps)` - Fine-grained timing

**Multimodal content helpers:**
- `TextMessage`, `MultiContentMessage` - Build `ChatMessage` values
- `TextPart`, `ImageURLPart`, `BinaryPart`, `BinaryURLPart`, `BinaryRefPart` - Build `ChatRichContent` parts (incl. binary attachments)

**Tracer:**
- `tracer.WithActiveSpan(ctx, name, fn)` - Run `fn` with a span that auto-ends and records error status

## Environment Variables

```bash
# Required for LangWatch
export LANGWATCH_API_KEY="your-langwatch-api-key"

# Optional: custom endpoint
export LANGWATCH_ENDPOINT="https://custom.langwatch.ai"

# For OpenAI
export OPENAI_API_KEY="your-openai-api-key"

# For other providers
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export AZURE_OPENAI_API_KEY="your-azure-openai-api-key"
```

## Manual OpenTelemetry Setup

If you prefer manual setup or need more control:

```go
import (
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
)

func setupLangWatch(ctx context.Context, apiKey string) func() {
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL("https://app.langwatch.ai/api/otel/v1/traces"),
		otlptracehttp.WithHeaders(map[string]string{
			"Authorization": "Bearer " + apiKey,
		}),
	)
	if err != nil {
		log.Fatalf("failed to create OTLP exporter: %v", err)
	}

	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
	otel.SetTracerProvider(tp)

	return func() {
		tp.Shutdown(ctx)
	}
}
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](../CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
