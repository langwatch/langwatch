# genkit

This package exports [Firebase Genkit](https://github.com/firebase/genkit) Go
traces to LangWatch.

Genkit is **OpenTelemetry-native**: it already emits its own `gen_ai.*` spans for
flows, models and tools onto the global OpenTelemetry tracer provider. This
package does **no body parsing** — it builds a LangWatch span exporter, wraps it
in a batching span processor, and registers that processor on the tracer
provider Genkit's spans flow through. The model, token-usage, prompt/completion
and tool data captured in LangWatch is exactly whatever Genkit emits.

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/instrumentation/genkit
```

## Usage

Set your environment variables:

```bash
export LANGWATCH_API_KEY="your-langwatch-api-key"
```

Then register LangWatch once, after `genkit.Init`:

```go
package main

import (
	"context"
	"log"

	"github.com/firebase/genkit/go/genkit"
	"github.com/firebase/genkit/go/plugins/googlegenai"

	lwgenkit "github.com/langwatch/langwatch/sdk-go/instrumentation/genkit"
)

func main() {
	ctx := context.Background()

	g := genkit.Init(ctx, genkit.WithPlugins(&googlegenai.GoogleAI{}))

	// Export Genkit's OTEL spans to LangWatch (reads LANGWATCH_API_KEY from env).
	if err := lwgenkit.RegisterLangWatch(g); err != nil {
		log.Fatalf("failed to register LangWatch: %v", err)
	}

	// Define and run flows as usual — their spans are now exported to LangWatch.
}
```

`RegisterLangWatch` reads `LANGWATCH_API_KEY` (and `LANGWATCH_ENDPOINT`) from the
environment by default. The `*genkit.Genkit` argument makes the call read
naturally at the setup site; the processor is registered on the OpenTelemetry
tracer provider Genkit uses.

## Configuration

`RegisterLangWatch(g, opts...)` and `SpanProcessor(opts...)` accept:

- `WithExporterOptions(...langwatch.ExporterOption)` — forwards options to
  `langwatch.NewExporter`, e.g. `langwatch.WithAPIKey`, `langwatch.WithEndpoint`,
  `langwatch.WithDataCapture` and `langwatch.WithFilters`.
- `WithContext(ctx)` — context used when constructing the exporter (defaults to
  `context.Background()`).
- `WithSpanProcessor(sp)` — register a custom `sdktrace.SpanProcessor` instead of
  the default LangWatch batching processor. When set, `WithContext` and
  `WithExporterOptions` are ignored.

```go
lwgenkit.RegisterLangWatch(g,
	lwgenkit.WithExporterOptions(
		langwatch.WithAPIKey("sk-lw-..."),
		langwatch.WithDataCapture(langwatch.DataCaptureNone), // structure/metrics only
	),
)
```

## Managing your own tracer provider

If you build your own `sdktrace.TracerProvider`, use `SpanProcessor` to obtain the
processor and register it yourself:

```go
sp, err := lwgenkit.SpanProcessor(lwgenkit.WithExporterOptions(langwatch.WithAPIKey("...")))
if err != nil {
	log.Fatal(err)
}
tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
otel.SetTracerProvider(tp) // Genkit reads the global tracer provider
```

## Data capture

LangWatch captures whatever `gen_ai.*` attributes Genkit records — there is no
extra parsing in this package. To strip input/output **content** (keeping span
structure, models, token usage and metadata), set a data-capture mode on the
exporter:

```go
lwgenkit.RegisterLangWatch(g,
	lwgenkit.WithExporterOptions(langwatch.WithDataCapture(langwatch.DataCaptureNone)),
)
```

See the [main SDK README](../../README.md) for filtering and data-capture details.
