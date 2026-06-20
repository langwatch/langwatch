package main

import (
	"context"
	"log"
	"os"

	"github.com/anthropics/anthropic-sdk-go"
	anthropicoption "github.com/anthropics/anthropic-sdk-go/option"
	langwatch "github.com/langwatch/langwatch/sdk-go"                               // +
	otelanthropic "github.com/langwatch/langwatch/sdk-go/instrumentation/anthropic" // +
	"go.opentelemetry.io/otel"                                                      // +
	sdktrace "go.opentelemetry.io/otel/sdk/trace"                                   // +
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

	client := anthropic.NewClient(
		anthropicoption.WithAPIKey(os.Getenv("ANTHROPIC_API_KEY")),
		anthropicoption.WithMiddleware(otelanthropic.Middleware()), // +
	)

	message, err := client.Messages.New(ctx, anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeSonnet4_5,
		MaxTokens: 1024,
		System:    []anthropic.TextBlockParam{{Text: "You are a helpful assistant."}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Hello, Claude!")),
		},
	})
	if err != nil {
		log.Fatalf("Messages call failed: %v", err)
	}

	log.Printf("Response: %v", message)
}
