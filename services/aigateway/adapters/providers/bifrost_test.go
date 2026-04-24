package providers

import (
	"encoding/json"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"
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

// TestEnsureStreamIncludeUsage covers the stream_options.include_usage
// auto-injection path (spec: streaming.feature → "Streaming usage capture").
// OpenAI streams only emit a final usage chunk when the request body
// carries this flag, so without it the gateway sees tokens=0 and the
// trace's cost-enrichment has nothing to fold.
func TestEnsureStreamIncludeUsage(t *testing.T) {
	cases := []struct {
		name        string
		in          string
		wantInclude bool      // true = body must have stream_options.include_usage=true
		wantChanged bool      // true = body bytes must differ from input
		assertExtra func(t *testing.T, out []byte)
	}{
		{
			name:        "stream true, no stream_options → injected",
			in:          `{"model":"gpt-5-mini","stream":true,"messages":[{"role":"user","content":"hi"}]}`,
			wantInclude: true,
			wantChanged: true,
		},
		{
			name:        "stream true, caller include_usage=true → unchanged",
			in:          `{"model":"gpt-5-mini","stream":true,"stream_options":{"include_usage":true},"messages":[{"role":"user","content":"hi"}]}`,
			wantInclude: true,
			wantChanged: false,
		},
		{
			name:        "stream true, caller include_usage=false → left alone",
			in:          `{"model":"gpt-5-mini","stream":true,"stream_options":{"include_usage":false},"messages":[{"role":"user","content":"hi"}]}`,
			wantInclude: false,
			wantChanged: false,
			assertExtra: func(t *testing.T, out []byte) {
				if gjson.GetBytes(out, "stream_options.include_usage").Bool() {
					t.Fatalf("caller opted OUT of usage; gateway must not overwrite")
				}
			},
		},
		{
			name:        "stream false → not mutated",
			in:          `{"model":"gpt-5-mini","stream":false,"messages":[{"role":"user","content":"hi"}]}`,
			wantInclude: false,
			wantChanged: false,
			assertExtra: func(t *testing.T, out []byte) {
				if gjson.GetBytes(out, "stream_options").Exists() {
					t.Fatalf("stream=false must not grow a stream_options field")
				}
			},
		},
		{
			name:        "stream absent → not mutated",
			in:          `{"model":"gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`,
			wantInclude: false,
			wantChanged: false,
			assertExtra: func(t *testing.T, out []byte) {
				if gjson.GetBytes(out, "stream_options").Exists() {
					t.Fatalf("no stream flag must not grow a stream_options field")
				}
			},
		},
		{
			name:        "empty body → returned as-is",
			in:          ``,
			wantInclude: false,
			wantChanged: false,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			in := []byte(tc.in)
			out := ensureStreamIncludeUsage(in)

			if tc.wantChanged && string(out) == string(in) {
				t.Fatalf("expected body to be rewritten, but bytes are identical:\n%s", string(out))
			}
			if !tc.wantChanged && string(out) != string(in) {
				t.Fatalf("expected body to be unchanged, got:\nin=%s\nout=%s", string(in), string(out))
			}
			if tc.wantInclude && !gjson.GetBytes(out, "stream_options.include_usage").Bool() {
				t.Fatalf("expected stream_options.include_usage=true on output:\n%s", string(out))
			}
			if tc.assertExtra != nil {
				tc.assertExtra(t, out)
			}
		})
	}
}

// TestEnsureStreamIncludeUsage_PreservesMessages guards the
// "byte-equivalent except for the injected key" contract on the BDD spec.
// The injection must NOT re-order messages, drop other keys, or change
// number formatting on existing fields — those would invalidate OpenAI's
// prompt-prefix auto-cache between two otherwise-identical calls.
func TestEnsureStreamIncludeUsage_PreservesMessages(t *testing.T) {
	in := []byte(`{"model":"gpt-5-mini","stream":true,"temperature":0.7,"messages":[{"role":"system","content":"be concise"},{"role":"user","content":"hi"}],"max_completion_tokens":16}`)
	out := ensureStreamIncludeUsage(in)

	// Everything except the injected key should round-trip.
	for _, path := range []string{
		"model",
		"stream",
		"temperature",
		"messages",
		"max_completion_tokens",
	} {
		gotIn := gjson.GetBytes(in, path).Raw
		gotOut := gjson.GetBytes(out, path).Raw
		if gotIn != gotOut {
			t.Fatalf("field %q mutated: in=%q out=%q", path, gotIn, gotOut)
		}
	}

	if !gjson.GetBytes(out, "stream_options.include_usage").Bool() {
		t.Fatalf("expected stream_options.include_usage=true on output")
	}
}
