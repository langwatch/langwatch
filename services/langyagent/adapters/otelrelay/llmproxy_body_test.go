package otelrelay

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
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
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := providerErrorCode([]byte(tt.body)); got != tt.want {
				t.Fatalf("providerErrorCode() = %q, want %q", got, tt.want)
			}
		})
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

func TestDecodeLLMErrorBody_PreservesGatewayHandledEnvelope(t *testing.T) {
	body := []byte(`{"error":{"type":"missing_model","code":"missing_model","message":"Choose a model.","meta":{"fault":"customer"}}}`)
	e, typed := decodeLLMErrorBody(body, "missing_model", http.StatusBadRequest, "application/json")
	if !typed {
		t.Fatal("gateway herr envelope was not recognized")
	}
	if e.Code != "missing_model" || e.Meta["message"] != "Choose a model." {
		t.Fatalf("decoded envelope = %#v", e)
	}
}

func TestDecodeLLMErrorBody_DoesNotTrustAnUnmarkedProviderLookalike(t *testing.T) {
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

	entries := logs.FilterMessage("otelrelay llm error normalized as handled upstream error").All()
	if len(entries) != 1 {
		t.Fatalf("normalization logged %d times, want 1", len(entries))
	}
	fields := entries[0].ContextMap()
	if fields["upstream_code"] != "invalid_api_key" || fields["body_kind"] != "json" {
		t.Errorf("safe fields = %#v", fields)
	}
	if serialized := entries[0].Message + entries[0].ContextMap()["upstream_code"].(string); strings.Contains(serialized, secret) {
		t.Fatal("provider credential entered relay logs")
	}
	for _, forbidden := range []string{"upstream_message", "raw_body_snippet", "html_title", "html_excerpt"} {
		if _, ok := fields[forbidden]; ok {
			t.Errorf("unsafe field %q was logged", forbidden)
		}
	}
}
