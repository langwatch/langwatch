package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
)

// The gateway consumes its attribution control headers: the end-user id (and
// its LiteLLM migration alias) and the metadata echo are lifted into context
// for the span emitter, then DELETED so they never forward upstream. The body
// `user` param, by contrast, passes through untouched.
//
// Spec: specs/ai-gateway/billing-spend-events.feature

func TestEndUserIDFromHeaders(t *testing.T) {
	cases := []struct {
		name    string
		headers map[string]string
		want    string
	}{
		{"native header", map[string]string{"X-LangWatch-End-User-Id": "u-1"}, "u-1"},
		{"litellm alias", map[string]string{"X-Litellm-End-User-Id": "u-2"}, "u-2"},
		{"native wins over alias", map[string]string{
			"X-LangWatch-End-User-Id": "native",
			"X-Litellm-End-User-Id":   "alias",
		}, "native"},
		{"alias fills when native is blank", map[string]string{
			"X-LangWatch-End-User-Id": "   ",
			"X-Litellm-End-User-Id":   "alias",
		}, "alias"},
		{"sanitized", map[string]string{"X-LangWatch-End-User-Id": "  u\x01-3  "}, "u-3"},
		{"none", map[string]string{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := http.Header{}
			for k, v := range tc.headers {
				h.Set(k, v)
			}
			if got := endUserIDFromHeaders(h); got != tc.want {
				t.Fatalf("endUserIDFromHeaders = %q, want %q", got, tc.want)
			}
		})
	}
}

// @scenario "Attribution headers are consumed by the gateway, never forwarded"
func TestCustomerTraceMiddleware_ConsumesAttributionHeaders(t *testing.T) {
	var seenCtxEndUser, seenCtxMetadata string
	var forwarded http.Header
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenCtxEndUser = customertracebridge.EndUserID(r.Context())
		seenCtxMetadata = customertracebridge.RequestMetadataJSON(r.Context())
		forwarded = r.Header.Clone()
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("X-LangWatch-End-User-Id", "u-77")
	req.Header.Set("X-Litellm-End-User-Id", "u-ignored")
	req.Header.Set("X-LangWatch-Metadata", `{"org_id":"acme-9"}`)
	req.Header.Set("X-Unrelated", "stays")

	CustomerTraceMiddleware()(next).ServeHTTP(httptest.NewRecorder(), req)

	if seenCtxEndUser != "u-77" {
		t.Fatalf("context end user = %q, want u-77", seenCtxEndUser)
	}
	if seenCtxMetadata != `{"org_id":"acme-9"}` {
		t.Fatalf("context metadata = %q", seenCtxMetadata)
	}
	for _, name := range []string{"X-LangWatch-End-User-Id", "X-Litellm-End-User-Id", "X-LangWatch-Metadata"} {
		if got := forwarded.Get(name); got != "" {
			t.Fatalf("header %s survived the middleware: %q", name, got)
		}
	}
	if forwarded.Get("X-Unrelated") != "stays" {
		t.Fatalf("unrelated header was dropped")
	}
}

// @scenario "An invalid metadata echo is dropped without failing the request"
func TestCustomerTraceMiddleware_InvalidMetadataDropped(t *testing.T) {
	var seenCtxMetadata string
	var status int
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenCtxMetadata = customertracebridge.RequestMetadataJSON(r.Context())
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", nil)
	req.Header.Set("X-LangWatch-Metadata", `not-json`)
	rec := httptest.NewRecorder()
	CustomerTraceMiddleware()(next).ServeHTTP(rec, req)
	status = rec.Code

	if seenCtxMetadata != "" {
		t.Fatalf("invalid metadata reached the context: %q", seenCtxMetadata)
	}
	if status != http.StatusOK {
		t.Fatalf("request failed on invalid metadata: %d", status)
	}
}
