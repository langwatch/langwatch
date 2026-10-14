package openaiformat

import (
	"bytes"
	"encoding/json"

	"github.com/langwatch/langwatch/sdks/go/instrumentation/otelhttp"
)

// envelopeFallbackMessage names an error envelope that carries no message.
const envelopeFallbackMessage = "completion returned an error body"

// errorEnvelope reports the error body an OpenAI-compatible endpoint (the
// LangWatch gateway after a heartbeat-committed 200, for one) returns under a
// 2xx status: no choices and an "error" object. It returns nil for anything
// else, so a normal completion keeps its Ok status.
func errorEnvelope(raw []byte) error {
	if !bytes.Contains(raw, []byte(`"error"`)) {
		return nil
	}
	var body struct {
		Choices []json.RawMessage `json:"choices"`
		Error   *struct {
			Message any `json:"message"`
			Type    any `json:"type"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &body); err != nil || body.Error == nil || len(body.Choices) > 0 {
		return nil
	}
	be := &otelhttp.BodyError{Message: envelopeFallbackMessage}
	if msg, ok := body.Error.Message.(string); ok && msg != "" {
		be.Message = msg
	}
	if typ, ok := body.Error.Type.(string); ok {
		be.Type = typ
	}
	return be
}

// ResponseError implements otelhttp.ResponseErrorReporter for chat and legacy
// completions.
func (ChatExtractor) ResponseError(raw []byte) error { return errorEnvelope(raw) }

// ResponseError implements otelhttp.ResponseErrorReporter for the fallback,
// which is the extractor an envelope without an "object" field reaches.
func (GenericExtractor) ResponseError(raw []byte) error { return errorEnvelope(raw) }
