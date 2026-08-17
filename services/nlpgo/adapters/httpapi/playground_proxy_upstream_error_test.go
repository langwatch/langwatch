package httpapi

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// A provider-origin failure must reach the caller as the provider's own
// verdict, on the /go/proxy lane exactly as on the gateway's own router.
//
// Before this, every dispatch error on this lane became a 502
// "gateway_unavailable" with meta.reason "dispatcher_error": the upstream
// status, error type and body were all discarded. A provider answering 429
// insufficient_quota reached the caller as an unexplained 502 from us, so the
// AI SDK spent its three retries on a terminal error and the scenario runner
// died reporting that our gateway was unavailable when it was up throughout.
//
// @scenario "The nlp service's proxy lane forwards an upstream verdict verbatim"
// @see specs/ai-gateway/error-transparency.feature
func TestPlaygroundProxy_UpstreamError_ForwardedVerbatim(t *testing.T) {
	fake := &fakeProxy{
		syncErr: &domain.UpstreamError{
			StatusCode: http.StatusTooManyRequests,
			Body:       []byte(`{"error":{"type":"insufficient_quota","message":"You exceeded your current quota"}}`),
			Message:    "You exceeded your current quota",
			ErrorType:  "insufficient_quota",
			Provider:   "openai",
			Headers:    map[string]string{"Retry-After": "30"},
		},
	}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("x-litellm-model", "openai/gpt-5-mini")
	req.Header.Set("x-litellm-api_key", "sk-test")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusTooManyRequests {
		t.Errorf("status = %d, want 429 forwarded verbatim (not masked as 502)", resp.StatusCode)
	}
	if !bytes.Contains(respBody, []byte("insufficient_quota")) {
		t.Errorf("body = %s, want the provider's own error type", respBody)
	}
	if bytes.Contains(respBody, []byte("gateway_unavailable")) {
		t.Errorf("body = %s, must not relabel a provider verdict as our own outage", respBody)
	}
	if got := resp.Header.Get("Retry-After"); got != "30" {
		t.Errorf("Retry-After = %q, want the upstream backoff hint preserved", got)
	}
	if got := resp.Header.Get("X-LangWatch-Provider"); got != "openai" {
		t.Errorf("X-LangWatch-Provider = %q, want the upstream named", got)
	}
}

// The streaming lane must agree with the non-streaming one when the stream
// never opened — error-transparency.feature makes that an explicit contract,
// because a client that reads only the status would otherwise retry a terminal
// error on one lane and not the other.
//
// @scenario "The proxy lane's streaming and non-streaming paths agree"
func TestPlaygroundProxy_UpstreamError_ForwardedVerbatimOnStreamingLane(t *testing.T) {
	fake := &fakeProxy{
		streamErr: &domain.UpstreamError{
			StatusCode: http.StatusBadRequest,
			Body:       []byte(`{"error":{"type":"invalid_request_error","message":"credit balance too low"}}`),
			Message:    "credit balance too low",
			ErrorType:  "invalid_request_error",
		},
	}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"openai/gpt-5-mini","stream":true,"messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("x-litellm-model", "openai/gpt-5-mini")
	req.Header.Set("x-litellm-api_key", "sk-test")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status = %d, want the terminal 400 forwarded, not a retryable 502", resp.StatusCode)
	}
	if !bytes.Contains(respBody, []byte("credit balance too low")) {
		t.Errorf("body = %s, want the provider's own message", respBody)
	}
}

// A failure that is genuinely ours keeps the gateway_unavailable envelope — the
// fix must not turn every dispatch error into a forwarded provider verdict.
//
// @scenario "A failure that is genuinely ours still reads as ours"
func TestPlaygroundProxy_NonUpstreamDispatchError_StaysGatewayUnavailable(t *testing.T) {
	fake := &fakeProxy{syncErr: errors.New("dispatcher: Request.Type is required")}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("x-litellm-model", "openai/gpt-5-mini")
	req.Header.Set("x-litellm-api_key", "sk-test")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if !bytes.Contains(respBody, []byte("gateway_unavailable")) {
		t.Errorf("body = %s, want our own gateway_unavailable envelope for a non-upstream failure", respBody)
	}
}
