package otelrelay

import (
	"bytes"
	"io"
	"net/http"
	"strings"
	"testing"
)

// Spec: specs/model-providers/codex-account-provider.feature — codex turns
// run opencode's native openai provider, and the proxy restores the full
// provider-prefixed model id on the wire so the gateway routes to the codex
// credential.

func proxyRequest(t *testing.T, body string) *http.Request {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, "http://gateway.test/v1/responses",
		io.NopCloser(strings.NewReader(body)))
	if err != nil {
		t.Fatal(err)
	}
	req.ContentLength = int64(len(body))
	return req
}

func readBody(t *testing.T, req *http.Request) string {
	t.Helper()
	raw, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestRewriteCodexModelBody_RestoresThePrefixedId(t *testing.T) {
	req := proxyRequest(t, `{"model":"gpt-5.6-terra","input":[],"stream":true}`)
	rewriteCodexModelBody(req, "openai_codex/gpt-5.6-terra")

	body := readBody(t, req)
	if !strings.Contains(body, `"model":"openai_codex/gpt-5.6-terra"`) {
		t.Errorf("model not rewritten: %s", body)
	}
	if !strings.Contains(body, `"stream":true`) {
		t.Errorf("other fields lost: %s", body)
	}
	if req.ContentLength != int64(len(body)) {
		t.Errorf("ContentLength %d does not match body %d", req.ContentLength, len(body))
	}
}

func TestRewriteCodexModelBody_LeavesOtherTurnsAlone(t *testing.T) {
	original := `{"model":"gpt-5-mini","input":[]}`
	req := proxyRequest(t, original)
	rewriteCodexModelBody(req, "openai/gpt-5-mini")
	if got := readBody(t, req); got != original {
		t.Errorf("non-codex body changed: %s", got)
	}
}

func TestRewriteCodexModelBody_RestoresUnparseableBodiesUntouched(t *testing.T) {
	original := "not json at all"
	req := proxyRequest(t, original)
	rewriteCodexModelBody(req, "openai_codex/gpt-5.6-terra")
	if got := readBody(t, req); got != original {
		t.Errorf("unparseable body changed: %q", got)
	}
	if req.ContentLength != int64(len(original)) {
		t.Errorf("ContentLength drifted: %d", req.ContentLength)
	}
}

func TestRewriteCodexModelBody_NilBodySafe(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "http://gateway.test/v1/models", nil)
	if err != nil {
		t.Fatal(err)
	}
	rewriteCodexModelBody(req, "openai_codex/gpt-5.6-terra")
	if req.Body != nil && req.Body != http.NoBody {
		raw, _ := io.ReadAll(req.Body)
		if !bytes.Equal(raw, nil) && len(raw) > 0 {
			t.Errorf("nil body grew content: %q", raw)
		}
	}
}
