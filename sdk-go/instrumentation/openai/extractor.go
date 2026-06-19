package openai

import (
	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// shapeExtractor knows how to read one family of OpenAI-compatible payloads
// (chat completions, the Responses API, embeddings, …) off the raw request and
// response bytes the middleware sees.
//
// The middleware dispatches by *shape* rather than by URL path: it sniffs the
// request/response body for discriminating fields and uses the URL path only as
// a hint/tiebreaker. This lets the same extractors handle OpenAI, Azure and
// other OpenAI-compatible providers regardless of how they spell their paths,
// and lets unknown endpoints degrade gracefully through the generic fallback.
type shapeExtractor interface {
	// name identifies the extractor (used to name the span operation segment).
	name() string

	// matchesRequest reports whether this extractor recognises the request body.
	// body is the request JSON parsed once into a generic map; pathHint is the
	// request URL path, used only as a weak tiebreaker.
	matchesRequest(body map[string]any, pathHint string) bool

	// extractRequest records request attributes on the span (unmarshalling raw
	// into the typed openai-go struct) and reports whether the request asked for
	// a streaming response. capture gates whether input content is recorded.
	extractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) (streaming bool)

	// matchesResponse reports whether this extractor recognises the response,
	// given the response body's "object" field (if any) and Content-Type.
	matchesResponse(objectField, contentType string) bool

	// extractNonStreaming records response attributes from a buffered,
	// non-streaming response body. capture gates whether output content is
	// recorded.
	extractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode)

	// newStreamAccumulator returns a fresh accumulator for reconstructing a
	// streamed response of this shape.
	newStreamAccumulator() streamAccumulator
}

// streamAccumulator reconstructs a streamed response from its SSE `data:` lines.
// One accumulator is used per streaming response; the middleware feeds it every
// data payload in order and then calls finish exactly once.
type streamAccumulator interface {
	// consume processes a single SSE data payload (already stripped of the
	// leading "data: " prefix, and never the terminal sentinel).
	consume(dataLine string)

	// isTerminal reports whether dataLine is the stream-terminating sentinel.
	// Chat completions terminate on "[DONE]"; the Responses API never does (it
	// ends via a typed response.completed/response.failed event), so it returns
	// false.
	isTerminal(dataLine string) bool

	// finish records the final accumulated attributes on the span. capture gates
	// whether output content is recorded.
	finish(span *langwatch.Span, capture langwatch.DataCaptureMode)
}

// extractors is the ordered registry tried for each request/response. The
// generic fallback is last so it only handles payloads no typed extractor
// claimed, preserving graceful degradation for unknown endpoints.
var extractors = []shapeExtractor{
	chatExtractor{},
	responsesExtractor{},
	embeddingsExtractor{},
	genericExtractor{},
}

// selectRequestExtractor returns the first extractor whose matchesRequest
// accepts the parsed request body. The generic fallback always matches, so this
// never returns nil.
func selectRequestExtractor(body map[string]any, pathHint string) shapeExtractor {
	for _, e := range extractors {
		if e.matchesRequest(body, pathHint) {
			return e
		}
	}
	return genericExtractor{}
}

// selectResponseExtractor returns the first extractor whose matchesResponse
// accepts the response. The generic fallback always matches, so this never
// returns nil.
func selectResponseExtractor(objectField, contentType string) shapeExtractor {
	for _, e := range extractors {
		if e.matchesResponse(objectField, contentType) {
			return e
		}
	}
	return genericExtractor{}
}
