package main

import (
	"context"
	"log"
	"os"

	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
	"github.com/openai/openai-go"
	oaioption "github.com/openai/openai-go/option"
)

func main() {
	ctx := context.Background()

	client := openai.NewClient(
		oaioption.WithBaseURL("https://api.groq.com/openai/v1"),
		oaioption.WithAPIKey(os.Getenv("GROQ_API_KEY")),
		oaioption.WithMiddleware(otelopenai.Middleware("<project_name>",
			otelopenai.WithGenAISystem("groq"),
			otelopenai.WithCaptureInput(),
			otelopenai.WithCaptureOutput(),
		)),
	)

	response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
		Model: "openai/gpt-oss-20b",
		Messages: []openai.ChatCompletionMessageParamUnion{
			openai.SystemMessage("You are a helpful assistant."),
			openai.UserMessage("Hello, Groq!"),
		},
	})
	if err != nil {
		log.Fatalf("Groq API call failed: %v", err)
	}

	log.Printf("Groq response: %s", response.Choices[0].Message.Content)
}
