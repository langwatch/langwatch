package main

import (
	"context"
	"log"
	"os"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"

	"github.com/openai/openai-go/v3"
	oaioption "github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
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
		// This example records input/output manually on its own LLM span, so the
		// middleware is told not to also capture content on the auto HTTP span.
		oaioption.WithMiddleware(otelopenai.Middleware("custom-input-output-openai-client",
			otelopenai.WithDataCapture(langwatch.DataCaptureNone),
		)),
	)

	// Get LangWatch tracer
	tracer := langwatch.Tracer("examples.custom-input-output", trace.WithInstrumentationVersion("v0.1.0"))

	// Start a span for an LLM operation
	ctx, span := tracer.Start(ctx, "CustomInputOutputLLMInteraction")
	defer span.End()

	log.Printf("trace_id: %v\n", span.SpanContext().TraceID())

	userMessage := "Hello, OpenAI!"

	// Mark the span as an LLM step, record the typed input, set a trace name and
	// the trace identity (conversation/user/labels), and attach custom metadata.
	// Identity has dedicated setters; SetTraceMetadata is for custom fields. All
	// LangWatch setters chain.
	span.
		SetType(langwatch.SpanTypeLLM).
		SetInputText(userMessage).
		SetTraceName("Custom input/output demo").
		SetThreadID("custom-input-output-demo"). // → gen_ai.conversation.id
		SetUserID("demo-user").
		SetLabels("example", "go-sdk").
		SetTraceMetadata(
			langwatch.Origin("e2e-example"),
			attribute.String("feature", "custom-input-output"),
		)

	// Make API calls as usual
	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage(userMessage),
		},
	})
	if err != nil {
		log.Fatalf("Chat completion failed: %v", err)
	}

	// Record the preferred choice as output, plus token usage. The output will be
	// shown in the LangWatch UI and the token usage rolls up to the trace. Token
	// counts are recorded as gen_ai.usage.* (SetGenAIUsage); langwatch.metrics
	// (SetMetrics) carries cost and the estimated-tokens flag.
	span.
		SetOutputText(response.Choices[0].Message.Content).
		SetGenAIUsage(langwatch.GenAIUsage{
			InputTokens:  langwatch.Int(int(response.Usage.PromptTokens)),
			OutputTokens: langwatch.Int(int(response.Usage.CompletionTokens)),
			TotalTokens:  langwatch.Int(int(response.Usage.TotalTokens)),
		})

	// This whole journey will now be available in the LangWatch UI
	log.Printf("Chat completion response: %v", response.Choices[0].Message.Content)
}
