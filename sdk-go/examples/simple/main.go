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
	langwatchAPIKey := os.Getenv("LANGWATCH_API_KEY")
	if langwatchAPIKey == "" {
		log.Fatal("LANGWATCH_API_KEY environment variable not set")
	}

	openaiAPIKey := os.Getenv("OPENAI_API_KEY")
	if openaiAPIKey == "" {
		log.Fatal("OPENAI_API_KEY environment variable not set")
	}

	// Setup OTel to export to LangWatch
	exporter, err := otlptracehttp.New(ctx,
		otlptracehttp.WithEndpointURL("https://app.langwatch.ai/api/otel/v1/traces"),
		otlptracehttp.WithHeaders(map[string]string{"Authorization": "Bearer " + langwatchAPIKey}),
	)
	if err != nil {
		log.Fatalf("failed to create OTLP exporter: %v", err)
	}

	// Set the OTel tracer provider
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
	)
	otel.SetTracerProvider(tp)
	defer func() {
		if err := tp.Shutdown(ctx); err != nil {
			log.Fatalf("failed to shutdown TracerProvider: %v", err)
		}
	}()

	// Create instrumented OpenAI client
	client := openai.NewClient(
		oaioption.WithAPIKey(openaiAPIKey),
		oaioption.WithMiddleware(otelopenai.Middleware("simple-openai-client",
			// Optional: Capture request/response content (be mindful of sensitive data)
			otelopenai.WithCaptureInput(),
			otelopenai.WithCaptureOutput(),
		)),
	)

	// Get LangWatch tracer
	tracer := langwatch.Tracer("examples.simple", trace.WithInstrumentationVersion("v0.1.0"))

	// Start a span for an LLM operation
	ctx, span := tracer.Start(ctx, "SimpleLLMInteraction")
	defer span.End()

	// Make API calls as usual
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

	// This whole journey will now be available in the LangWatch UI
	log.Printf("Chat completion response: %v", response.Choices[0].Message.Content)
}
