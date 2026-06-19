package otelhttp

import (
	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// Extractor reads one family of GenAI HTTP payloads (chat completions, the
// Responses API, Anthropic messages, Gemini generateContent, …) off the raw
// request and response bytes the base captures.
//
// The base dispatches by request/response *shape*, not URL path: it sniffs the
// body for discriminating fields and picks the first matching Extractor, using
// the URL path only as a hint. A provider's Extractor list should end with a
// permissive fallback so unknown shapes still produce a useful span.
type Extractor interface {
	// Name identifies the extractor (used as the span's operation segment).
	Name() string

	// MatchesRequest reports whether this extractor recognises the request body
	// (decoded once into a generic object) given the URL path as a weak hint.
	MatchesRequest(body JSONObject, pathHint string) bool

	// ExtractRequest records request attributes on the span and reports whether
	// the request asked for a streamed response. capture gates input content.
	ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) (streaming bool)

	// MatchesResponse reports whether this extractor recognises a non-streaming
	// response, given its decoded "object" discriminator and Content-Type.
	MatchesResponse(objectField, contentType string) bool

	// ExtractNonStreaming records response attributes from a buffered body.
	// capture gates output content.
	ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode)

	// NewStreamAccumulator returns a fresh accumulator for reconstructing a
	// streamed response of this shape.
	NewStreamAccumulator() StreamAccumulator
}

// StreamAccumulator reconstructs a streamed response from its SSE `data:` lines.
// One accumulator is used per streamed response: the base feeds it every data
// payload in order and then calls Finish exactly once.
type StreamAccumulator interface {
	// Consume processes one SSE data payload (the text after "data:", already
	// trimmed, and never the terminal sentinel).
	Consume(dataLine string)

	// IsTerminal reports whether dataLine is the stream-terminating sentinel.
	// OpenAI-style streams terminate on "[DONE]"; typed-event streams (Anthropic,
	// the Responses API) never do and return false.
	IsTerminal(dataLine string) bool

	// Finish records the final accumulated attributes. capture gates output content.
	Finish(span *langwatch.Span, capture langwatch.DataCaptureMode)
}

// NoopAccumulator is a StreamAccumulator for shapes that never stream.
type NoopAccumulator struct{}

func (NoopAccumulator) Consume(string)                                    {}
func (NoopAccumulator) IsTerminal(string) bool                            { return false }
func (NoopAccumulator) Finish(*langwatch.Span, langwatch.DataCaptureMode) {}

// selectRequestExtractor returns the first extractor accepting the request, or
// the last extractor (the provider's fallback) when none match.
func selectRequestExtractor(extractors []Extractor, body JSONObject, pathHint string) Extractor {
	for _, e := range extractors {
		if e.MatchesRequest(body, pathHint) {
			return e
		}
	}
	if len(extractors) > 0 {
		return extractors[len(extractors)-1]
	}
	return nil
}

// selectResponseExtractor returns the first extractor accepting the response, or
// the last extractor (the provider's fallback) when none match.
func selectResponseExtractor(extractors []Extractor, objectField, contentType string) Extractor {
	for _, e := range extractors {
		if e.MatchesResponse(objectField, contentType) {
			return e
		}
	}
	if len(extractors) > 0 {
		return extractors[len(extractors)-1]
	}
	return nil
}
