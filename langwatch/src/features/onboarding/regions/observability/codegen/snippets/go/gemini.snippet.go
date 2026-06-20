package main

import (
	"context"
	"log"
	"os"

	langwatch "github.com/langwatch/langwatch/sdk-go"                   // +
	"github.com/langwatch/langwatch/sdk-go/instrumentation/googlegenai" // +
	"go.opentelemetry.io/otel"                                          // +
	sdktrace "go.opentelemetry.io/otel/sdk/trace"                       // +
	"google.golang.org/genai"
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

	cc := &genai.ClientConfig{
		APIKey:  os.Getenv("GEMINI_API_KEY"),
		Backend: genai.BackendGeminiAPI,
	}
	googlegenai.WrapClientConfig(cc) // + traces every call this client makes

	client, err := genai.NewClient(ctx, cc)
	if err != nil {
		log.Fatalf("failed to create Gemini client: %v", err)
	}

	response, err := client.Models.GenerateContent(ctx, "gemini-2.5-flash", genai.Text("Hello, Gemini!"), nil)
	if err != nil {
		log.Fatalf("GenerateContent failed: %v", err)
	}

	log.Printf("Response: %s", response.Text())
}
