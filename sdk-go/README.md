# langwatch

The Go SDK for tracing and evaluating LLM applications using [LangWatch](https://langwatch.ai).

## Features

* Seamless integration with OpenTelemetry.
* Specialized `LangWatchTracer` for creating LangWatch-enhanced spans.
* `LangWatchSpan` with helper methods to easily record LLM-specific attributes (inputs, outputs, token counts, models, RAG context, etc.).
* Typed `SpanType` for classifying spans within LangWatch.

## Getting Started

### Prerequisites

* Go (version 1.18 or later recommended)
* An OpenTelemetry-compatible backend to send your traces to, such as [LangWatch](https://langwatch.ai) or [Grafana ](https://grafana.com/)

### Installation

First, get the necessary OpenTelemetry and LangWatch packages:

```bash
go get go.opentelemetry.io/otel \
       go.opentelemetry.io/otel/sdk \
       go.opentelemetry.io/otel/trace \
       github.com/langwatch/langwatch/go-sdk
```

### Using the LangWatch SDK

Once OpenTelemetry is set up (see Appendix if you haven't done this yet), you can obtain a `LangWatchTracer`. This tracer is a wrapper around the standard OpenTelemetry tracer but ensures that started spans are `LangWatchSpan` instances, giving you access to specialized methods.

```go
import (
	"context"
	"go.opentelemetry.io/otel/trace"
	langwatch "github.com/langwatch/langwatch/go-sdk"
)

func main() {
	// Setup OpenTelemetry

	// Get a LangWatchTracer instance
	// It's recommended to use a descriptive name for your tracer, such as the package path/name
	tracer := langwatch.Tracer("github.com/my/package/main.main")

	// Start a new span
	ctx, span := tracer.Start(context.Background(), "myLlmOperation")
	defer span.End() // Always remember to end your spans!

	// span is a *langwatch.LangWatchSpan, it contains an enriched OpenTelemetry Span,
	// with LangWatch-specific helper methods

	// ... do your operation ...
}
```

### Working with LangWatch Spans

The `LangWatchSpan` (from `libraries/langwatch/span.go`) embeds the standard `go.opentelemetry.io/otel/trace.Span`, so you can use all the standard OpenTelemetry span methods. In addition, it provides several helper methods to easily set LangWatch-specific attributes. These attributes help LangWatch understand and display your LLM interactions more effectively.

Here are the key methods provided by `LangWatchSpan`:

- **`SetType(spanType SpanType)`**:
    Sets the type of the span, which LangWatch uses for categorization and specialized processing. `SpanType` is an enum with predefined values like `SpanTypeLLM`, `SpanTypeChain`, `SpanTypeTool`, `SpanTypeAgent`, `SpanTypeRAG`, etc.
    ```go
    span.SetType(langwatch.SpanTypeLLM)
    ```

- **`RecordInput(input any)`**:
    Records the input to the operation represented by the span. The input is marshalled to JSON.
    ```go
    userInput := map[string]string{"prompt": "Translate 'hello' to French."}
    span.RecordInput(userInput)
    ```

- **`RecordInputString(input string)`**:
    Records a raw string as input to the operation represented by the span.
    ```go
    userInputString := "Translate 'hello' to French."
    span.RecordInputString(userInputString)
    ```

- **`RecordOutput(output any)`**:
    Records the output of the operation. The output is marshalled to JSON.
    ```go
    llmResponse := map[string]string{"translation": "Bonjour"}
    span.RecordOutput(llmResponse)
    ```

- **`RecordOutputString(output string)`**:
    Records a raw string as output of the operation.
    ```go
    llmResponseString := "Bonjour"
    span.RecordOutputString(llmResponseString)
    ```

- **`SetRequestModel(model string)`**:
    Sets the model name used for a request (e.g., "gpt-4", "claude-3-opus"). This uses the semantic convention key `gen_ai.request.model`.
    ```go
    span.SetRequestModel("gpt-4-turbo")
    ```

- **`SetResponseModel(model string)`**:
    Sets the model name that generated the response. This uses the semantic convention key `gen_ai.response.model`.
    ```go
    span.SetResponseModel("gpt-4-turbo-2024-04-09")
    ```

- **`SetTimestamps(timestamps SpanTimestamps)`**:
    Records fine-grained timestamps for the operation, such as when the first token was received. `SpanTimestamps` is a struct:
    ```go
    type SpanTimestamps struct {
        StartedAtUnix    int64  `json:"started_at"`      // Unix timestamp (seconds or milliseconds)
        FirstTokenAtUnix *int64 `json:"first_token_at"`  // Unix timestamp for first token
        FinishedAtUnix   int64  `json:"finished_at"`     // Unix timestamp
    }
    ```
    Example:
    ```go
    // Timestamps should be in Unix epoch (e.g., time.Now().UnixMilli())
    // These are often set automatically by LangWatch if not provided,
    // but can be set manually for more precise control or when
    // integrating with systems that provide these timings.
    // span.SetTimestamps(langwatch.SpanTimestamps{...})
    ```

- **`SetRAGContextChunks(contexts []SpanRAGContextChunk)`**:
    Records the context chunks used in a Retrieval Augmented Generation (RAG) operation. `SpanRAGContextChunk` is a struct:
    ```go
    type SpanRAGContextChunk struct {
        DocumentID string `json:"document_id"`
        ChunkID    string `json:"chunk_id"`
        Content    any    `json:"content"`
    }
    ```
    Example:
    ```go
    chunks := []langwatch.SpanRAGContextChunk{
        {DocumentID: "doc1", ChunkID: "chunkA", Content: "Some relevant text..."},
        {DocumentID: "doc2", ChunkID: "chunkB", Content: "More relevant text..."},
    }
    span.SetRAGContextChunks(chunks)
    ```

- **`SetRAGContextChunk(context SpanRAGContextChunk)`**:
    A convenience method to record a single RAG context chunk.
    ```go
    chunk := langwatch.SpanRAGContextChunk{DocumentID: "doc3", ChunkID: "chunkC", Content: "Another piece of context."}
    span.SetRAGContextChunk(chunk)
    ```

## Appendix: Setting up OpenTelemetry for Tracing

To use `langwatch`, you first need to set up the OpenTelemetry SDK in your application. This involves configuring a tracer provider and registering it globally. The tracer provider will be responsible for creating tracers and processing the spans they generate.

Here's a minimal setup for tracing. You'll need to choose and configure an exporter that sends your trace data to your telemetry backend.

```go
package main

import (
	"context"
	"log"
	"os"
	"os/signal"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace" // Example: stdout exporter
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
)

// newExporter creates a new trace exporter.
// Replace this with your desired exporter (e.g., OTLP).
func newExporter(ctx context.Context) (sdktrace.SpanExporter, error) {
	return stdouttrace.New(stdouttrace.WithPrettyPrint())
}

// newTraceProvider creates a new tracer provider.
func newTraceProvider(exp sdktrace.SpanExporter) *sdktrace.TracerProvider {
	// Ensure default SDK resources and any custom resources are attributes on traces.
	r, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String("your-llm-app-name"), // Set your service name
		),
	)

	if err != nil {
		panic(err)
	}

	return sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(r),
	)
}

func main() {
	ctx := context.Background()

	// Configure the exporter
	exporter, err := newExporter(ctx)
	if err != nil {
		log.Fatalf("failed to create exporter: %v", err)
	}

	// Create and register the TracerProvider
	tp := newTraceProvider(exporter)
	otel.SetTracerProvider(tp)

	// Cleanly shutdown and flush telemetry when the application exits.
	defer func() {
		if err := tp.Shutdown(ctx); err != nil {
			log.Fatalf("failed to shutdown TracerProvider: %v", err)
		}
	}()

	// ... Your application code using LangWatch tracer will go here ...

	log.Println("Application started. Tracing initialized.")

	// ... Your application code using LangWatch tracer will go here ...
}

```

**Note**: The example above uses a `stdouttrace` exporter, which prints traces to the console. For production, you should configure an OTLP exporter or another exporter suitable for your backend.

For a comprehensive guide on setting up OpenTelemetry in Go, including different exporters, sampling, and other configurations, please refer to the official OpenTelemetry Go Getting Started guide: [https://opentelemetry.io/docs/languages/go/getting-started/](https://opentelemetry.io/docs/languages/go/getting-started/)

### Full Example (with OpenTelemetry Setup)

This example demonstrates initializing OpenTelemetry and then using the LangWatch SDK.

```go
package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"time"

	langwatch "github.com/langwatch/langwatch/go-sdk"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/stdout/stdouttrace"
	"go.opentelemetry.io/otel/sdk/resource"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	semconv "go.opentelemetry.io/otel/semconv/v1.26.0"
	"go.opentelemetry.io/otel/trace"
)

// (Re-use newExporter and newTraceProvider from the setup section above)
func newExporter(ctx context.Context) (sdktrace.SpanExporter, error) {
	return stdouttrace.New(stdouttrace.WithPrettyPrint())
}

func newTraceProvider(exp sdktrace.SpanExporter) *sdktrace.TracerProvider {
	r, err := resource.Merge(
		resource.Default(),
		resource.NewWithAttributes(
			semconv.SchemaURL,
			semconv.ServiceNameKey.String("example-llm-service"),
		),
	)
	if err != nil {
		panic(err)
	}
	return sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exp),
		sdktrace.WithResource(r),
	)
}


func main() {
	ctx := context.Background()

	exporter, err := newExporter(ctx)
	if err != nil {
		log.Fatalf("failed to create exporter: %v", err)
	}
	tp := newTraceProvider(exporter)
	otel.SetTracerProvider(tp)
	defer func() {
		if err := tp.Shutdown(ctx); err != nil {
			log.Fatalf("failed to shutdown TracerProvider: %v", err)
		}
	}()

	// Get LangWatch Tracer
	tracer := langwatch.Tracer("app.feature.translation", trace.WithInstrumentationVersion("v0.1.0"))

	// Simulate an LLM operation
	processTranslationRequest(ctx, tracer, "Hello")

	log.Println("Application finished. Traces should be exported.")

	// For demonstration, wait a bit for batch processor to export
	time.Sleep(2 * time.Second)
}

func processTranslationRequest(ctx context.Context, tracer *langwatch.LangWatchTracer, textToTranslate string) {
	var span *langwatch.LangWatchSpan
	ctx, span = tracer.Start(ctx, "translateTextToFrench")
	defer span.End()

	span.SetType(langwatch.SpanTypeLLM)
	span.SetRequestModel("simulated-translation-model-v1")

	// Record input
	input := map[string]string{"text": textToTranslate, "target_language": "French"}
	span.RecordInput(input)

	// Simulate work & getting a response
	time.Sleep(100 * time.Millisecond) // Simulate API call
	translatedText := "Bonjour"       // Simulated LLM response
	firstTokenTime := time.Now().UnixMilli() - 50 // Simulated timestamp

	// Record output
	output := map[string]string{"translation": translatedText}
	span.RecordOutput(output)

	// Record timestamps
	span.SetTimestamps(langwatch.SpanTimestamps{
		StartedAtUnix:    time.Now().Add(-100 * time.Millisecond).UnixMilli(), // Approximate
		FirstTokenAtUnix: &firstTokenTime,
		FinishedAtUnix:   time.Now().UnixMilli(),
	})

	span.SetAttribute("custom.annotation", "This was a successful translation")
	log.Printf("Translated '%s' to '%s'\n", textToTranslate, translatedText)
}

```

This comprehensive example demonstrates initializing OpenTelemetry, getting a `LangWatchTracer`, starting a `LangWatchSpan`, and using its various methods to record detailed information about an LLM operation.
