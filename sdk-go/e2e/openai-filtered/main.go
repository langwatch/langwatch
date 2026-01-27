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
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

func main() {
	ctx := context.Background()
	otelShutdown := setupOtel(ctx)
	defer otelShutdown()

	openaiAPIKey := os.Getenv("OPENAI_API_KEY")
	if openaiAPIKey == "" {
		log.Fatal("OPENAI_API_KEY environment variable not set")
	}

	// Create instrumented OpenAI client
	client := openai.NewClient(
		oaioption.WithAPIKey(openaiAPIKey),
		oaioption.WithMiddleware(otelopenai.Middleware("filtered-spans-openai-client",
			// Optional: Capture request/response content (be mindful of sensitive data)
			otelopenai.WithCaptureInput(),
			otelopenai.WithCaptureOutput(),
		)),
	)

	// Setup some tracers that we don't want to see in LangWatch
	someOtelTracer := otel.Tracer("some-otel-tracer")
	someDatabaseTracer := otel.Tracer("some-database-tracer")
	someNetworkTracer := otel.Tracer("some-network-tracer")
	someSideEffectTracer := otel.Tracer("some-side-effect-tracer")

	// Start some spans that we don't want to see in LangWatch
	ctx, someOtelSpan := someOtelTracer.Start(ctx, "some-otel-span")
	defer someOtelSpan.End()
	ctx, someDatabaseSpan := someDatabaseTracer.Start(ctx, "some-database-span")
	defer someDatabaseSpan.End()
	ctx, someNetworkSpan := someNetworkTracer.Start(ctx, "some-network-span")
	defer someNetworkSpan.End()
	ctx, someSideEffectSpan := someSideEffectTracer.Start(ctx, "some-side-effect-span")
	defer someSideEffectSpan.End()

	// Get LangWatch tracer
	tracer := langwatch.Tracer("examples.filtered-spans", trace.WithInstrumentationVersion("v0.1.0"))

	// Start a span for an LLM operation
	ctx, span := tracer.Start(ctx, "FilteredSpansLLMInteraction")
	defer span.End()

	log.Printf("trace_id: %v\n", span.SpanContext().TraceID())

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

func setupOtel(ctx context.Context) func() {
	// Create a LangWatch exporter with filtering
	// Reads LANGWATCH_API_KEY from environment automatically
	exporter, err := langwatch.NewExporter(ctx,
		// Only export spans from LangWatch instrumentation and our custom tracer
		langwatch.WithFilters(
			langwatch.Include(langwatch.Criteria{
				ScopeName: []langwatch.Matcher{
					// This is the scope name of the LangWatch tracer
					langwatch.Equals("examples.filtered-spans"),
					// This is the scope name of the OpenAI instrumentation
					langwatch.StartsWith("github.com/langwatch/langwatch/sdk-go/instrumentation/"),
				},
			}),
		),
	)
	if err != nil {
		log.Fatalf("failed to create LangWatch exporter: %v", err)
	}

	// Set the OTel tracer provider
	tp := sdktrace.NewTracerProvider(
		sdktrace.WithBatcher(exporter),
	)
	otel.SetTracerProvider(tp)

	return func() {
		if err := tp.Shutdown(ctx); err != nil {
			log.Fatalf("failed to shutdown TracerProvider: %v", err)
		}
	}
}
