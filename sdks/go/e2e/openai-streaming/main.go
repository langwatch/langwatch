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
		oaioption.WithMiddleware(otelopenai.Middleware("streaming-openai-client",
			// Optional: Capture request/response content (be mindful of sensitive data)
			otelopenai.WithCaptureInput(),
			otelopenai.WithCaptureOutput(),
		)),
	)

	// Get LangWatch tracer
	tracer := langwatch.Tracer("examples.streaming", trace.WithInstrumentationVersion("v0.1.0"))

	// Start a span for an LLM operation
	ctx, span := tracer.Start(ctx, "StreamingLLMInteraction")
	defer span.End()

	log.Printf("trace_id: %v\n", span.SpanContext().TraceID())

	// Make API calls as usual
	stream := client.Chat.Completions.NewStreaming(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, OpenAI!"),
		},
		StreamOptions: openai.ChatCompletionStreamOptionsParam{
			IncludeUsage: openai.Bool(true),
		},
	})

	acc := openai.ChatCompletionAccumulator{}

	for stream.Next() {
		chunk := stream.Current()
		acc.AddChunk(chunk)

		if content, ok := acc.JustFinishedContent(); ok {
			log.Printf("Content stream finished: %v", content)
		}

		if refusal, ok := acc.JustFinishedRefusal(); ok {
			log.Printf("Refusal stream finished: %v", refusal)
		}

		// it's best to use chunks after handling JustFinished events
		if len(chunk.Choices) > 0 {
			log.Printf("Content: %v", chunk.Choices[0].Delta.Content)
		}
	}

	if stream.Err() != nil {
		log.Fatalf("Stream error: %v", stream.Err())
	}

	// This whole journey will now be available in the LangWatch UI
	log.Printf("Chat completion response: %v", acc.Choices[0].Message.Content)
}
