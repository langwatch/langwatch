package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Spec: specs/self-hosting/connected-services/managed-models-provider.feature
// The install's leg: a direct proxy to another LangWatch gateway carrying the
// license token and the instance id, relaying the answer as it came.

const langWatchTestToken = "lwl_" + "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func langWatchTestRouter(logger *zap.Logger) *BifrostRouter {
	return &BifrostRouter{langWatchClient: newLangWatchClient(), logger: logger}
}

func langWatchCredential(baseURL string) domain.Credential {
	return domain.Credential{
		ID:         "connect-langwatch",
		ProviderID: domain.ProviderLangWatch,
		APIKey:     langWatchTestToken,
		Extra: map[string]string{
			"base_url":    baseURL,
			"instance_id": "org-install-1",
		},
	}
}

func langWatchChatCall(baseURL string) langWatchDispatch {
	return langWatchDispatch{
		req: &domain.Request{
			Type:  domain.RequestTypeChat,
			Model: "langwatch/gpt-5-mini",
			Body:  []byte(`{"model":"langwatch/gpt-5-mini","messages":[{"role":"user","content":"hi"}]}`),
		},
		model: "gpt-5-mini",
		cred:  langWatchCredential(baseURL),
	}
}

// @scenario "A call routed to the langwatch provider is served by the LangWatch gateway"
func TestLangWatchForwardsTheCallWithTheLicenseAndTheInstance(t *testing.T) {
	var gotPath, gotAuthorization, gotInstance string
	var gotBody map[string]any
	answer := `{"id":"chatcmpl-1","choices":[{"message":{"content":"hello"}}],"usage":{"prompt_tokens":11,"completion_tokens":3,"total_tokens":14}}`
	far := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotAuthorization = r.Header.Get("Authorization")
		gotInstance = r.Header.Get(langWatchInstanceHeader)
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(answer))
	}))
	defer far.Close()
	router := langWatchTestRouter(zap.NewNop())
	router.langWatchClient = far.Client()

	resp, err := router.dispatchLangWatch(context.Background(), langWatchChatCall(far.URL+"/v1"))

	if err != nil {
		t.Fatalf("dispatch errored: %v", err)
	}
	if gotPath != "/v1/chat/completions" {
		t.Errorf("path = %q, want /v1/chat/completions", gotPath)
	}
	if gotAuthorization != "Bearer "+langWatchTestToken {
		t.Errorf("authorization = %q, want the license token as the bearer", gotAuthorization)
	}
	if gotInstance != "org-install-1" {
		t.Errorf("instance header = %q, want org-install-1", gotInstance)
	}
	if gotBody["model"] != "gpt-5-mini" {
		t.Errorf("forwarded model = %v, want the bare gpt-5-mini", gotBody["model"])
	}
	if string(resp.Body) != answer {
		t.Errorf("body = %q, want the far gateway's answer unchanged", string(resp.Body))
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d, want 200", resp.StatusCode)
	}
	if resp.Usage.PromptTokens != 11 || resp.Usage.CompletionTokens != 3 || resp.Usage.TotalTokens != 14 {
		t.Errorf("usage = %+v, want the answer's own counts", resp.Usage)
	}
}

// @scenario "A spent budget stops forwarded calls"
func TestLangWatchRelaysAPaymentRequiredAsItCame(t *testing.T) {
	refusal := `{"error":{"type":"budget_exceeded","code":"budget_exceeded","message":"the cap for this period is spent"}}`
	far := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(herr.HandledErrorHeader, "1")
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(refusal))
	}))
	defer far.Close()
	router := langWatchTestRouter(zap.NewNop())
	router.langWatchClient = far.Client()

	resp, err := router.dispatchLangWatch(context.Background(), langWatchChatCall(far.URL+"/v1"))

	if err != nil {
		t.Fatalf("a relayed refusal must not be an error of ours: %v", err)
	}
	if resp.StatusCode != http.StatusPaymentRequired {
		t.Errorf("status = %d, want 402", resp.StatusCode)
	}
	if string(resp.Body) != refusal {
		t.Errorf("body = %q, want the far gateway's refusal unchanged", string(resp.Body))
	}
	if resp.Headers[herr.HandledErrorHeader] != "1" {
		t.Errorf("headers = %v, want the handled-error marker carried back", resp.Headers)
	}
}

// @scenario "The provider refuses an endpoint that is not HTTPS"
func TestLangWatchRefusesAPlainHTTPEndpointOffLoopback(t *testing.T) {
	router := langWatchTestRouter(zap.NewNop())

	_, err := router.dispatchLangWatch(
		context.Background(),
		langWatchChatCall("http://gateway.langwatch.ai/v1"),
	)

	if !herr.IsCode(err, domain.ErrProviderCredentialInvalid) {
		t.Fatalf("err = %v, want the invalid-credential refusal", err)
	}
	if strings.Contains(fmt.Sprint(err), langWatchTestToken) {
		t.Errorf("the refusal quoted the license token")
	}
}

func TestLangWatchAllowsPlainHTTPOnLoopback(t *testing.T) {
	for _, host := range []string{"http://localhost:5563/v1", "http://127.0.0.1:5563/v1", "http://[::1]:5563/v1"} {
		if _, err := langWatchBaseURL(context.Background(), langWatchCredential(host)); err != nil {
			t.Errorf("%s was refused: %v", host, err)
		}
	}
}

// @scenario "The license token is never written to logs or traces"
func TestLangWatchNeverLogsTheLicenseToken(t *testing.T) {
	far := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"chatcmpl-1"}`))
	}))
	defer far.Close()
	core, logs := observer.New(zap.DebugLevel)
	router := langWatchTestRouter(zap.New(core))
	router.langWatchClient = far.Client()

	if _, err := router.dispatchLangWatch(context.Background(), langWatchChatCall(far.URL+"/v1")); err != nil {
		t.Fatalf("dispatch errored: %v", err)
	}

	if logs.Len() == 0 {
		t.Fatalf("the lane logged nothing at all, so the test proves nothing")
	}
	for _, entry := range logs.All() {
		rendered := entry.Message + fmt.Sprint(entry.ContextMap())
		if strings.Contains(rendered, langWatchTestToken) {
			t.Errorf("a log line carried the license token: %s", rendered)
		}
	}
	fields := logs.All()[0].ContextMap()
	for _, name := range []string{"model", "status", "duration"} {
		if _, ok := fields[name]; !ok {
			t.Errorf("the log line does not name %q; fields were %v", name, fields)
		}
	}
	if len(fields) != 3 {
		t.Errorf("the log line carries %d fields, want the model, the status and the duration only", len(fields))
	}
}

// @scenario "A streamed completion is forwarded as a stream"
func TestLangWatchStreamForwardsChunksAsTheyArrive(t *testing.T) {
	frames := []string{
		`data: {"choices":[{"delta":{"content":"he"}}]}`,
		`data: {"choices":[{"delta":{"content":"llo"}}]}`,
		`data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}`,
	}
	far := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Accept") != "text/event-stream" {
			t.Errorf("accept = %q, want text/event-stream", r.Header.Get("Accept"))
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		for _, frame := range frames {
			_, _ = w.Write([]byte(frame + "\n\n"))
			if flusher != nil {
				flusher.Flush()
			}
		}
	}))
	defer far.Close()
	router := langWatchTestRouter(zap.NewNop())
	router.langWatchClient = far.Client()

	iter, err := router.dispatchLangWatchStream(context.Background(), langWatchChatCall(far.URL+"/v1"))
	if err != nil {
		t.Fatalf("stream dispatch errored: %v", err)
	}
	defer func() { _ = iter.Close() }()

	got := collectFrames(t, iter)
	if len(got) != len(frames) {
		t.Fatalf("got %d frames, want %d: %q", len(got), len(frames), got)
	}
	for i, frame := range frames {
		if strings.TrimSpace(got[i]) != frame {
			t.Errorf("frame %d = %q, want %q", i, got[i], frame)
		}
	}
	if iter.Usage().TotalTokens != 9 {
		t.Errorf("usage = %+v, want the stream's own counts", iter.Usage())
	}
}

func TestLangWatchStreamRelaysARefusalWithItsStatus(t *testing.T) {
	far := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(herr.HandledErrorHeader, "1")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`{"error":{"code":"connect_service_not_entitled"}}`))
	}))
	defer far.Close()
	router := langWatchTestRouter(zap.NewNop())
	router.langWatchClient = far.Client()

	_, err := router.dispatchLangWatchStream(context.Background(), langWatchChatCall(far.URL+"/v1"))

	var upstream *domain.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("err = %v, want an upstream error carrying the far side's answer", err)
	}
	if upstream.StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", upstream.StatusCode)
	}
	if !strings.Contains(string(upstream.Body), "connect_service_not_entitled") {
		t.Errorf("body = %q, want the far side's code", string(upstream.Body))
	}
	if upstream.Headers[herr.HandledErrorHeader] != "1" {
		t.Errorf("headers = %v, want the handled-error marker carried back", upstream.Headers)
	}
}

func TestLangWatchRefusesARequestTypeItHasNoRouteFor(t *testing.T) {
	router := langWatchTestRouter(zap.NewNop())
	call := langWatchChatCall("https://gateway.langwatch.ai/v1")
	call.req.Type = domain.RequestTypeImageGeneration

	_, err := router.dispatchLangWatch(context.Background(), call)

	if !herr.IsCode(err, domain.ErrBadRequest) {
		t.Fatalf("err = %v, want a bad-request refusal", err)
	}
}

func TestLangWatchRoutesEmbeddingsToTheEmbeddingsPath(t *testing.T) {
	var gotPath string
	far := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"data":[],"usage":{"prompt_tokens":4,"total_tokens":4}}`))
	}))
	defer far.Close()
	router := langWatchTestRouter(zap.NewNop())
	router.langWatchClient = far.Client()
	call := langWatchChatCall(far.URL + "/v1")
	call.req.Type = domain.RequestTypeEmbeddings

	resp, err := router.dispatchLangWatch(context.Background(), call)

	if err != nil {
		t.Fatalf("dispatch errored: %v", err)
	}
	if gotPath != "/v1/embeddings" {
		t.Errorf("path = %q, want /v1/embeddings", gotPath)
	}
	if resp.Usage.TotalTokens != 4 {
		t.Errorf("usage = %+v, want the answer's own counts", resp.Usage)
	}
}
