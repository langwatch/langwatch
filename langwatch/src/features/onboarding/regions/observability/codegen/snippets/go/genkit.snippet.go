package main

import (
	"context"
	"log"

	"github.com/firebase/genkit/go/ai"
	"github.com/firebase/genkit/go/genkit"
	"github.com/firebase/genkit/go/plugins/googlegenai"
	lwgenkit "github.com/langwatch/langwatch/sdk-go/instrumentation/genkit" // +
)

func main() {
	ctx := context.Background()

	g := genkit.Init(ctx, genkit.WithPlugins(&googlegenai.GoogleAI{}))

	// Export Genkit's OTEL spans to LangWatch (reads LANGWATCH_API_KEY from env). // +
	if err := lwgenkit.RegisterLangWatch(g); err != nil { // +
		log.Fatalf("failed to register LangWatch: %v", err) // +
	} // +

	// Flows, models and tools you run are now exported to LangWatch.
	response, err := genkit.GenerateText(ctx, g,
		ai.WithModelName("googleai/gemini-2.5-flash"),
		ai.WithPrompt("Hello, Genkit!"),
	)
	if err != nil {
		log.Fatalf("Generate failed: %v", err)
	}

	log.Printf("Response: %s", response)
}
