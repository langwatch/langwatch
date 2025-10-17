export default `package main

import (
    "context"
    "log"
    "os"

    "github.com/langwatch/langwatch/sdk-go" // +
    otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai" // +
    "github.com/openai/openai-go"
    oaioption "github.com/openai/openai-go/option"
)

func main() {
    ctx := context.Background()

    client := openai.NewClient(
        oaioption.WithAPIKey(os.Getenv("AZURE_OPENAI_API_KEY")), // +
        oaioption.WithBaseURL(os.Getenv("AZURE_OPENAI_ENDPOINT")), // +
        oaioption.WithMiddleware(otelopenai.Middleware("my-llm-app",
            otelopenai.WithCaptureInput(),
            otelopenai.WithCaptureOutput(),
        )), // +
    )

    tracer := langwatch.Tracer("my-llm-app") // +
    ctx, span := tracer.Start(ctx, "UserRequestHandler") // +
    defer span.End()

    response, err := client.Chat.Completions.New(ctx, openai.ChatCompletionNewParams{
        Model: openai.ChatModelGPT4oMini,
        Messages: []openai.ChatCompletionMessageParamUnion{
            openai.SystemMessage("You are a helpful assistant."),
            openai.UserMessage("Hello, OpenAI!"),
        },
    }) // +
    if err != nil {
        log.Fatalf("Chat completion failed: %v", err)
    }

    log.Printf("Chat completion: %s", response.Choices[0].Message.Content)
}

`;


