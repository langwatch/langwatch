package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
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
	if !bytes.Equal(got, jsonBytes) {
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
		wantInclude bool // true = body must have stream_options.include_usage=true
		wantChanged bool // true = body bytes must differ from input
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
				t.Helper()
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
				t.Helper()
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
				t.Helper()
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

			if tc.wantChanged && bytes.Equal(out, in) {
				t.Fatalf("expected body to be rewritten, but bytes are identical:\n%s", string(out))
			}
			if !tc.wantChanged && !bytes.Equal(out, in) {
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

func intPtr(i int) *int { return &i }

// A terminal upstream status (4xx) must surface as a *domain.UpstreamError
// carrying the provider's real status + native body verbatim, so the HTTP
// layer forwards it instead of masking it as a retryable 502. Regression for
// the credit-depleted-key retry storm: Anthropic returns 400 "credit balance
// too low", the streaming path classified it 502, and claude-code retried 10x.
func TestErrFromBifrost_TerminalStatusForwardsVerbatim(t *testing.T) {
	rawBody := []byte(`{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}`)
	berr := &bfschemas.BifrostError{
		StatusCode: intPtr(400),
		Error:      &bfschemas.ErrorField{Message: "Your credit balance is too low"},
		ExtraFields: bfschemas.BifrostErrorExtraFields{
			RawResponse: json.RawMessage(rawBody),
		},
	}

	// Upstream sends its terminal signal + a noise header; only the
	// retry-signaling headers should ride through, with canonical casing.
	respHeaders := map[string]string{
		"x-should-retry": "false",
		"retry-after":    "30",
		"content-length": "97",
	}

	err := errFromBifrost(context.Background(), berr, respHeaders)
	ue, ok := err.(*domain.UpstreamError)
	if !ok {
		t.Fatalf("expected *domain.UpstreamError, got %T", err)
	}
	if ue.StatusCode != http.StatusBadRequest {
		t.Fatalf("status: want 400, got %d", ue.StatusCode)
	}
	if !bytes.Equal(ue.Body, rawBody) {
		t.Fatalf("body not forwarded verbatim:\n want %s\n got  %s", rawBody, ue.Body)
	}
	if ue.Headers["x-should-retry"] != "false" {
		t.Fatalf("x-should-retry not forwarded: %v", ue.Headers)
	}
	if ue.Headers["Retry-After"] != "30" {
		t.Fatalf("Retry-After not forwarded (canonical key): %v", ue.Headers)
	}
	if _, ok := ue.Headers["content-length"]; ok {
		t.Fatalf("non-retry header content-length must be dropped: %v", ue.Headers)
	}
}

// When Bifrost did not capture the provider's raw body, the upstream status is
// still preserved on the UpstreamError (the HTTP layer then emits a minimal
// envelope carrying that status + message) — never collapsed to 502.
func TestErrFromBifrost_StatusWithoutRawBody(t *testing.T) {
	berr := &bfschemas.BifrostError{
		StatusCode: intPtr(402),
		Error:      &bfschemas.ErrorField{Message: "payment required"},
	}
	err := errFromBifrost(context.Background(), berr, nil)
	ue, ok := err.(*domain.UpstreamError)
	if !ok {
		t.Fatalf("expected *domain.UpstreamError, got %T", err)
	}
	if ue.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("status: want 402, got %d", ue.StatusCode)
	}
	if len(ue.Body) != 0 {
		t.Fatalf("expected empty body, got %s", ue.Body)
	}
}

// A zero status means no upstream HTTP response (transport failure / timeout):
// keep the existing classification (provider_timeout), not a forwarded status.
func TestErrFromBifrost_NoStatusFallsBackToClassify(t *testing.T) {
	berr := &bfschemas.BifrostError{
		Error: &bfschemas.ErrorField{Message: "dial tcp: timeout"},
	}
	err := errFromBifrost(context.Background(), berr, nil)
	if _, ok := err.(*domain.UpstreamError); ok {
		t.Fatalf("transport failure must not become an UpstreamError")
	}
	if !herr.IsCode(err, domain.ErrProviderTimeout) {
		t.Fatalf("expected provider_timeout, got %v", err)
	}
}

// Bifrost sums cache reads/writes into PromptTokens; the cache breakdown lives
// on PromptTokensDetails. extractUsage must carry it onto domain.Usage so the
// span can report the fresh input separately and the cost can price each
// bucket once (the cached-follow-up mis-cost bug).
func TestExtractUsage_CacheTokens(t *testing.T) {
	resp := &bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{
			PromptTokens:     37651,
			CompletionTokens: 12,
			TotalTokens:      37663,
			PromptTokensDetails: &bfschemas.ChatPromptTokensDetails{
				CachedReadTokens:  37127,
				CachedWriteTokens: 14,
			},
		},
	}
	u := extractUsage(resp)
	if u.CacheReadTokens != 37127 {
		t.Fatalf("CacheReadTokens: want 37127, got %d", u.CacheReadTokens)
	}
	if u.CacheCreationTokens != 14 {
		t.Fatalf("CacheCreationTokens: want 14, got %d", u.CacheCreationTokens)
	}
	if u.PromptTokens != 37651 {
		t.Fatalf("PromptTokens must stay the provider total (incl cache): got %d", u.PromptTokens)
	}
}

// No PromptTokensDetails block (provider/request without caching) -> cache
// counts stay zero, never negative or panicking on the nil pointer.
func TestExtractUsage_NoCacheDetails(t *testing.T) {
	resp := &bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{PromptTokens: 510, CompletionTokens: 12, TotalTokens: 522},
	}
	u := extractUsage(resp)
	if u.CacheReadTokens != 0 || u.CacheCreationTokens != 0 {
		t.Fatalf("expected zero cache tokens, got read=%d write=%d", u.CacheReadTokens, u.CacheCreationTokens)
	}
}

// The Responses API carries the same breakdown under InputTokensDetails.
func TestExtractResponsesUsage_CacheTokens(t *testing.T) {
	resp := &bfschemas.BifrostResponsesResponse{
		Usage: &bfschemas.ResponsesResponseUsage{
			InputTokens:  37651,
			OutputTokens: 12,
			TotalTokens:  37663,
			InputTokensDetails: &bfschemas.ResponsesResponseInputTokens{
				CachedReadTokens:  37127,
				CachedWriteTokens: 14,
			},
		},
	}
	u := extractResponsesUsage(resp)
	if u.CacheReadTokens != 37127 || u.CacheCreationTokens != 14 {
		t.Fatalf("cache tokens: want read=37127 write=14, got read=%d write=%d", u.CacheReadTokens, u.CacheCreationTokens)
	}
}

// Gemini folds cachedContentTokenCount into promptTokenCount; the passthrough
// usage parser must surface it as CacheReadTokens so the Gemini span splits
// out the fresh input too.
func TestParseGeminiPassthroughUsage_CacheRead(t *testing.T) {
	body := []byte(`data: {"candidates":[],"usageMetadata":{"promptTokenCount":37651,"candidatesTokenCount":12,"totalTokenCount":37663,"cachedContentTokenCount":37127}}`)
	u, ok := parseGeminiPassthroughUsage(body)
	if !ok {
		t.Fatalf("expected usageMetadata to parse")
	}
	if u.CacheReadTokens != 37127 {
		t.Fatalf("CacheReadTokens: want 37127, got %d", u.CacheReadTokens)
	}
	if u.PromptTokens != 37651 {
		t.Fatalf("PromptTokens: want 37651, got %d", u.PromptTokens)
	}
}

// given a Bedrock credential carrying the litellm aws_* key names (the shape
// the gatewayproxy /go/proxy route produces, vs the canonical names the
// dispatcheradapter produces)
// when the credential is mapped to a Bifrost key
// then the AWS credentials land on the BedrockKeyConfig, so the normal
// (non-VPCE) Bedrock path is not left with empty credentials on that route.
func TestCredentialToBifrostKey_BedrockHonorsAWSStyleKeys(t *testing.T) {
	cred := domain.Credential{
		ID:         "c",
		ProviderID: domain.ProviderBedrock,
		Extra: map[string]string{
			"aws_access_key_id":     "AKIA-x",
			"aws_secret_access_key": "secret-x",
			"aws_session_token":     "session-x",
			"aws_region_name":       "us-east-1",
		},
	}
	k := credentialToBifrostKey(cred, bfschemas.Bedrock)
	if k.BedrockKeyConfig == nil {
		t.Fatal("BedrockKeyConfig is nil")
	}
	if k.BedrockKeyConfig.AccessKey.Val != "AKIA-x" {
		t.Errorf("AccessKey = %q, want AKIA-x", k.BedrockKeyConfig.AccessKey.Val)
	}
	if k.BedrockKeyConfig.SecretKey.Val != "secret-x" {
		t.Errorf("SecretKey = %q, want secret-x", k.BedrockKeyConfig.SecretKey.Val)
	}
	if k.BedrockKeyConfig.SessionToken == nil || k.BedrockKeyConfig.SessionToken.Val != "session-x" {
		t.Errorf("SessionToken not honored: %+v", k.BedrockKeyConfig.SessionToken)
	}
	if k.BedrockKeyConfig.Region == nil || k.BedrockKeyConfig.Region.Val != "us-east-1" {
		t.Errorf("Region not honored: %+v", k.BedrockKeyConfig.Region)
	}
}
