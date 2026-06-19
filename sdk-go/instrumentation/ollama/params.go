package ollama

import (
	"encoding/json"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// optionsParams is the subset of Ollama's request "options" map we map onto the
// gen_ai.request.* parameters. Ollama nests generation parameters under
// options{} rather than at the top level: num_predict is its max-tokens field;
// temperature / top_p / top_k / seed / stop map to their semconv equivalents.
//
// The wire types are JSON numbers (Ollama uses float32/int Go types, but on the
// wire they are plain numbers), so each is a pointer to distinguish "unset" from
// a real zero.
type optionsParams struct {
	NumPredict  *int     `json:"num_predict"`
	Temperature *float64 `json:"temperature"`
	TopP        *float64 `json:"top_p"`
	TopK        *float64 `json:"top_k"`
	Seed        *int     `json:"seed"`
	Stop        []string `json:"stop"`
	// Penalties are recorded too when present.
	FrequencyPenalty *float64 `json:"frequency_penalty"`
	PresencePenalty  *float64 `json:"presence_penalty"`
}

// toGenAIRequestParams maps the Ollama options onto the LangWatch request-params
// helper. num_predict is Ollama's max-tokens equivalent.
func (o optionsParams) toGenAIRequestParams() langwatch.GenAIRequestParams {
	params := langwatch.GenAIRequestParams{
		MaxTokens:        o.NumPredict,
		Temperature:      o.Temperature,
		TopP:             o.TopP,
		TopK:             o.TopK,
		Seed:             o.Seed,
		FrequencyPenalty: o.FrequencyPenalty,
		PresencePenalty:  o.PresencePenalty,
	}
	if len(o.Stop) > 0 {
		params.StopSequences = o.Stop
	}
	return params
}

// streamRequested reports whether a request asked for a streamed response.
// Ollama's stream field defaults to true when absent (a nil pointer), matching
// the server's behaviour (isStreaming = req.Stream == nil || *req.Stream).
func streamRequested(stream *bool) bool {
	return stream == nil || *stream
}

// recordFormat records the request's structured-output format (gen_ai.output.type
// adjacent). Ollama's format is either the string "json" or a JSON Schema object;
// either way we record it verbatim under gen_ai.request.structured_output.
func recordFormat(span *langwatch.Span, format json.RawMessage) {
	if len(format) == 0 {
		return
	}
	otelhttp.SetJSONAttribute(span, "gen_ai.request.structured_output", format)
}
