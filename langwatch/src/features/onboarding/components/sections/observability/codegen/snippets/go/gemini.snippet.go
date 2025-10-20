package main

import (
	"context"
	"log"
	"os"

	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai" // +
	"github.com/openai/openai-go"
	oaioption "github.com/openai/openai-go/option"
)

func main() {
	ctx := context.Background()

	client := openai.NewClient(
		oaioption.WithAPIKey(os.Getenv("GEMINI_API_KEY")),
		oaioption.WithBaseURL(os.Getenv("GEMINI_BASE_URL")),
		oaioption.WithMiddleware(otelopenai.Middleware("<project_name>", // +
			otelopenai.WithCaptureInput(),  // +
			otelopenai.WithCaptureOutput(), // +
		)), // +
	)

	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: openai.ChatModelGPT5,
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, OpenAI!"),
		},
	})
	if err != nil {
		log.Fatalf("Chat completion failed: %v", err)
	}

	log.Printf("Chat completion: %s", response.Choices[0].Message.Content)
}
