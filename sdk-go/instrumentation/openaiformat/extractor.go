// Package openaiformat holds the shared, dependency-free extractors for the
// OpenAI wire format — chat completions (/v1/chat/completions), the legacy text
// completions API (/v1/completions), the Responses API (/v1/responses) and
// embeddings (/v1/embeddings). The wire shapes are identical regardless of the
// Go client SDK in use, so every OpenAI-compatible instrumentation
// (instrumentation/openai over the official openai-go client,
// instrumentation/gopenai over sashabaranov/go-openai) shares this one set.
//
// The extractors read RAW JSON off the request and response bytes the otelhttp
// base captures, decoding into local structs rather than any provider SDK's
// typed shapes. They therefore import ONLY otelhttp, the root langwatch package,
// go.opentelemetry.io/otel/* and the standard library — never openai-go or
// sashabaranov/go-openai. (A go list -deps over this package proves neither SDK
// is in its closure.) The otelhttp base owns the span lifecycle, the byte-exact
// body pass-through and the SSE reconstruction; this package owns only the
// OpenAI wire-shape mapping.
package openaiformat

import (
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// Extractors returns the OpenAI-format shape extractors in precedence order.
// The base tries them in order and picks the first whose shape matches, so the
// permissive generic fallback MUST be last: it claims any payload, so unknown or
// unsupported OpenAI-compatible endpoints still produce a useful span.
//
// Both the openai and gopenai instrumentations wire this exact set into the
// otelhttp base, so the two produce identical spans for identical wire bytes.
func Extractors() []otelhttp.Extractor {
	return []otelhttp.Extractor{
		ChatExtractor{},
		ResponsesExtractor{},
		EmbeddingsExtractor{},
		GenericExtractor{},
	}
}
