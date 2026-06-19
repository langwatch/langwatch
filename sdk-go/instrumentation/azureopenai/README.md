# azureopenai

OpenTelemetry instrumentation for **Azure OpenAI** accessed through the official
`openai-go` client's `azure` subpackage
(`github.com/openai/openai-go/v3/azure`).

This module is a thin convenience wrapper over the LangWatch
[`openai`](../openai) instrumentation. Azure OpenAI speaks the same wire
protocol as OpenAI, and the OpenAI middleware already understands Azure
deployment paths (`/openai/deployments/{deployment-id}/{operation}`). The only
thing this wrapper changes is the default `gen_ai.provider.name`, which it sets
to `azure.openai` so traces are attributed to Azure rather than OpenAI.

Because it delegates to the OpenAI instrumentation, **all of OpenAI's
chat/responses/embeddings capture applies unchanged** — request/response
content, token usage (including cached and reasoning tokens), finish reasons and
streaming reconstruction. See the [`openai` README](../openai/README.md) for the
full list of collected attributes and streaming behaviour.

## Installation

```bash
go get github.com/langwatch/langwatch/sdk-go/instrumentation/azureopenai
```

## Usage

Set your environment variables:

```bash
export LANGWATCH_API_KEY="your-langwatch-api-key"
export AZURE_OPENAI_ENDPOINT="https://<your-resource>.openai.azure.com"
export AZURE_OPENAI_API_KEY="your-azure-openai-api-key"
```

Build the Azure client with the `azure` connection options and wire in
`azureopenai.Middleware` via `option.WithMiddleware`:

```go
package main

import (
	"context"
	"log"
	"os"

	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/azure"
	"github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	azureopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/azureopenai"
)

func main() {
	ctx := context.Background()

	// Setup the LangWatch exporter (reads LANGWATCH_API_KEY from env).
	exporter, err := langwatch.NewExporter(ctx)
	if err != nil {
		log.Fatalf("failed to create LangWatch exporter: %v", err)
	}
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter))
	otel.SetTracerProvider(tp)
	defer tp.Shutdown(ctx)

	// Create an instrumented Azure OpenAI client. The provider is recorded as
	// "azure.openai"; by default the middleware captures both input and output.
	const apiVersion = "2024-06-01"
	client := openai.NewClient(
		azure.WithEndpoint(os.Getenv("AZURE_OPENAI_ENDPOINT"), apiVersion),
		azure.WithAPIKey(os.Getenv("AZURE_OPENAI_API_KEY")),
		// Or authenticate with an Azure Identity TokenCredential:
		// azure.WithTokenCredential(tokenCredential),
		option.WithMiddleware(azureopenai.Middleware("my-app")),
	)

	// Call as usual. The Model is your Azure *deployment* name; the azure
	// subpackage rewrites the request path to
	// /openai/deployments/{deployment}/chat/completions.
	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: "my-gpt4o-deployment",
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, Azure OpenAI!"),
		},
	})
	if err != nil {
		log.Fatalf("Chat completion failed: %v", err)
	}

	log.Printf("Chat completion completed: %v\n", response)
}
```

## Configuration Options

`Middleware` takes a required instrumentor name (string) to identify your
application, followed by optional configuration:

- `WithGenAIProvider(provider attribute.KeyValue)`: overrides the
  `gen_ai.provider.name` attribute. This module defaults it to `azure.openai`;
  pass this option to set something else (the override wins over the default).
- `WithTracerProvider(provider oteltrace.TracerProvider)`: specifies the OTel
  `TracerProvider`. Defaults to the global provider.
- `WithDataCapture(mode langwatch.DataCaptureMode)`: controls whether request
  (input) and response (output) content is recorded. Defaults to
  `langwatch.DataCaptureAll`.

These are re-exported from the [`openai`](../openai) instrumentation so you do
not need to import that module directly. For data-capture semantics and the
full attribute list, see the [`openai` README](../openai/README.md).
