package main

import (
	"context"
	"log"
	"os"

	langwatch "github.com/langwatch/langwatch/sdk-go"                        // +
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai" // +
	"github.com/openai/openai-go"
	oaioption "github.com/openai/openai-go/option"
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

	client := openai.NewClient(
		oaioption.WithAPIKey(os.Getenv("MISTRAL_API_KEY")),
		oaioption.WithBaseURL(os.Getenv("MISTRAL_BASE_URL")),
		oaioption.WithMiddleware(otelopenai.Middleware("<project_name>", // +
			otelopenai.WithCaptureInput(),  // +
			otelopenai.WithCaptureOutput(), // +
		)), // +
	)

	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: "mistral-large-latest",
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, Mistral!"),
		},
	})
	if err != nil {
		log.Fatalf("Chat completion failed: %v", err)
	}

	log.Printf("Chat completion: %s", response.Choices[0].Message.Content)
}
