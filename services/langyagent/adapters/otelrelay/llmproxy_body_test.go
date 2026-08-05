package otelrelay

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
)

// cloudflareInterstitial stands in for the 41 KB Cloudflare Access login page
// a proxied model call was answered with in production: a 403 HTML document
// where an API response belonged, nearly all of it stylesheet.
func cloudflareInterstitial() []byte {
	var b strings.Builder
	b.WriteString("<!DOCTYPE html>\n<html>\n<head>\n<title>\n  Sign in &middot; example.cloudflareaccess.com\n</title>\n<style>\n")
	for range 400 {
		b.WriteString(".cf-error-overview h1{font-size:2.5rem;line-height:1.2;margin:0 0 1rem;color:#313131}\n")
	}
	b.WriteString("</style>\n</head>\n<body><h1>Sign in</h1></body>\n</html>\n")
	return []byte(b.String())
}

// @scenario "A failure in a shape nobody parsed still leaves the operator something to read"
func TestDescribeUpstreamErrorBody(t *testing.T) {
	tests := []struct {
		name        string
		body        []byte
		contentType string
		wantKey     string
		wantValue   string
		wantSkipped bool
	}{
		// Shapes the dialect probe recognizes. These must not regress: the
		// provider's own sentence is the most useful thing in the line.
		{
			name:        "an OpenAI or Anthropic error object",
			body:        []byte(`{"error":{"type":"invalid_request_error","message":"max_tokens is too large"}}`),
			contentType: "application/json",
			wantKey:     "upstream_message",
			wantValue:   "max_tokens is too large",
		},
		{
			name:        "the codex backend's detail",
			body:        []byte(`{"detail":"usage limit reached, resets in 4 hours"}`),
			contentType: "application/json",
			wantKey:     "upstream_message",
			wantValue:   "usage limit reached, resets in 4 hours",
		},
		{
			name:        "a bare message",
			body:        []byte(`{"message":"model is overloaded"}`),
			contentType: "application/json",
			wantKey:     "upstream_message",
			wantValue:   "model is overloaded",
		},

		// Shapes that used to yield "" and take the whole body with them: any
		// JSON the probe did not recognize was discarded because it opened
		// with a brace, leaving the log line holding a byte count.
		{
			name:        "a JSON:API style errors array",
			body:        []byte(`{"errors":[{"detail":"tenant is suspended","status":"403"}]}`),
			contentType: "application/json",
			wantKey:     "raw_body_snippet",
			wantValue:   `{"errors":[{"detail":"tenant is suspended","status":"403"}]}`,
		},
		{
			name:        "an error nested one level deeper than the probe looks",
			body:        []byte(`{"error":{"error":{"message":"region not enabled"}}}`),
			contentType: "application/json",
			wantKey:     "raw_body_snippet",
			wantValue:   `{"error":{"error":{"message":"region not enabled"}}}`,
		},
		{
			name:        "a bare code with no prose at all",
			body:        []byte(`{"code":"ACCOUNT_SUSPENDED"}`),
			contentType: "application/json",
			wantKey:     "raw_body_snippet",
			wantValue:   `{"code":"ACCOUNT_SUSPENDED"}`,
		},
		{
			name:        "a top-level array",
			body:        []byte(`[{"code":"quota"}]`),
			contentType: "application/json",
			wantKey:     "raw_body_snippet",
			wantValue:   `[{"code":"quota"}]`,
		},
		{
			name:        "a message field that is not a string",
			body:        []byte(`{"error":{"message":{"nested":"object"}}}`),
			contentType: "application/json",
			wantKey:     "raw_body_snippet",
			wantValue:   `{"error":{"message":{"nested":"object"}}}`,
		},

		// Plain text survived the old brace check; it still does.
		{
			name:        "plain text from an edge",
			body:        []byte("  upstream connect error or disconnect before headers  "),
			contentType: "text/plain",
			wantKey:     "raw_body_snippet",
			wantValue:   "upstream connect error or disconnect before headers",
		},

		// HTML contributes its title and nothing else, however it is declared.
		{
			name:        "a login page declared as HTML",
			body:        cloudflareInterstitial(),
			contentType: "text/html; charset=UTF-8",
			wantKey:     "html_title",
			wantValue:   "Sign in · example.cloudflareaccess.com",
		},
		{
			name:        "a login page an edge mislabeled as JSON",
			body:        cloudflareInterstitial(),
			contentType: "application/json",
			wantKey:     "html_title",
			wantValue:   "Sign in · example.cloudflareaccess.com",
		},
		{
			name:        "an HTML page with no title",
			body:        []byte("<html><body><h1>502 Bad Gateway</h1></body></html>"),
			contentType: "text/html",
			wantSkipped: true,
		},

		{
			name:        "an empty body",
			body:        []byte("   "),
			contentType: "application/json",
			wantSkipped: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			field := describeUpstreamErrorBody(tt.body, tt.contentType)

			if tt.wantSkipped {
				if field.Type != zapcore.SkipType {
					t.Fatalf("recorded %s=%q, want nothing recorded", field.Key, field.String)
				}
				return
			}
			if field.Key != tt.wantKey {
				t.Errorf("field key = %q, want %q", field.Key, tt.wantKey)
			}
			if field.String != tt.wantValue {
				t.Errorf("field value = %q, want %q", field.String, tt.wantValue)
			}
		})
	}
}

// @scenario "A login page standing in for the API is recorded as a login page"
func TestDescribeUpstreamErrorBody_RecordsATitleNotAStylesheet(t *testing.T) {
	page := cloudflareInterstitial()
	if len(page) < 20*1024 {
		t.Fatalf("fixture is %d bytes, too small to stand in for the real page", len(page))
	}

	field := describeUpstreamErrorBody(page, "text/html")
	if field.Key != "html_title" {
		t.Fatalf("field key = %q, want html_title", field.Key)
	}
	// Bounding the page instead of titling it records 2 KB of stylesheet,
	// which is what makes the bound alone insufficient here.
	if strings.Contains(field.String, "cf-error-overview") {
		t.Errorf("recorded markup: %q", field.String)
	}
	if len(field.String) > 128 {
		t.Errorf("title is %d bytes, longer than any diagnosis needs", len(field.String))
	}
}

// @scenario "A provider message the relay knows is still recorded as one"
func TestLLMProxy_CapturedBodyReachesTheLogLine(t *testing.T) {
	cases := []struct {
		name        string
		contentType string
		body        string
		wantKey     string
		wantValue   string
	}{
		{
			name:        "when the provider answers in a dialect the relay knows",
			contentType: "application/json",
			body:        `{"error":{"type":"invalid_request_error","message":"max_tokens is too large"}}`,
			wantKey:     "upstream_message",
			wantValue:   "max_tokens is too large",
		},
		{
			name:        "when the provider answers in a shape nobody parsed",
			contentType: "application/json",
			body:        `{"errors":[{"detail":"tenant is suspended"}]}`,
			wantKey:     "raw_body_snippet",
			wantValue:   `{"errors":[{"detail":"tenant is suspended"}]}`,
		},
		{
			name:        "when an edge answers with a login page",
			contentType: "text/html; charset=UTF-8",
			body:        string(cloudflareInterstitial()),
			wantKey:     "html_title",
			wantValue:   "Sign in · example.cloudflareaccess.com",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", tc.contentType)
				w.WriteHeader(http.StatusForbidden)
				_, _ = io.WriteString(w, tc.body)
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

			entries := logs.FilterMessage("otelrelay llm error body not a typed envelope; captured best-effort").All()
			if len(entries) != 1 {
				t.Fatalf("best-effort capture logged %d times, want 1", len(entries))
			}
			fields := entries[0].ContextMap()
			if got := fields[tc.wantKey]; got != tc.wantValue {
				t.Errorf("%s = %v, want %q", tc.wantKey, got, tc.wantValue)
			}
			if fields["status"] != int64(http.StatusForbidden) {
				t.Errorf("status = %v, want 403", fields["status"])
			}
		})
	}
}

// @scenario "A failure in a shape nobody parsed still leaves the operator something to read"
func TestDescribeUpstreamErrorBody_BoundsAnUnrecognizedBody(t *testing.T) {
	long := []byte(`{"unknown":"` + strings.Repeat("é", maxUpstreamMessageBytes) + `"}`)

	field := describeUpstreamErrorBody(long, "application/json")
	if field.Key != "raw_body_snippet" {
		t.Fatalf("field key = %q, want raw_body_snippet", field.Key)
	}
	if len(field.String) > maxUpstreamMessageBytes+len("…") {
		t.Errorf("snippet is %d bytes, past the bound", len(field.String))
	}
	if !utf8.ValidString(field.String) {
		t.Error("snippet was cut mid-rune")
	}
}
