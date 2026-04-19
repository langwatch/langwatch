package dispatch

import (
	"bytes"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// TestWriteTerminalSSEError emits the exact SSE shape the OpenAI SDK
// (and most OSS parsers) recognise as a typed mid-stream error. The
// shape matters — clients key on `event: error\n` to raise an
// exception instead of silently ending the stream.
func TestWriteTerminalSSEError_Shape(t *testing.T) {
	w := httptest.NewRecorder()
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	// Use a second encoder pointed at the recorder so the test sees
	// exactly what a client would.
	realEnc := json.NewEncoder(w)
	msg := "Anthropic overloaded"
	berr := &bfschemas.BifrostError{
		Error: &bfschemas.ErrorField{Message: msg},
	}
	writeTerminalSSEError(w, nil, realEnc, berr)
	out := w.Body.String()
	if !strings.HasPrefix(out, "event: error\n") {
		t.Errorf("expected `event: error\\n` prefix, got: %q", out)
	}
	if !strings.Contains(out, `"type":"provider_error"`) {
		t.Errorf("expected type=provider_error in payload, got: %q", out)
	}
	if !strings.Contains(out, msg) {
		t.Errorf("expected upstream message forwarded, got: %q", out)
	}
	if !strings.HasSuffix(out, "\n\n") {
		t.Errorf("SSE events must terminate with \\n\\n; got: %q", out)
	}
	_ = enc // silences the unused import when json.Encoder is needed only for type inference
}
