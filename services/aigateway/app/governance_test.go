package app

import (
	"errors"
	"testing"

	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestIsAccountExhaustion(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   bool
	}{
		{"anthropic credit-balance 400", 400, `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}`, true},
		{"openai insufficient_quota code", 429, `{"error":{"message":"You exceeded your current quota","type":"insufficient_quota","code":"insufficient_quota"}}`, true},
		{"openai insufficient_quota type only", 403, `{"error":{"message":"quota","type":"insufficient_quota"}}`, true},
		{"generic 402 payment required", 402, `{"error":{"message":"payment required"}}`, true},
		// Must NOT match — these stay verbatim + retryable.
		{"transient rate_limit 429", 429, `{"error":{"message":"Rate limit reached","type":"rate_limit_error"}}`, false},
		{"plain 400 bad request", 400, `{"error":{"message":"messages: field required","type":"invalid_request_error"}}`, false},
		{"provider 503", 503, `{"error":{"message":"overloaded"}}`, false},
		{"500 internal", 500, `{"error":{"message":"oops"}}`, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := isAccountExhaustion(c.status, []byte(c.body)); got != c.want {
				t.Fatalf("isAccountExhaustion(%d, %s) = %v, want %v", c.status, c.body, got, c.want)
			}
		})
	}
}

// rewriteErrorMessage swaps only the human message, preserving the rest of the
// envelope, and is a no-op on bodies without an error.message field.
func TestRewriteErrorMessage(t *testing.T) {
	body := []byte(`{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"},"request_id":"req_123"}`)
	out := rewriteErrorMessage(body, "Contact your admin")

	if got := gjson.GetBytes(out, "error.message").String(); got != "Contact your admin" {
		t.Fatalf("message not rewritten: %q", got)
	}
	if got := gjson.GetBytes(out, "error.type").String(); got != "invalid_request_error" {
		t.Fatalf("error.type must be preserved, got %q", got)
	}
	if got := gjson.GetBytes(out, "request_id").String(); got != "req_123" {
		t.Fatalf("request_id must be preserved, got %q", got)
	}

	noMsg := []byte(`{"detail":"something else"}`)
	if got := rewriteErrorMessage(noMsg, "x"); string(got) != string(noMsg) {
		t.Fatalf("body without error.message must be unchanged, got %q", got)
	}
}

func TestApplyGovernanceMessage_Disabled(t *testing.T) {
	// No configured message -> verbatim passthrough on both shapes.
	cfg := domain.BundleConfig{}
	body := []byte(`{"error":{"message":"Your credit balance is too low"}}`)

	resp := &domain.Response{StatusCode: 400, Body: append([]byte(nil), body...)}
	gotResp, _ := applyGovernanceMessage(cfg, resp, nil)
	if string(gotResp.Body) != string(body) {
		t.Fatalf("disabled: response body must be untouched, got %q", gotResp.Body)
	}

	ue := &domain.UpstreamError{StatusCode: 400, Body: append([]byte(nil), body...), Message: "Your credit balance is too low"}
	_, gotErr := applyGovernanceMessage(cfg, nil, ue)
	var got *domain.UpstreamError
	if errors.As(gotErr, &got); got.Message != "Your credit balance is too low" {
		t.Fatalf("disabled: error message must be untouched, got %q", got.Message)
	}
}

func TestApplyGovernanceMessage_RewritesAccountError(t *testing.T) {
	cfg := domain.BundleConfig{Governance: domain.GovernanceConfig{AccountErrorMessage: "Contact your LangWatch admin"}}
	body := []byte(`{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low"}}`)

	// Stream shape: *UpstreamError.
	ue := &domain.UpstreamError{StatusCode: 400, Body: append([]byte(nil), body...), Message: "Your credit balance is too low"}
	_, gotErr := applyGovernanceMessage(cfg, nil, ue)
	var got *domain.UpstreamError
	errors.As(gotErr, &got)
	if got.Message != "Contact your LangWatch admin" {
		t.Fatalf("UpstreamError.Message not rewritten: %q", got.Message)
	}
	if m := gjson.GetBytes(got.Body, "error.message").String(); m != "Contact your LangWatch admin" {
		t.Fatalf("body message not rewritten: %q", m)
	}
	if got.StatusCode != 400 {
		t.Fatalf("status must be preserved: %d", got.StatusCode)
	}

	// Non-stream shape: Response.
	resp := &domain.Response{StatusCode: 400, Body: append([]byte(nil), body...)}
	gotResp, _ := applyGovernanceMessage(cfg, resp, nil)
	if m := gjson.GetBytes(gotResp.Body, "error.message").String(); m != "Contact your LangWatch admin" {
		t.Fatalf("response body message not rewritten: %q", m)
	}
	if gotResp.StatusCode != 400 {
		t.Fatalf("response status must be preserved: %d", gotResp.StatusCode)
	}
}

// A retryable rate-limit must NOT be re-messaged even when a governance
// message is configured — it stays verbatim and retryable (bug-33 complement).
func TestApplyGovernanceMessage_LeavesRetryableVerbatim(t *testing.T) {
	cfg := domain.BundleConfig{Governance: domain.GovernanceConfig{AccountErrorMessage: "Contact your admin"}}
	body := []byte(`{"error":{"message":"Rate limit reached","type":"rate_limit_error"}}`)

	ue := &domain.UpstreamError{StatusCode: 429, Body: append([]byte(nil), body...), Message: "Rate limit reached"}
	_, gotErr := applyGovernanceMessage(cfg, nil, ue)
	var got *domain.UpstreamError
	errors.As(gotErr, &got)
	if got.Message != "Rate limit reached" {
		t.Fatalf("retryable rate-limit must stay verbatim, got %q", got.Message)
	}
	if m := gjson.GetBytes(got.Body, "error.message").String(); m != "Rate limit reached" {
		t.Fatalf("retryable body must stay verbatim, got %q", m)
	}
}
