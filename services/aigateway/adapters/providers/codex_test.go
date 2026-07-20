package providers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Spec: specs/model-providers/codex-account-provider.feature — the gateway
// leg: direct SSE proxy to the codex backend, 401 → refresh → retry once,
// dead sessions and plan limits surfaced as typed/verbatim upstream errors.

func codexTestRouter(backendURL string, refresher domain.CodexTokenRefresher) *BifrostRouter {
	return &BifrostRouter{
		codexClient:     newCodexClient(),
		codexRefresher:  refresher,
		codexBackendURL: backendURL,
	}
}

func codexRequest(body string) *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeResponses,
		Model: "openai_codex/gpt-5.6-terra",
		Body:  []byte(body),
	}
}

func codexCredential() domain.Credential {
	return domain.Credential{
		ID:         "cred-1",
		ProviderID: domain.ProviderOpenAICodex,
		APIKey:     "access-token-1",
		Extra: map[string]string{
			"account_id":      "acct-1",
			"provider_row_id": "row-1",
		},
	}
}

func collectFrames(t *testing.T, iter domain.StreamIterator) []string {
	t.Helper()
	var frames []string
	for iter.Next(context.Background()) {
		frames = append(frames, string(iter.Chunk()))
	}
	if err := iter.Err(); err != nil {
		t.Fatalf("stream errored: %v", err)
	}
	return frames
}

type refresherFunc func(ctx context.Context, rowID string) (string, string, error)

func (f refresherFunc) RefreshCodexToken(ctx context.Context, rowID string) (string, string, error) {
	return f(ctx, rowID)
}

func TestCodexStream_ProxiesSSEAndParsesUsage(t *testing.T) {
	var gotBody map[string]any
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer access-token-1" {
			t.Errorf("missing bearer, got %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("ChatGPT-Account-ID") != "acct-1" {
			t.Errorf("missing account id header")
		}
		if r.Header.Get("originator") != "codex_cli_rs" {
			t.Errorf("missing originator header")
		}
		if r.Header.Get("OpenAI-Beta") != "responses=experimental" {
			t.Errorf("missing beta header")
		}
		_ = json.NewDecoder(r.Body).Decode(&gotBody)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w,
			"event: response.output_text.delta\n"+
				`data: {"type":"response.output_text.delta","delta":"hi"}`+"\n\n"+
				"event: response.completed\n"+
				`data: {"type":"response.completed","response":{"usage":{"input_tokens":12,"output_tokens":5}}}`+"\n\n")
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, nil)
	iter, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{"model":"whatever","input":[]}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	frames := collectFrames(t, iter)

	// The backend's invariants were pinned onto the raw body.
	if gotBody["model"] != "gpt-5.6-terra" {
		t.Errorf("model not rewritten bare, got %v", gotBody["model"])
	}
	if gotBody["stream"] != true || gotBody["store"] != false {
		t.Errorf("stream/store invariants not pinned: %v", gotBody)
	}

	// Frames forwarded verbatim, usage skimmed off response.completed.
	if len(frames) != 2 || !strings.Contains(frames[0], "response.output_text.delta") {
		t.Fatalf("frames not forwarded verbatim: %#v", frames)
	}
	usage := iter.Usage()
	if usage.PromptTokens != 12 || usage.CompletionTokens != 5 || usage.TotalTokens != 17 {
		t.Errorf("usage not parsed: %+v", usage)
	}
}

func TestCodexStream_RefreshesOnceOn401(t *testing.T) {
	var calls atomic.Int32
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"expired"}}`))
			return
		}
		if r.Header.Get("Authorization") != "Bearer fresh-token" {
			t.Errorf("retry did not carry the refreshed token")
		}
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `data: {"type":"response.completed","response":{}}`+"\n\n")
	}))
	defer backend.Close()

	refreshed := atomic.Int32{}
	router := codexTestRouter(backend.URL, refresherFunc(func(_ context.Context, rowID string) (string, string, error) {
		refreshed.Add(1)
		if rowID != "row-1" {
			t.Errorf("refresh addressed wrong row: %s", rowID)
		}
		return "fresh-token", "acct-1", nil
	}))

	iter, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	if err != nil {
		t.Fatalf("dispatch: %v", err)
	}
	_ = collectFrames(t, iter)
	if refreshed.Load() != 1 {
		t.Errorf("expected exactly one refresh, got %d", refreshed.Load())
	}
	if calls.Load() != 2 {
		t.Errorf("expected exactly one retry, got %d calls", calls.Load())
	}
}

func TestCodexStream_DeadSessionSurfacesTypedError(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, refresherFunc(func(context.Context, string) (string, string, error) {
		return "", "", fmt.Errorf("control plane: %w", domain.ErrCodexSessionDead)
	}))

	_, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	var upstream *domain.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("expected UpstreamError, got %v", err)
	}
	if upstream.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", upstream.StatusCode)
	}
	if !strings.Contains(string(upstream.Body), "codex_session_expired") {
		t.Errorf("body missing typed code: %s", upstream.Body)
	}
}

func TestCodexStream_PlanLimitForwardedVerbatim(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"type":"usage_limit_reached","message":"You've hit your usage limit."}}`))
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, nil)
	_, err := router.dispatchCodexStream(
		context.Background(),
		codexRequest(`{}`),
		"openai_codex/gpt-5.6-terra",
		codexCredential(),
	)
	var upstream *domain.UpstreamError
	if !errors.As(err, &upstream) {
		t.Fatalf("expected UpstreamError, got %v", err)
	}
	if upstream.StatusCode != http.StatusTooManyRequests {
		t.Errorf("expected 429, got %d", upstream.StatusCode)
	}
	if !strings.Contains(string(upstream.Body), "usage_limit_reached") {
		t.Errorf("provider body not forwarded verbatim: %s", upstream.Body)
	}
	if upstream.Headers["Retry-After"] != "3600" {
		t.Errorf("retry hint dropped: %v", upstream.Headers)
	}
}

func TestCodex_NonStreamingAndWrongTypeAreRejected(t *testing.T) {
	router := codexTestRouter("http://unused.test", nil)

	if _, err := router.dispatchCodex(context.Background(), codexRequest(`{}`)); err == nil {
		t.Fatal("non-streaming codex dispatch must be rejected")
	}

	chatReq := codexRequest(`{}`)
	chatReq.Type = domain.RequestTypeChat
	if _, err := router.dispatchCodexStream(
		context.Background(), chatReq, "openai_codex/gpt-5.6-terra", codexCredential(),
	); err == nil {
		t.Fatal("non-responses codex stream must be rejected")
	}
}
