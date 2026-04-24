package providers

import (
	"encoding/json"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
)

// Regression: Bifrost's providers/utils EnrichError stores raw provider
// response bytes as json.RawMessage. json.RawMessage is `type RawMessage []byte`
// but Go's type switch does NOT match []byte for RawMessage — they are
// distinct named types. An explicit case is required, otherwise the raw
// bytes fall through to sonic.Marshal which double-encodes or fails,
// and codex / opencode 504s mask the upstream OpenAI error shape.
func TestExtractRawResponseBytes_RawMessage(t *testing.T) {
	jsonBytes := []byte(`{"error":{"message":"oops","code":"rate_limit"}}`)
	raw := json.RawMessage(jsonBytes)

	got, ok := extractRawResponseBytes(raw)
	if !ok {
		t.Fatalf("extractRawResponseBytes returned ok=false for non-empty json.RawMessage")
	}
	if string(got) != string(jsonBytes) {
		t.Fatalf("byte mismatch: got %q, want %q", got, jsonBytes)
	}
}

func TestExtractRawResponseBytes_EmptyRawMessage(t *testing.T) {
	raw := json.RawMessage(nil)
	if _, ok := extractRawResponseBytes(raw); ok {
		t.Fatalf("empty json.RawMessage should return ok=false")
	}
}

func TestRawResponseFromBifrostError_UnmarshalFailure(t *testing.T) {
	status := 502
	berr := &bfschemas.BifrostError{
		StatusCode: &status,
		Error: &bfschemas.ErrorField{
			Message: "failed to unmarshal response from provider API",
		},
		ExtraFields: bfschemas.BifrostErrorExtraFields{
			// Shape populated by providerUtils.EnrichError on raw-forward paths
			// when BifrostContextKeySendBackRawResponse=true.
			RawResponse: json.RawMessage(`{"id":"resp_abc","object":"response"}`),
		},
	}

	body, gotStatus, ok := rawResponseFromBifrostError(berr)
	if !ok {
		t.Fatalf("rawResponseFromBifrostError returned ok=false despite populated RawResponse")
	}
	if gotStatus != status {
		t.Fatalf("status mismatch: got %d, want %d", gotStatus, status)
	}
	if string(body) != `{"id":"resp_abc","object":"response"}` {
		t.Fatalf("body mismatch: got %q", body)
	}
}
