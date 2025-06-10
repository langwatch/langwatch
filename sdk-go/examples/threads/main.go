package main

import (
	"context"
	"log"
	"os"
	"strings"

	"github.com/google/uuid"
	langwatch "github.com/langwatch/langwatch/sdk-go"
	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"

	"github.com/openai/openai-go"
	oaioption "github.com/openai/openai-go/option"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"
)

var (
	tracer = langwatch.Tracer("examples.threads", trace.WithInstrumentationVersion("v0.1.0"))
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

	threadID := "thread_" + strings.ReplaceAll(uuid.New().String(), "-", "")

	// Create instrumented OpenAI client
	client := openai.NewClient(
		oaioption.WithAPIKey(openaiAPIKey),
		oaioption.WithMiddleware(otelopenai.Middleware("custom-input-output-openai-client")),
	)

	history := []openai.ChatCompletionMessageParamUnion{
		openai.SystemMessage("You are a helpful assistant."),
	}

	response, history, err := askQuestion(ctx, client, threadID, history, "Hello, OpenAI!")
	if err != nil {
		log.Fatalf("failed to ask question: %v", err)
	}
	logQuestionAndAnswer("Hello, OpenAI!", response)

	response, history, err = askQuestion(ctx, client, threadID, history, "What is the capital of France?")
	if err != nil {
		log.Fatalf("failed to ask question: %v", err)
	}
	logQuestionAndAnswer("What is the capital of France?", response)

	response, history, err = askQuestion(ctx, client, threadID, history, "And what is the population of it?")
	if err != nil {
		log.Fatalf("failed to ask question: %v", err)
	}
	logQuestionAndAnswer("And what is the population of it?", response)

	log.Printf("thread_id: %v\n", threadID)
}

func askQuestion(ctx context.Context, client openai.Client, threadID string, history []openai.ChatCompletionMessageParamUnion, question string) (string, []openai.ChatCompletionMessageParamUnion, error) {
	ctx, span := tracer.Start(ctx, "askQuestion", trace.WithAttributes(
		// Set the thread_id attribute on the span, so that langwatch can group the spans together
		langwatch.AttributeLangWatchThreadID.String(threadID),
	), trace.WithNewRoot()) // IMPORTANT: Each message should be it's own trace
	defer span.End()

	log.Printf("trace_id: %v\n", span.SpanContext().TraceID())

	span.RecordInputString(question)

	newHistory := append(history, openai.UserMessage(question))
	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model:    openai.ChatModelGPT4o,
		Messages: newHistory,
	})
	if err != nil {
		return "", newHistory, err
	}

	responseMessage := response.Choices[0].Message
	span.RecordOutputString(responseMessage.Content)

	return responseMessage.Content, append(newHistory, openai.AssistantMessage(responseMessage.Content)), err
}

func logQuestionAndAnswer(question, answer string) {
	log.Printf("question: %v\n", question)
	log.Printf("answer: %v\n", answer)
	log.Printf("--------------------------------\n")
}
