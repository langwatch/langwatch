package otelrelay

import (
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/tidwall/gjson"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/langwatch/langwatch/pkg/providererr"
)

// What the AI gateway answers a streaming /v1/messages call on an Anthropic
// account with no credit left: Anthropic's 400 body with its message replaced
// by the gateway's governance message, and the provider's x-should-retry.
const gatewayCreditExhaustedBody = `{"type":"error","error":{"message":"Your organization's AI gateway access is exhausted. Contact your LangWatch admin.","type":"invalid_request_error"},"request_id":"req_011CTest"}`

// Anthropic's own body for the same failure, which a gateway older than the
// stream-open fix forwarded as a 200 event stream of bare JSON.
const anthropicCreditBalanceBody = `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011CTest"}`

// countingGateway answers every call with status, contentType and body, and
// counts the calls it receives.
func countingGateway(t *testing.T, status int, contentType, body string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", contentType)
		if status >= 400 {
			w.Header().Set("X-Should-Retry", "false")
		}
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}))
	t.Cleanup(srv.Close)
	return srv, &calls
}

// @scenario "A spent balance behind the AI gateway still rides as out of credit"
func TestLLMProxy_SpentBalanceBehindTheGatewayIsOutOfCredit(t *testing.T) {
	cases := []struct {
		name        string
		status      int
		contentType string
		body        string
	}{
		{"the gateway's 400 with its governance message", http.StatusBadRequest, "application/json", gatewayCreditExhaustedBody},
		{"a 200 event stream of Anthropic's bare 400 body", http.StatusOK, "text/event-stream", anthropicCreditBalanceBody},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gateway, calls := countingGateway(t, tc.status, tc.contentType, tc.body)
			relay := startRelay(t)
			token, _ := relay.Register(WorkerInfo{ConversationID: "conv-credit", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

			resp := rateLimitCall(t, relay, token)
			body, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != http.StatusBadRequest {
				t.Fatalf("relay answered %d, want 400: the SDK retries anything else", resp.StatusCode)
			}
			if string(body) != tc.body {
				t.Errorf("body altered in flight:\n got %s\nwant %s", body, tc.body)
			}
			if got := calls.Load(); got != 1 {
				t.Errorf("gateway saw %d calls, want 1", got)
			}
			e, ok := relay.LastLLMError(token)
			if !ok {
				t.Fatal("the spent balance left no captured cause")
			}
			if codes := reasonCodes(e); !slices.Contains(codes, ErrProviderOutOfCredit) {
				t.Errorf("reasons = %v, want %s", codes, ErrProviderOutOfCredit)
			}
			if _, hasMessage := e.Meta["message"]; hasMessage {
				t.Errorf("captured message = %v, want the provider's prose dropped", e.Meta["message"])
			}
		})
	}
}

// @scenario "A bare JSON error that is transient keeps its retries"
func TestLLMProxy_BareTransientStreamErrorKeepsItsRetryableStatus(t *testing.T) {
	cases := []struct {
		body string
		want int
	}{
		{`{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`, 529},
		{`{"type":"error","error":{"type":"rate_limit_error","message":"slow down"}}`, http.StatusTooManyRequests},
		{`{"type":"error","error":{"type":"api_error","message":"Internal server error"}}`, http.StatusInternalServerError},
	}
	for _, tc := range cases {
		t.Run(gjsonErrorType(tc.body), func(t *testing.T) {
			gateway, _ := countingGateway(t, http.StatusOK, "text/event-stream", tc.body)
			relay := startRelay(t)
			token, _ := relay.Register(WorkerInfo{ConversationID: "conv-bare-transient", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
			resp := rateLimitCall(t, relay, token)
			body, _ := io.ReadAll(resp.Body)
			if resp.StatusCode != tc.want {
				t.Errorf("answered %d, want %d", resp.StatusCode, tc.want)
			}
			if string(body) != tc.body {
				t.Errorf("body altered in flight:\n got %s\nwant %s", body, tc.body)
			}
		})
	}

	t.Run("a healthy stream passes through untouched", func(t *testing.T) {
		gateway, _ := countingGateway(t, http.StatusOK, "text/event-stream", cleanStream)
		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "conv-healthy", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
		resp := rateLimitCall(t, relay, token)
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK {
			t.Errorf("answered %d, want 200", resp.StatusCode)
		}
		if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
			t.Errorf("Content-Type = %q, want text/event-stream", ct)
		}
		if string(body) != cleanStream {
			t.Errorf("stream altered in flight:\n got %s\nwant %s", body, cleanStream)
		}
	})
}

func gjsonErrorType(body string) string {
	return gjson.Get(body, "error.type").Str
}

// @scenario "The retold span of a failed model call says why it failed"
func TestLLMProxy_FailedCallSpanSaysWhy(t *testing.T) {
	t.Run("a rejected call records status, type, cause and message", func(t *testing.T) {
		gateway, _ := countingGateway(t, http.StatusBadRequest, "application/json", gatewayCreditExhaustedBody)
		span := failedCallSpan(t, gateway.URL)
		wantStr(t, span, "error.type", "invalid_request_error")
		wantStr(t, span, "langwatch.langy.error_cause", string(ErrProviderOutOfCredit))
		wantStr(t, span, "error.message", providererr.GatewayAccountExhaustedMessage)
		wantStatus(t, span, http.StatusBadRequest)
	})

	t.Run("an error event inside a 200 stream marks the span failed", func(t *testing.T) {
		gateway, _ := countingGateway(t, http.StatusOK, "text/event-stream", quotaFailingStream)
		span := failedCallSpan(t, gateway.URL)
		wantStr(t, span, "error.type", "insufficient_quota")
		wantStr(t, span, "langwatch.langy.error_cause", string(ErrProviderOutOfCredit))
		wantStatus(t, span, http.StatusOK)
	})

	t.Run("a refused key's message stays off the span", func(t *testing.T) {
		gateway, _ := countingGateway(t, http.StatusUnauthorized, "application/json",
			`{"error":{"message":"Incorrect API key provided.","type":"invalid_request_error","code":"invalid_api_key"}}`)
		span := failedCallSpan(t, gateway.URL)
		wantStr(t, span, "error.type", "invalid_api_key")
		wantNoMessage(t, span)
		wantStatus(t, span, http.StatusUnauthorized)
	})

	t.Run("a provider's own billing sentence stays off the span", func(t *testing.T) {
		gateway, _ := countingGateway(t, http.StatusBadRequest, "application/json",
			`{"type":"error","error":{"type":"invalid_request_error","message":"Credit balance exhausted for credential SECRET_VALUE"}}`)
		span := failedCallSpan(t, gateway.URL)
		wantStr(t, span, "langwatch.langy.error_cause", string(ErrProviderOutOfCredit))
		wantNoMessage(t, span)
	})

	t.Run("any other provider message stays off the span", func(t *testing.T) {
		gateway, _ := countingGateway(t, http.StatusBadRequest, "application/json",
			`{"type":"error","error":{"type":"invalid_request_error","message":"thinking.type.enabled is not supported for this model."}}`)
		span := failedCallSpan(t, gateway.URL)
		wantStr(t, span, "error.type", "invalid_request_error")
		wantNoMessage(t, span)
		wantStatus(t, span, http.StatusBadRequest)
	})
}

func wantNoMessage(t *testing.T, span ptrace.Span) {
	t.Helper()
	if v, ok := span.Attributes().Get("error.message"); ok {
		t.Errorf("error.message = %q, want no provider prose", v.Str())
	}
	if msg := span.Status().Message(); msg != "" {
		t.Errorf("span status message = %q, want none", msg)
	}
}

func failedCallSpan(t *testing.T, gatewayURL string) ptrace.Span {
	t.Helper()
	relay := startRelay(t)
	ingest := startSignallingIngest(t)
	token := registerPiWorker(t, relay, gatewayURL, ingest.srv.URL)
	resp, err := http.Post(relay.LLMBaseURLFor(token)+"/v1/messages", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("proxied call: %v", err)
	}
	_, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	_, span := firstSpan(t, ingest.await(t))
	if span.Status().Code() != ptrace.StatusCodeError {
		t.Errorf("span status = %v, want Error", span.Status().Code())
	}
	return span
}

func wantStr(t *testing.T, span ptrace.Span, key, want string) {
	t.Helper()
	if v, ok := span.Attributes().Get(key); !ok || v.Str() != want {
		t.Errorf("%s = %q, want %q", key, v.Str(), want)
	}
}

func wantStatus(t *testing.T, span ptrace.Span, want int) {
	t.Helper()
	if v, ok := span.Attributes().Get("http.response.status_code"); !ok || v.Int() != int64(want) {
		t.Errorf("http.response.status_code = %d, want %d", v.Int(), want)
	}
}
