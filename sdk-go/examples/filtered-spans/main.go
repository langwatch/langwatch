package main

import (
	"context"
	"log"
	"os"
	"sync"

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
		sdktrace.WithSpanProcessor(NewFilteringSpanProcessor(
			sdktrace.NewBatchSpanProcessor(exporter),

			// This is the scope name of the LangWatch tracer
			"examples.filtered-spans",

			// This is the scope name of the OpenAI instrumentation
			"github.com/langwatch/langwatch/sdk-go/instrumentation/openai",
		)),
	)
	otel.SetTracerProvider(tp)

	return func() {
		if err := tp.Shutdown(ctx); err != nil {
			log.Fatalf("failed to shutdown TracerProvider: %v", err)
		}
	}
}

// FilteringSpanProcessor filters spans based on instrumentation scope **name only**.
type FilteringSpanProcessor struct {
	next              sdktrace.SpanProcessor
	allowedScopeNames map[string]struct{}
	mu                sync.RWMutex
}

// NewFilteringSpanProcessor returns a processor that only allows spans that were created
// with the provided scope names.
func NewFilteringSpanProcessor(next sdktrace.SpanProcessor, scopeNames ...string) *FilteringSpanProcessor {
	m := make(map[string]struct{}, len(scopeNames))
	for _, name := range scopeNames {
		m[name] = struct{}{}
	}
	return &FilteringSpanProcessor{
		next:              next,
		allowedScopeNames: m,
	}
}

func (f *FilteringSpanProcessor) OnStart(ctx context.Context, rs sdktrace.ReadWriteSpan) {
	f.next.OnStart(ctx, rs)
}

func (f *FilteringSpanProcessor) OnEnd(rs sdktrace.ReadOnlySpan) {
	scopeName := rs.InstrumentationScope().Name

	f.mu.RLock()
	_, ok := f.allowedScopeNames[scopeName]
	f.mu.RUnlock()

	if ok {
		f.next.OnEnd(rs)
	}
}

func (f *FilteringSpanProcessor) Shutdown(ctx context.Context) error {
	return f.next.Shutdown(ctx)
}

func (f *FilteringSpanProcessor) ForceFlush(ctx context.Context) error {
	return f.next.ForceFlush(ctx)
}
