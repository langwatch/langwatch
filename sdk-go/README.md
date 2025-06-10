# LangWatch Go SDK

The Go SDK for tracing and evaluating LLM applications using [LangWatch](https://langwatch.ai).

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

	"github.com/openai/openai-go"
	oaioption "github.com/openai/openai-go/option"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func main() {
	ctx := context.Background()
	
	// 🔸 First - setup LangWatch tracing
	setupLangWatch(ctx)

	// 🔸 Second - add the middleware to your OpenAI client
	client := openai.NewClient(
		oaioption.WithAPIKey(os.Getenv("OPENAI_API_KEY")),
		oaioption.WithMiddleware(otelopenai.Middleware("my-app",
			otelopenai.WithCaptureInput(),
			otelopenai.WithCaptureOutput(),
		)),
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

	// 🎉 View your traces at https://app.langwatch.ai
}

func setupLangWatch(ctx context.Context) {
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL("https://app.langwatch.ai/api/otel/v1/traces"),
		otlptracehttp.WithHeaders(map[string]string{
			"Authorization": "Bearer " + os.Getenv("LANGWATCH_API_KEY"),
		}),
	)
	if err != nil {
		log.Fatalf("failed to create OTLP exporter: %v", err)
	}

	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
	otel.SetTracerProvider(tp)
}
```

**That's it!** 🎉 Your LLM interactions are now being traced and will appear in your [LangWatch dashboard](https://app.langwatch.ai).

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
| **OpenAI** | Nothing! | `gpt-4o-mini` |
| **Anthropic** | Base URL + API key | `claude-3-5-sonnet-20241022` |
| **Azure OpenAI** | Base URL + API key | `gpt-4` |
| **OpenRouter** | Base URL + API key | `anthropic/claude-3.5-sonnet` |
| **Local (Ollama)** | Base URL only | `llama3.1` |

#### Example: Anthropic (Claude)

```bash
export ANTHROPIC_API_KEY="your-anthropic-api-key"
```

```go
import (
	"github.com/openai/openai-go"
	"github.com/openai/openai-go/option"
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
	"go.opentelemetry.io/otel/semconv/v1.30.0"
)

client := openai.NewClient(
	option.WithBaseURL("https://api.anthropic.com/v1"),
	option.WithAPIKey(os.Getenv("ANTHROPIC_API_KEY")),
	option.WithMiddleware(otelopenai.Middleware("my-app-anthropic",
		otelopenai.WithCaptureInput(),
		otelopenai.WithCaptureOutput(),
		otelopenai.WithGenAISystem(semconv.GenAISystemKey.String("anthropic")),
	)),
)

response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
	Model: openai.ChatModel("claude-3-5-sonnet-20241022"),
	Messages: []openai.ChatCompletionMessageParamUnion{
		openai.UserMessage("Hello, Claude!"),
	},
})
```

#### Example: Azure OpenAI

```bash
export AZURE_OPENAI_API_KEY="your-azure-openai-api-key"
```

```go
client := openai.NewClient(
	option.WithBaseURL("https://your-resource.openai.azure.com/openai/deployments/your-deployment"),
	option.WithAPIKey(os.Getenv("AZURE_OPENAI_API_KEY")),
	option.WithMiddleware(otelopenai.Middleware("my-app-azure",
		otelopenai.WithCaptureInput(),
		otelopenai.WithCaptureOutput(),
		otelopenai.WithGenAISystem(semconv.GenAISystemKey.String("azure.openai")),
	)),
)
```

#### Example: Local Models (Ollama)

```go
client := openai.NewClient(
	option.WithBaseURL("http://localhost:11434/v1"),
	option.WithAPIKey("not-needed"), // Ollama doesn't require API key
	option.WithMiddleware(otelopenai.Middleware("my-app-local",
		otelopenai.WithCaptureInput(),
		otelopenai.WithCaptureOutput(),
		otelopenai.WithGenAISystem(semconv.GenAISystemKey.String("ollama")),
	)),
)
```

## Examples & Use Cases

Explore real working examples in the [`examples/`](./examples/) directory:

| Example | What It Shows | Run It |
|---------|---------------|---------|
| **[`simple/`](./examples/simple/)** | Basic OpenAI instrumentation | `go run cmd/main.go run-example simple` |
| **[`custom-input-output/`](./examples/custom-input-output/)** | Recording custom data | `go run cmd/main.go run-example custom-input-output` |
| **[`streaming/`](./examples/streaming/)** | Streaming completions | `go run cmd/main.go run-example streaming` |
| **[`threads/`](./examples/threads/)** | Grouping conversations | `go run cmd/main.go run-example threads` |
| **[`filtered-spans/`](./examples/filtered-spans/)** | Filtering what gets traced | `go run cmd/main.go run-example filtered-spans` |

Run all examples:
```bash
cd examples/
go run cmd/main.go run-examples
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
* 🎯 **Zero-config setup** - Works out of the box with minimal setup

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

```go
// Set span type for LangWatch categorization
span.SetType(langwatch.SpanTypeLLM)

// Record input and output
span.RecordInputString("What is the capital of France?")
span.RecordOutputString("The capital of France is Paris.")

// Set model information
span.SetRequestModel("gpt-4-turbo")
span.SetResponseModel("gpt-4-turbo-2024-04-09")

// Group related spans
span.SetThreadID("conversation-123")
```

### Span Types

LangWatch categorizes spans to provide specialized processing and visualization:

```go
langwatch.SpanTypeLLM      // LLM API calls
langwatch.SpanTypeChain    // Chain of operations
langwatch.SpanTypeTool     // Tool/function calls
langwatch.SpanTypeAgent    // Agent operations
langwatch.SpanTypeRAG      // Retrieval Augmented Generation
langwatch.SpanTypeQuery    // Database queries
langwatch.SpanTypeRetrieval // Document retrieval
```

## Advanced Features

### Recording Custom Input/Output

For fine-grained control over what's captured:

```go
// Record custom user input
userMessage := "What's the weather like?"
span.RecordInputString(userMessage)

// Make your LLM call here...

// Record the response you want to show in LangWatch
span.RecordOutputString(response.Choices[0].Message.Content)
```

### Recording RAG Context

For Retrieval Augmented Generation operations:

```go
chunks := []langwatch.SpanRAGContextChunk{
	{DocumentID: "doc1", ChunkID: "chunk1", Content: "Relevant context..."},
	{DocumentID: "doc2", ChunkID: "chunk2", Content: "More context..."},
}
span.SetRAGContextChunks(chunks)
```

### Custom Timestamps

Record precise timing information:

```go
span.SetTimestamps(langwatch.SpanTimestamps{
	StartedAtUnix:    startTime.UnixMilli(),
	FirstTokenAtUnix: &firstTokenTime.UnixMilli(),
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

The `LangWatchSpan` embeds the standard `go.opentelemetry.io/otel/trace.Span`, so you can use all standard OpenTelemetry span methods. In addition, it provides these LangWatch-specific helper methods:

### Input/Output Recording

- **`RecordInput(input any)`** - Records structured input (JSON-serialized)
- **`RecordInputString(input string)`** - Records raw string input  
- **`RecordOutput(output any)`** - Records structured output (JSON-serialized)
- **`RecordOutputString(output string)`** - Records raw string output

### Model Information

- **`SetRequestModel(model string)`** - Model used for request (e.g., "gpt-4-turbo")
- **`SetResponseModel(model string)`** - Model that generated response

### Categorization

- **`SetType(spanType SpanType)`** - Span type for LangWatch processing
- **`SetThreadID(threadID string)`** - Groups related spans together

### Advanced Features

- **`SetTimestamps(timestamps SpanTimestamps)`** - Fine-grained timing information
- **`SetRAGContextChunks(contexts []SpanRAGContextChunk)`** - RAG context chunks
- **`SetRAGContextChunk(context SpanRAGContextChunk)`** - Single RAG chunk

## Configuration Options

### OpenAI Middleware Options

```go
import (
	"github.com/openai/openai-go"
	oaioption "github.com/openai/openai-go/option"
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
	"go.opentelemetry.io/otel/semconv/v1.30.0"
)

client := openai.NewClient(
	oaioption.WithAPIKey(apiKey),
	oaioption.WithMiddleware(otelopenai.Middleware("my-app",
		// Capture full input/output (be mindful of sensitive data)
		otelopenai.WithCaptureInput(),
		otelopenai.WithCaptureOutput(),
		
		// For OpenAI-compatible APIs (Azure, etc.)
		// otelopenai.WithGenAISystem(semconv.GenAISystemKey.String("azure.openai")),
		
		// Custom tracer provider  
		// otelopenai.WithTracerProvider(customProvider),
	)),
)
```

### Environment Variables

```bash
# Required for LangWatch
export LANGWATCH_API_KEY="your-langwatch-api-key"

# Required for OpenAI examples  
export OPENAI_API_KEY="your-openai-api-key"

# For Anthropic (when using OpenAI-compatible API)
export ANTHROPIC_API_KEY="your-anthropic-api-key"

# For Azure OpenAI
export AZURE_OPENAI_API_KEY="your-azure-openai-api-key"
```

## Manual OpenTelemetry Setup

If you prefer to set up OpenTelemetry manually or need more control:

```go
import (
	"context"
	"log"
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

	// Return cleanup function
	return func() {
		if err := tp.Shutdown(ctx); err != nil {
			log.Printf("Error shutting down tracer provider: %v", err)
		}
	}
}
```

## Contributing

We welcome contributions! Please see our [Contributing Guide](../CONTRIBUTING.md) for details.

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
