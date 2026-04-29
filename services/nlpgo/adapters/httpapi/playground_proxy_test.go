package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// fakeProxy is a minimal PlaygroundProxy stub for handler tests. It
// records the inbound request and replies with whatever the test set.
type fakeProxy struct {
	syncResp   *playgroundProxyResponse
	syncErr    error
	streamCh   chan []byte
	streamErr  error
	gotRequest playgroundProxyRequest
	called     int
}

func (f *fakeProxy) Dispatch(_ context.Context, req playgroundProxyRequest) (*playgroundProxyResponse, error) {
	f.called++
	f.gotRequest = req
	if f.syncErr != nil {
		return nil, f.syncErr
	}
	return f.syncResp, nil
}

func (f *fakeProxy) DispatchStream(_ context.Context, req playgroundProxyRequest) (playgroundProxyStream, error) {
	f.called++
	f.gotRequest = req
	if f.streamErr != nil {
		return nil, f.streamErr
	}
	return &fakeStream{ch: f.streamCh}, nil
}

type fakeStream struct {
	ch     chan []byte
	cur    []byte
	closed bool
	err    error
}

func (s *fakeStream) Next(_ context.Context) bool {
	if s.closed {
		return false
	}
	chunk, ok := <-s.ch
	if !ok {
		s.closed = true
		return false
	}
	s.cur = chunk
	return true
}
func (s *fakeStream) Chunk() []byte { return s.cur }
func (s *fakeStream) Err() error    { return s.err }
func (s *fakeStream) Close() error  { s.closed = true; return nil }

func newProxyTestServer(t *testing.T, fake *fakeProxy) *httptest.Server {
	t.Helper()
	probes := health.New("test")
	probes.MarkStarted()
	router := NewRouter(RouterDeps{
		Health:          probes,
		Version:         "test",
		PlaygroundProxy: fake,
	})
	srv := httptest.NewServer(router)
	t.Cleanup(srv.Close)
	return srv
}

func TestPlaygroundProxy_NonStreamingChatCompletions_ForwardsBodyAndCredential(t *testing.T) {
	fake := &fakeProxy{
		syncResp: &playgroundProxyResponse{
			StatusCode: 200,
			Headers:    http.Header{"Content-Type": []string{"application/json"}},
			Body:       []byte(`{"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content":"hello"}}]}`),
		},
	}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"openai/gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-litellm-model", "openai/gpt-5-mini")
	req.Header.Set("x-litellm-api_key", "sk-test")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, respBody)
	}
	respBody, _ := io.ReadAll(resp.Body)
	if !bytes.Contains(respBody, []byte(`"hello"`)) {
		t.Errorf("response body lost upstream content: %s", respBody)
	}

	// Wire-shape: dispatcher saw the bare model + the right RequestType.
	if fake.gotRequest.Type != domain.RequestTypeChat {
		t.Errorf("Type = %q, want chat", fake.gotRequest.Type)
	}
	if fake.gotRequest.Model != "gpt-5-mini" {
		t.Errorf("Model = %q, want gpt-5-mini (provider prefix stripped)", fake.gotRequest.Model)
	}
	if fake.gotRequest.Credential.ProviderID != domain.ProviderOpenAI {
		t.Errorf("ProviderID = %q", fake.gotRequest.Credential.ProviderID)
	}
	if fake.gotRequest.Credential.APIKey != "sk-test" {
		t.Errorf("APIKey = %q", fake.gotRequest.Credential.APIKey)
	}
	// body.model is rewritten to the bare id before dispatch. OpenAI
	// rejects the langwatch-internal "openai/gpt-5-mini" prefix in body.model
	// with `{"error":"invalid model ID"}`, and Bifrost raw-forwards the body
	// to OpenAI for OpenAI-compatible providers (bifrost_parser.go:50-58),
	// so the rewrite has to happen at this layer. Caught by Studio Monaco
	// code-completion 500s on FF=on (2026-04-29 dogfood).
	if bytes.Contains(fake.gotRequest.Body, []byte("openai/gpt-5-mini")) {
		t.Errorf("body.model should be rewritten from 'openai/gpt-5-mini' to bare 'gpt-5-mini', got: %s", fake.gotRequest.Body)
	}
	if !bytes.Contains(fake.gotRequest.Body, []byte(`"model":"gpt-5-mini"`)) {
		t.Errorf("body.model should be 'gpt-5-mini' (bare), got: %s", fake.gotRequest.Body)
	}
	// Other body fields preserved (key order may shift through json
	// round-trip; we assert the content via Unmarshal).
	var roundTripped struct {
		Messages []struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(fake.gotRequest.Body, &roundTripped); err != nil {
		t.Fatalf("forwarded body is not valid JSON: %v\n%s", err, fake.gotRequest.Body)
	}
	if len(roundTripped.Messages) != 1 || roundTripped.Messages[0].Role != "user" || roundTripped.Messages[0].Content != "hi" {
		t.Errorf("messages array contents lost in rewrite, got: %+v", roundTripped.Messages)
	}
}

func TestPlaygroundProxy_NonReasoningModelBodyForwardedByteForByte(t *testing.T) {
	// For non-reasoning models, when the caller already sends a bare
	// model id (no provider prefix), the body is forwarded byte-for-byte
	// — preserving OpenAI's prompt-prefix auto-cache hits for the common
	// playground-tRPC / model.factory.ts callers that already speak the
	// OpenAI wire format directly. (Reasoning models trigger
	// ApplyReasoningOverrides and are covered separately below.)
	fake := &fakeProxy{
		syncResp: &playgroundProxyResponse{
			StatusCode: 200,
			Headers:    http.Header{"Content-Type": []string{"application/json"}},
			Body:       []byte(`{"id":"chatcmpl-1","choices":[]}`),
		},
	}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-litellm-model", "openai/gpt-4o")
	req.Header.Set("x-litellm-api_key", "sk-test")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, respBody)
	}
	if string(fake.gotRequest.Body) != body {
		t.Errorf("body should be forwarded byte-for-byte when model is non-reasoning + already bare, got: %s", fake.gotRequest.Body)
	}
}

func TestPlaygroundProxy_ReasoningModelMigratesMaxTokensToCompletion(t *testing.T) {
	// gpt-5* / o1 / o3 / o4 reject `max_tokens` ("Unsupported parameter:
	// 'max_tokens' is not supported with this model. Use
	// 'max_completion_tokens' instead.") and pin temperature to 1.0.
	// llmexecutor.ApplyReasoningOverrides already handles this for the
	// internal runSignature path; the proxy mirrors it for /go/proxy/v1
	// callers (Vercel AI SDK in modelProviders/utils.ts emits max_tokens
	// by default — Studio Monaco code-completion 500'd on this until the
	// fix shipped 2026-04-29).
	fake := &fakeProxy{
		syncResp: &playgroundProxyResponse{
			StatusCode: 200,
			Headers:    http.Header{"Content-Type": []string{"application/json"}},
			Body:       []byte(`{"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content":"ok"}}]}`),
		},
	}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"openai/gpt-5-mini","max_tokens":64,"temperature":0,"messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-litellm-model", "openai/gpt-5-mini")
	req.Header.Set("x-litellm-api_key", "sk-test")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, body = %s", resp.StatusCode, respBody)
	}

	// Old keys gone, new keys present.
	if bytes.Contains(fake.gotRequest.Body, []byte(`"max_tokens"`)) {
		t.Errorf("body must NOT contain max_tokens for reasoning model, got: %s", fake.gotRequest.Body)
	}
	if !bytes.Contains(fake.gotRequest.Body, []byte(`"max_completion_tokens"`)) {
		t.Errorf("body must contain max_completion_tokens for reasoning model, got: %s", fake.gotRequest.Body)
	}
	// temperature pinned to 1.0 (reasoning models reject other values).
	if !bytes.Contains(fake.gotRequest.Body, []byte(`"temperature":1`)) {
		t.Errorf("temperature must be pinned to 1 for reasoning model, got: %s", fake.gotRequest.Body)
	}
	// Model still rewritten to bare.
	if !bytes.Contains(fake.gotRequest.Body, []byte(`"model":"gpt-5-mini"`)) {
		t.Errorf("body.model must be bare 'gpt-5-mini', got: %s", fake.gotRequest.Body)
	}
}

func TestPlaygroundProxy_StreamingDeltasFlushAsTheyArrive(t *testing.T) {
	fake := &fakeProxy{streamCh: make(chan []byte, 4)}
	fake.streamCh <- []byte("data: {\"choices\":[{\"delta\":{\"content\":\"he\"}}]}\n\n")
	fake.streamCh <- []byte("data: {\"choices\":[{\"delta\":{\"content\":\"llo\"}}]}\n\n")
	fake.streamCh <- []byte("data: [DONE]\n\n")
	close(fake.streamCh)

	srv := newProxyTestServer(t, fake)

	body := `{"model":"openai/gpt-5-mini","stream":true,"messages":[{"role":"user","content":"hi"}]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("x-litellm-model", "openai/gpt-5-mini")
	req.Header.Set("x-litellm-api_key", "sk-test")
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}

	// Drain the SSE stream and assert frame ordering.
	var frames []string
	scanner := bufio.NewScanner(resp.Body)
	scanner.Buffer(make([]byte, 0, 1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		frames = append(frames, line)
	}
	if len(frames) < 3 {
		t.Fatalf("expected at least 3 SSE frames, got %d: %v", len(frames), frames)
	}
	if !strings.Contains(frames[0], `"he"`) || !strings.Contains(frames[1], `"llo"`) {
		t.Errorf("ordering wrong: %v", frames)
	}
	if frames[len(frames)-1] != "data: [DONE]" {
		t.Errorf("last frame = %q, want [DONE]", frames[len(frames)-1])
	}

	// Stream call counted once.
	if fake.called != 1 {
		t.Errorf("DispatchStream called %d times, want 1", fake.called)
	}
	if fake.gotRequest.Type != domain.RequestTypeChat {
		t.Errorf("Type = %q, want chat for streaming chat-completions", fake.gotRequest.Type)
	}
}

func TestPlaygroundProxy_MissingProviderHeader_400(t *testing.T) {
	fake := &fakeProxy{}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"gpt-5-mini","messages":[]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	// No x-litellm-model with provider prefix and no x-litellm-custom_llm_provider.
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 400 {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
	if fake.called != 0 {
		t.Errorf("dispatcher must not be called when provider is missing (got %d calls)", fake.called)
	}
}

func TestPlaygroundProxy_DispatcherErrorReturns502(t *testing.T) {
	fake := &fakeProxy{syncErr: errors.New("upstream down")}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"openai/gpt-5-mini","messages":[]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("x-litellm-model", "openai/gpt-5-mini")
	req.Header.Set("x-litellm-api_key", "sk-test")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 500 || resp.StatusCode >= 600 {
		t.Errorf("status = %d, want 5xx for dispatcher error", resp.StatusCode)
	}
}

func TestPlaygroundProxy_PassthroughPathReturns500_NotImplemented(t *testing.T) {
	// /v1beta/* paths classify as RequestTypePassthrough but the current
	// shimAdapter doesn't pipe HTTPPath through to dispatcher.Passthrough;
	// rather than silently calling Dispatch with type=passthrough and
	// failing opaquely downstream, the handler returns a typed
	// not-implemented error. Documents the gap until passthrough is wired
	// for real (separate follow-up).
	fake := &fakeProxy{}
	srv := newProxyTestServer(t, fake)

	body := `{"model":"vertex_ai/gemini-2.5-flash","contents":[]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1beta/models/gemini-2.5-flash:generateContent", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-litellm-model", "vertex_ai/gemini-2.5-flash")
	req.Header.Set("x-litellm-vertex_credentials", `{"type":"service_account"}`)
	req.Header.Set("x-litellm-vertex_project", "p")
	req.Header.Set("x-litellm-vertex_location", "us-central1")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("status = %d, want 500 (passthrough_not_implemented)", resp.StatusCode)
	}
	respBody, _ := io.ReadAll(resp.Body)
	if !bytes.Contains(respBody, []byte("passthrough_not_implemented")) {
		t.Errorf("body should mention passthrough_not_implemented, got: %s", respBody)
	}
	if fake.called != 0 {
		t.Errorf("dispatcher must not be called for passthrough yet (got %d calls)", fake.called)
	}
}

func TestPlaygroundProxy_PathClassification(t *testing.T) {
	cases := map[string]domain.RequestType{
		"/go/proxy/v1/chat/completions":                 domain.RequestTypeChat,
		"/go/proxy/v1/messages":                         domain.RequestTypeMessages,
		"/go/proxy/v1/embeddings":                       domain.RequestTypeEmbeddings,
		"/go/proxy/v1/responses":                        domain.RequestTypeResponses,
		"/go/proxy/v1beta/models/gemini-2.0-flash:run":  domain.RequestTypePassthrough,
		"/go/proxy/v1/some/unknown/path":                domain.RequestTypePassthrough,
	}
	for path, want := range cases {
		got, _ := classifyPath(path)
		if got != want {
			t.Errorf("classifyPath(%q) = %q, want %q", path, got, want)
		}
	}
}

func TestPlaygroundProxy_NilDispatcherFallsBackTo501(t *testing.T) {
	probes := health.New("test")
	probes.MarkStarted()
	router := NewRouter(RouterDeps{
		Health:          probes,
		Version:         "test",
		PlaygroundProxy: nil, // simulates a deploy without the gateway wired
	})
	srv := httptest.NewServer(router)
	defer srv.Close()

	body := `{"model":"openai/gpt-5-mini","messages":[]}`
	req, _ := http.NewRequest(http.MethodPost, srv.URL+"/go/proxy/v1/chat/completions", strings.NewReader(body))
	req.Header.Set("x-litellm-model", "openai/gpt-5-mini")
	req.Header.Set("x-litellm-api_key", "sk-test")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 500 {
		t.Errorf("status = %d, want 500 from the fall-back stub", resp.StatusCode)
	}
	var env map[string]any
	_ = json.Unmarshal(respBody, &env)
	if env["error"] == nil {
		t.Errorf("body = %s, want herr-formatted error envelope", respBody)
	}
}
