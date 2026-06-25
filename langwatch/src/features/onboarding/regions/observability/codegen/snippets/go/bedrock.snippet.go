package main

import (
	"context"
	"log"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	langwatch "github.com/langwatch/langwatch/sdk-go"               // +
	"github.com/langwatch/langwatch/sdk-go/instrumentation/bedrock" // +
	"go.opentelemetry.io/otel"                                      // +
	sdktrace "go.opentelemetry.io/otel/sdk/trace"                   // +
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

	cfg, err := awsconfig.LoadDefaultConfig(ctx)
	if err != nil {
		log.Fatalf("failed to load AWS config: %v", err)
	}
	bedrock.InstrumentConfig(&cfg) // + every Bedrock Runtime client built from cfg is traced

	client := bedrockruntime.NewFromConfig(cfg)

	response, err := client.Converse(ctx, &bedrockruntime.ConverseInput{
		ModelId: aws.String("anthropic.claude-3-5-sonnet-20240620-v1:0"),
		Messages: []types.Message{{
			Role:    types.ConversationRoleUser,
			Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "Hello, Bedrock!"}},
		}},
	})
	if err != nil {
		log.Fatalf("Converse failed: %v", err)
	}

	log.Printf("Converse response: %v", response.Output)
}
