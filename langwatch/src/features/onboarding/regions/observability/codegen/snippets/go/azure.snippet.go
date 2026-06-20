package main

import (
	"context"
	"log"
	"os"

	langwatch "github.com/langwatch/langwatch/sdk-go"                               // +
	azureopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/azureopenai" // +
	"github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/azure"
	"github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel"                    // +
	sdktrace "go.opentelemetry.io/otel/sdk/trace" // +
)

func main() {
	ctx := context.Background()

	// Setup LangWatch tracing (reads LANGWATCH_API_KEY from env) // +
	exporter, err := langwatch.NewExporter(ctx) // +
	if err != nil {                             // +
		log.Fatalf("failed to create LangWatch exporter: %v", err) // +
	} // +
	tp := sdktrace.NewTracerProvider(sdktrace.WithBatcher(exporter)) // +
	otel.SetTracerProvider(tp)                                       // +
	defer tp.Shutdown(ctx)                                           // +

	const apiVersion = "2024-06-01"
	client := openai.NewClient(
		azure.WithEndpoint(os.Getenv("AZURE_OPENAI_ENDPOINT"), apiVersion),
		azure.WithAPIKey(os.Getenv("AZURE_OPENAI_API_KEY")),
		option.WithMiddleware(azureopenai.Middleware("<project_name>")), // +
	)

	// Model is your Azure *deployment* name.
	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: "my-gpt-deployment",
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, Azure OpenAI!"),
		},
	})
	if err != nil {
		log.Fatalf("Chat completion failed: %v", err)
	}

	log.Printf("Chat completion: %s", response.Choices[0].Message.Content)
}
