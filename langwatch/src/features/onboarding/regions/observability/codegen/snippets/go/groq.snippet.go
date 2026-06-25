package main

import (
	"context"
	"log"
	"os"

	langwatch "github.com/langwatch/langwatch/sdk-go"                         // +
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai" // +
	"github.com/openai/openai-go/v3"
	oaioption "github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel"                         // +
	sdktrace "go.opentelemetry.io/otel/sdk/trace"      // +
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0" // +
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
		oaioption.WithAPIKey(os.Getenv("GROQ_API_KEY")),
		oaioption.WithBaseURL("https://api.groq.com/openai/v1"),
		oaioption.WithMiddleware(otelopenai.Middleware("<project_name>", // +
			otelopenai.WithGenAIProvider(semconv.GenAIProviderNameKey.String("groq")), // +
		)), // +
	)

	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: "openai/gpt-oss-20b",
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, Groq!"),
		},
	})
	if err != nil {
		log.Fatalf("Groq API call failed: %v", err)
	}

	log.Printf("Groq response: %s", response.Choices[0].Message.Content)
}
