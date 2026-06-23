// Package azureopenai provides OpenTelemetry instrumentation for Azure OpenAI
// accessed through the official openai-go client's azure subpackage
// (github.com/openai/openai-go/v3/azure).
//
// It is a thin convenience wrapper over the LangWatch OpenAI instrumentation
// (github.com/langwatch/langwatch/sdk-go/instrumentation/openai): Azure OpenAI
// speaks the same wire protocol as OpenAI, and the OpenAI middleware already
// understands Azure deployment paths
// (/openai/deployments/{deployment-id}/{operation}). The only thing this wrapper
// changes is the default gen_ai.provider.name, which it sets to "azure.openai"
// so traces are attributed to Azure rather than OpenAI.
//
// All of the OpenAI instrumentation's capture applies unchanged: chat
// completions, the Responses API and embeddings, including token usage (cached
// and reasoning tokens) and streaming reconstruction.
package azureopenai

import (
	oaioption "github.com/openai/openai-go/v3/option"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	otelopenai "github.com/langwatch/langwatch/sdk-go/instrumentation/openai"
)

// genAIProviderAzureOpenAI is the gen_ai.provider.name value recorded for Azure
// OpenAI traces. "azure.openai" follows the OTel GenAI provider naming.
var genAIProviderAzureOpenAI = semconv.GenAIProviderNameKey.String("azure.openai")

// Option configures the underlying OpenAI instrumentation. It is an alias for
// the OpenAI instrumentation's option type so callers can configure this
// wrapper without importing the openai module directly.
type Option = otelopenai.Option

// Middleware sets up tracing for Azure OpenAI requests made through the
// openai-go client. It delegates to the LangWatch OpenAI instrumentation,
// prepending a default gen_ai.provider.name of "azure.openai".
//
// Because the default provider is prepended, callers may still override it by
// passing their own WithGenAIProvider — the last option to apply wins.
//
// Wire it into the client alongside the azure connection options:
//
//	client := openai.NewClient(
//		azure.WithEndpoint(endpoint, apiVersion),
//		azure.WithAPIKey(apiKey),
//		option.WithMiddleware(azureopenai.Middleware("my-app")),
//	)
func Middleware(name string, opts ...Option) oaioption.Middleware {
	// Prepend the Azure default so an explicit WithGenAIProvider passed by the
	// caller still wins (options apply in order).
	withAzureDefault := append([]Option{WithGenAIProvider(genAIProviderAzureOpenAI)}, opts...)
	return otelopenai.Middleware(name, withAzureDefault...)
}

// WithGenAIProvider sets the gen_ai.provider.name attribute on spans. This
// wrapper defaults it to "azure.openai"; pass this option to override it.
func WithGenAIProvider(provider attribute.KeyValue) Option {
	return otelopenai.WithGenAIProvider(provider)
}
