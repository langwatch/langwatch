package googlegenai

import (
	"encoding/json"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// genericExtractor is the terminal fallback in the registry. Its match methods
// always return true, so it catches:
//
//   - Gemini generateContent RESPONSES — these carry no top-level "object"
//     discriminator, so the base's shape dispatch lands here. It records the full
//     GenerateContentResponse (candidates text, usage, finish reasons, model
//     version) by reusing recordResponse, giving identical output to the typed
//     request/response pairing.
//   - Any other JSON payload (unknown / unsupported Gemini endpoints), which it
//     records as raw input/output JSON so the span is still useful.
type genericExtractor struct{}

func (genericExtractor) Name() string { return "gcp.gemini" }

func (genericExtractor) MatchesRequest(otelhttp.JSONObject, string) bool { return true }

func (genericExtractor) MatchesResponse(string, string) bool { return true }

func (genericExtractor) ExtractRequest(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) bool {
	body, ok := otelhttp.ParseBody(raw)
	if !ok {
		return false
	}
	if capture.CaptureInput() {
		span.SetInputJSON(body)
	}
	return false
}

func (genericExtractor) ExtractNonStreaming(span *langwatch.Span, raw []byte, capture langwatch.DataCaptureMode) {
	// A Gemini generateContent response has candidates[] and/or usageMetadata but
	// no "object" field, so the base routes it to this fallback. Decode it as a
	// GenerateContentResponse and record it exactly as the typed pairing would.
	var resp generateContentResponse
	if err := json.Unmarshal(raw, &resp); err == nil && isGeminiResponse(&resp) {
		recordResponse(span, &resp, capture)
		return
	}

	// Otherwise record whatever JSON arrived, so unknown endpoints still produce
	// a span with output content (gated by capture).
	if capture.CaptureOutput() {
		if body, ok := otelhttp.ParseBody(raw); ok {
			span.SetOutputJSON(body)
		}
	}
}

func (genericExtractor) NewStreamAccumulator() otelhttp.StreamAccumulator {
	return &generateContentStreamAccumulator{}
}

// isGeminiResponse reports whether a decoded body looks like a Gemini
// GenerateContentResponse (it has candidates or usage metadata or a model
// version), distinguishing it from an arbitrary JSON object.
func isGeminiResponse(resp *generateContentResponse) bool {
	return len(resp.Candidates) > 0 || resp.UsageMetadata != nil || resp.ModelVersion != ""
}
