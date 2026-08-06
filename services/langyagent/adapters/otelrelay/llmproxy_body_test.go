package otelrelay

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
)

func handledReasonCode(t *testing.T, e herr.E) herr.Code {
	t.Helper()
	if len(e.Reasons) != 1 {
		t.Fatalf("reasons = %v, want one handled reason", e.Reasons)
	}
	var reason herr.E
	if !errors.As(e.Reasons[0], &reason) {
		t.Fatalf("reason = %T, want herr.E", e.Reasons[0])
	}
	return reason.Code
}

// @scenario "Provider JSON discriminants become handled error reasons"
func TestProviderErrorCode_KnownJSONDialects(t *testing.T) {
	tests := []struct {
		name string
		body string
		want herr.Code
	}{
		{
			name: "OpenAI code wins over its broad type",
			body: `{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"secret"}}`,
			want: "invalid_api_key",
		},
		{
			name: "OpenAI or Anthropic error type",
			body: `{"error":{"type":"usage_limit_reached","message":"limit"}}`,
			want: "usage_limit_reached",
		},
		{
			name: "top-level provider code",
			body: `{"code":"ACCOUNT_SUSPENDED","message":"suspended"}`,
			want: "ACCOUNT_SUSPENDED",
		},
		{
			name: "top-level provider type",
			body: `{"type":"overloaded_error","message":"busy"}`,
			want: "overloaded_error",
		},
		{
			name: "nested error code",
			body: `{"error":{"error":{"code":"region_not_enabled","message":"region"}}}`,
			want: "region_not_enabled",
		},
		{
			name: "JSON API errors array",
			body: `{"errors":[{"code":"tenant_suspended","detail":"tenant"}]}`,
			want: "tenant_suspended",
		},
		{
			name: "Gemini's numeric code falls back to its status discriminant",
			body: `{"error":{"code":429,"message":"quota exceeded","status":"RESOURCE_EXHAUSTED"}}`,
			want: "RESOURCE_EXHAUSTED",
		},
		{
			name: "a hard-limit type wins over an unrelated code, regardless of path order",
			body: `{"error":{"type":"usage_limit_reached","code":"rate_limit_exceeded"}}`,
			want: "usage_limit_reached",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := providerErrorCode([]byte(tt.body)); got != tt.want {
				t.Fatalf("providerErrorCode() = %q, want %q", got, tt.want)
			}
		})
	}
}

// @scenario "Every upstream HTTP status maps to a stable reason code"
func TestUpstreamHTTPReasonCode_AllBranches(t *testing.T) {
	tests := []struct {
		status int
		want   herr.Code
	}{
		{http.StatusUnauthorized, "upstream_unauthorized"},
		{http.StatusNotFound, "upstream_not_found"},
		{http.StatusRequestTimeout, "upstream_timeout"},
		{http.StatusConflict, "upstream_conflict"},
		{http.StatusTeapot, "upstream_http_error"},
		{http.StatusUnprocessableEntity, "upstream_unprocessable_entity"},
		{http.StatusTooManyRequests, "upstream_rate_limited"},
		{http.StatusGatewayTimeout, "upstream_timeout"},
		{http.StatusBadRequest, "upstream_bad_request"},
		{http.StatusForbidden, "upstream_forbidden"},
		{http.StatusBadGateway, "upstream_unavailable"},
	}
	for _, tt := range tests {
		t.Run(strconv.Itoa(tt.status), func(t *testing.T) {
			if got := upstreamHTTPReasonCode(tt.status); got != tt.want {
				t.Errorf("upstreamHTTPReasonCode(%d) = %q, want %q", tt.status, got, tt.want)
			}
		})
	}
}

// @scenario "A provider body's shape is classified for safe logging"
func TestProviderBodyKind_Classification(t *testing.T) {
	tests := []struct {
		name        string
		body        string
		contentType string
		want        string
	}{
		{"empty body", "", "application/json", "empty"},
		{"whitespace-only body", "   \n", "application/json", "empty"},
		{"valid json", `{"error":"nope"}`, "application/json", "json"},
		{"html content-type without a doctype", "Sign in required", "text/html", "html"},
		{"body starting with the html tag", "<html><body>nope</body></html>", "text/plain", "html"},
		{"plain text", "internal server error", "text/plain", "text"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := providerBodyKind([]byte(tt.body), tt.contentType); got != tt.want {
				t.Errorf("providerBodyKind() = %q, want %q", got, tt.want)
			}
		})
	}
}

// @scenario "A stream error with no HTTP status still carries a reason"
func TestDecodeProviderErrorBody_NoStatusGetsAStableReason(t *testing.T) {
	e := decodeProviderErrorBody([]byte(`{"detail":"connection reset"}`), 0, "text/event-stream")
	if got := handledReasonCode(t, e); got != "upstream_stream_error" {
		t.Errorf("reason = %q, want upstream_stream_error", got)
	}
	if _, ok := e.Meta["http_status"]; ok {
		t.Error("status-0 capture must not fabricate an http_status")
	}
}

func TestProviderErrorCode_RejectsProseAndMalformedJSON(t *testing.T) {
	secret := "Incorrect API key provided: sk-proj-do-not-record"
	for _, body := range []string{
		`{"error":{"code":"` + secret + `"}}`,
		`{"error":{"message":"` + secret + `"}}`,
		`{"error":{"code":"invalid key with spaces"}}`,
		`{"error":{"code":"unterminated"}`,
	} {
		if got := providerErrorCode([]byte(body)); got != "" {
			t.Errorf("providerErrorCode(%q) = %q, want no discriminant", body, got)
		}
	}
}

// @scenario "Observed upstream response shapes become safe handled errors"
func TestDecodeProviderErrorBody_ObservedProductionShapes(t *testing.T) {
	tests := []struct {
		name        string
		body        []byte
		status      int
		contentType string
		wantCode    herr.Code
		wantKind    string
	}{
		{
			name:        "usage-limit JSON keeps its provider code",
			body:        []byte(`{"error":{"type":"usage_limit_reached","message":"You've hit your usage limit."}}`),
			status:      http.StatusTooManyRequests,
			contentType: "application/json",
			wantCode:    "usage_limit_reached",
			wantKind:    "json",
		},
		{
			name:        "message-only invalid-model JSON gets a stable HTTP reason",
			body:        []byte(`{"detail":"The provided model identifier is invalid."}`),
			status:      http.StatusBadRequest,
			contentType: "application/json",
			wantCode:    "upstream_bad_request",
			wantKind:    "json",
		},
		{
			name:        "plain proxy 502",
			body:        []byte("error code: 502"),
			status:      http.StatusBadGateway,
			contentType: "application/json",
			wantCode:    "upstream_unavailable",
			wantKind:    "text",
		},
		{
			name:        "Cloudflare interstitial mislabeled as JSON",
			body:        []byte("<!doctype html><html><head><title>Sign in</title></head></html>"),
			status:      http.StatusForbidden,
			contentType: "application/json",
			wantCode:    "upstream_forbidden",
			wantKind:    "html",
		},
		{
			name:        "binary upstream body",
			body:        []byte{0x1f, 0x8b, 0xff, 0xfe},
			status:      http.StatusBadGateway,
			contentType: "application/json",
			wantCode:    "upstream_unavailable",
			wantKind:    "binary",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := decodeProviderErrorBody(tt.body, tt.status, tt.contentType)
			if e.Code != llmUpstreamErrorCode {
				t.Fatalf("code = %q, want %q", e.Code, llmUpstreamErrorCode)
			}
			if got := handledReasonCode(t, e); got != tt.wantCode {
				t.Errorf("reason = %q, want %q", got, tt.wantCode)
			}
			if got := e.Meta["body_kind"]; got != tt.wantKind {
				t.Errorf("body_kind = %v, want %q", got, tt.wantKind)
			}
			if got := e.Meta["http_status"]; got != tt.status {
				t.Errorf("http_status = %v, want %d", got, tt.status)
			}
			if _, ok := e.Meta["message"]; ok {
				t.Error("provider prose must not enter handled-error metadata")
			}
		})
	}
}

// @scenario "Only a marked LangWatch envelope is trusted as a handled error"
func TestDecodeLLMErrorBody_TrustsOnlyMarkedHandledEnvelopes(t *testing.T) {
	t.Run("preserves a marked gateway envelope", func(t *testing.T) {
		body := []byte(`{"error":{"type":"missing_model","code":"missing_model","message":"Choose a model.","meta":{"fault":"customer"}}}`)
		e, typed := decodeLLMErrorBody(body, "missing_model", http.StatusBadRequest, "application/json")
		if !typed {
			t.Fatal("gateway herr envelope was not recognized")
		}
		if e.Code != "missing_model" || e.Meta["message"] != "Choose a model." {
			t.Fatalf("decoded envelope = %#v", e)
		}
	})

	t.Run("normalizes an unmarked provider lookalike", func(t *testing.T) {
		body := []byte(`{"error":{"type":"invalid_api_key","code":"invalid_api_key","message":"Incorrect API key: sk-proj-do-not-expose"}}`)
		for _, marker := range []string{"", "different_code"} {
			e, typed := decodeLLMErrorBody(body, marker, http.StatusUnauthorized, "application/json")
			if typed {
				t.Fatalf("marker %q made provider JSON a trusted gateway envelope", marker)
			}
			if got := handledReasonCode(t, e); got != "invalid_api_key" {
				t.Errorf("reason = %q, want invalid_api_key", got)
			}
			if _, ok := e.Meta["message"]; ok {
				t.Error("untrusted provider prose entered handled metadata")
			}
		}
	})
}

// @scenario "Upstream-relayed prose is scrubbed from marked provider_error envelopes"
func TestLLMProxy_ScrubsUpstreamRelayedProseFromMarkedEnvelopes(t *testing.T) {
	newGateway := func(status int, body string, handledCode string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set(herr.HandledErrorHeader, handledCode)
			w.WriteHeader(status)
			_, _ = io.WriteString(w, body)
		}))
	}

	t.Run("when a marked provider_error envelope carries upstream text", func(t *testing.T) {
		secret := "sk-proj-do-not-record"
		body := `{"error":{"type":"provider_error","code":"provider_error","message":"upstream said: ` + secret + `"}}`
		gateway := newGateway(http.StatusBadGateway, body, "provider_error")
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
		relay.SetTurnContext(token, turnContext())

		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		e, ok := relay.LastLLMError(token)
		if !ok {
			t.Fatal("LastLLMError must expose the captured herr")
		}
		if e.Code != "provider_error" {
			t.Fatalf("captured code = %q, want provider_error", e.Code)
		}
		if msg, ok := e.Meta["message"]; ok {
			t.Errorf("upstream-relayed message survived scrub: %v", msg)
		}
		if _, ok := e.Meta["http_status"]; !ok {
			t.Error("http_status must survive the scrub")
		}
	})

	t.Run("when a marked missing_model envelope keeps its message", func(t *testing.T) {
		body := `{"error":{"type":"missing_model","code":"missing_model","message":"Choose a model."}}`
		gateway := newGateway(http.StatusBadRequest, body, "missing_model")
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
		relay.SetTurnContext(token, turnContext())

		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		_, _ = io.Copy(io.Discard, resp.Body)
		resp.Body.Close()

		e, ok := relay.LastLLMError(token)
		if !ok {
			t.Fatal("LastLLMError must expose the captured herr")
		}
		if e.Meta["message"] != "Choose a model." {
			t.Errorf("captured message = %v, want the gateway's own copy preserved", e.Meta["message"])
		}
	})
}

// @scenario "Untrusted provider prose never enters relay logs"
func TestLLMProxy_LogsOnlyTheHandledClassification(t *testing.T) {
	secret := "sk-proj-do-not-record"
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = io.WriteString(w, `{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Incorrect API key provided: `+secret+`"}}`)
	}))
	defer gateway.Close()

	core, logs := observer.New(zapcore.DebugLevel)
	relay, err := New(clog.Set(context.Background(), zap.New(core)), Options{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = relay.Shutdown(ctx)
	})

	token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
	resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("proxied LLM call: %v", err)
	}
	_, _ = io.Copy(io.Discard, resp.Body)
	_ = resp.Body.Close()

	normalized := logs.FilterMessage("otelrelay llm error normalized as handled upstream error").All()
	if len(normalized) != 1 {
		t.Fatalf("normalization logged %d times, want 1", len(normalized))
	}
	fields := normalized[0].ContextMap()
	if fields["upstream_code"] != "invalid_api_key" || fields["body_kind"] != "json" {
		t.Errorf("safe fields = %#v", fields)
	}
	for _, forbidden := range []string{"upstream_message", "raw_body_snippet", "html_title", "html_excerpt"} {
		if _, ok := fields[forbidden]; ok {
			t.Errorf("unsafe field %q was logged", forbidden)
		}
	}

	// The two checks above only look at the fields the normalization log line
	// is documented to carry. Scan every entry the relay logged for this call
	// — message and every context value — so a secret introduced through a
	// different field or a different log line still fails this test.
	for _, entry := range logs.All() {
		if strings.Contains(entry.Message, secret) {
			t.Errorf("secret leaked in log message %q", entry.Message)
		}
		for key, value := range entry.ContextMap() {
			if strings.Contains(fmt.Sprint(value), secret) {
				t.Errorf("secret leaked in log field %q: %v", key, value)
			}
		}
	}
}
