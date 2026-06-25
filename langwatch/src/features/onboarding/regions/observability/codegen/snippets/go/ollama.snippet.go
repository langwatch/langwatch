package main

import (
	"context"
	"fmt"
	"log"
	"net/url"

	langwatch "github.com/langwatch/langwatch/sdk-go"              // +
	"github.com/langwatch/langwatch/sdk-go/instrumentation/ollama" // +
	"github.com/ollama/ollama/api"
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

	base, _ := url.Parse("http://localhost:11434")
	client := api.NewClient(base, ollama.NewHTTPClient()) // + traced HTTP client

	stream := false
	err = client.Chat(ctx, &api.ChatRequest{
		Model:  "llama3.2",
		Stream: &stream,
		Messages: []api.Message{
			{Role: "system", Content: "You are a helpful assistant."},
			{Role: "user", Content: "Hello, Ollama!"},
		},
	}, func(resp api.ChatResponse) error {
		fmt.Print(resp.Message.Content)
		return nil
	})
	if err != nil {
		log.Fatalf("Chat completion failed: %v", err)
	}
}
