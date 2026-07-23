package otelrelay

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/langwatch/langwatch/pkg/herr"
)

func TestLLMProxy(t *testing.T) {
	t.Run("when a worker makes an LLM call during a turn", func(t *testing.T) {
		var gotAuth, gotTraceparent, gotPath, gotQuery string
		gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			gotAuth = req.Header.Get("Authorization")
			gotTraceparent = req.Header.Get("traceparent")
			gotPath = req.URL.Path
			gotQuery = req.URL.RawQuery
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		}))
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{
			ConversationID: "conv-llm",
			GatewayBaseURL: gateway.URL + "/openai/v1",
			LLMVirtualKey:  "vk-real",
		})
		relay.SetTurnContext(token, turnContext())

		req, _ := http.NewRequest(http.MethodPost, relay.LLMBaseURLFor(token)+"/chat/completions?stream=false", strings.NewReader(`{}`))
		// The worker only holds the placeholder; the relay must REPLACE it.
		req.Header.Set("Authorization", "Bearer langy-mediated")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("proxied call answered %d, want 200", resp.StatusCode)
		}

		if gotAuth != "Bearer vk-real" {
			t.Errorf("gateway saw Authorization %q, want the REAL virtual key injected by the manager", gotAuth)
		}
		wantTP := fmt.Sprintf("00-%s-%s-01", turnTraceID, turnSpanID)
		if gotTraceparent != wantTP {
			t.Errorf("gateway saw traceparent %q, want the turn's %q", gotTraceparent, wantTP)
		}
		if gotPath != "/openai/v1/chat/completions" {
			t.Errorf("gateway saw path %q; the SDK-relative path must join the gateway base path", gotPath)
		}
		if gotQuery != "stream=false" {
			t.Errorf("query string %q must pass through", gotQuery)
		}
	})

	t.Run("when no turn context is recorded yet", func(t *testing.T) {
		var sawTraceparent *string
		gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			tp := req.Header.Get("traceparent")
			sawTraceparent = &tp
			w.WriteHeader(http.StatusOK)
		}))
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		resp.Body.Close()
		if sawTraceparent == nil || *sawTraceparent != "" {
			t.Errorf("with no turn context the forward must carry NO traceparent (gateway roots its own trace); got %v", sawTraceparent)
		}
	})

	t.Run("when the response is a server-sent event stream", func(t *testing.T) {
		// The gateway writes one event, then BLOCKS until the client has observed
		// it, then writes the second. This only completes if the relay flushes
		// each write through unbuffered — a buffering proxy deadlocks here (the
		// test would time out).
		firstEventRead := make(chan struct{})
		gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			fl := w.(http.Flusher)
			w.Header().Set("Content-Type", "text/event-stream")
			_, _ = io.WriteString(w, "data: one\n\n")
			fl.Flush()
			select {
			case <-firstEventRead:
			case <-time.After(5 * time.Second):
				t.Error("client never observed the first SSE event — the proxy buffered it")
			}
			_, _ = io.WriteString(w, "data: two\n\n")
			fl.Flush()
		}))
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied SSE call: %v", err)
		}
		defer resp.Body.Close()

		reader := bufio.NewReader(resp.Body)
		line, err := reader.ReadString('\n')
		if err != nil {
			t.Fatalf("read first SSE event: %v", err)
		}
		if strings.TrimSpace(line) != "data: one" {
			t.Fatalf("first SSE line = %q", line)
		}
		close(firstEventRead) // the upstream may now send the second event
		rest, err := io.ReadAll(reader)
		if err != nil {
			t.Fatalf("read remainder: %v", err)
		}
		if !strings.Contains(string(rest), "data: two") {
			t.Errorf("second SSE event missing from the stream: %q", rest)
		}
	})

	t.Run("when the routing token is unknown", func(t *testing.T) {
		relay := startRelay(t)
		resp, err := http.Post(relay.LLMBaseURLFor("deadbeef")+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("unknown token must 404, got %d", resp.StatusCode)
		}
	})
}

func TestLLMTargetURL(t *testing.T) {
	reqURL, _ := url.Parse("http://127.0.0.1:1/w/tok/llm/chat/completions?a=1")
	got, err := llmTargetURL("https://gw.internal/openai/v1/", "tok", reqURL)
	if err != nil {
		t.Fatalf("llmTargetURL: %v", err)
	}
	if got.String() != "https://gw.internal/openai/v1/chat/completions?a=1" {
		t.Errorf("target = %q", got.String())
	}

	if _, err := llmTargetURL("not a url\x7f", "tok", reqURL); err == nil {
		t.Errorf("unparseable base must error")
	}
	if _, err := llmTargetURL("/just/a/path", "tok", reqURL); err == nil {
		t.Errorf("schemeless base must error")
	}
}

// The proxy's error capture is the wire that lets a turn's terminal frame name
// the REAL cause instead of opencode's laundered prose. Contract: EVERY >=400
// answer leaves a capture for LastLLMError — a herr envelope losslessly, a
// provider-native body best-effort with its message; a later success — or a
// new turn — clears it; the body always reaches the worker's SDK
// byte-for-byte, even past the 64KB capture cap.
func TestLLMProxy_ErrorCapture(t *testing.T) {
	// The gateway's real wire shape (pkg/herr toErrorBody): `type` and `code`
	// carry the same value, `message` is always present.
	herrBody := `{"error":{"type":"no_provider_configured","code":"no_provider_configured","message":"no model provider configured","reasons":[{"type":"unknown","message":"unknown"}]}}`

	newGateway := func(status *int, body *string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(*status)
			_, _ = io.WriteString(w, *body)
		}))
	}

	t.Run("when the gateway answers with a herr envelope", func(t *testing.T) {
		status, body := http.StatusBadRequest, herrBody
		gateway := newGateway(&status, &body)
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
		relay.SetTurnContext(token, turnContext())

		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		got, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if string(got) != herrBody {
			t.Errorf("worker saw body %q, want the gateway's untouched", got)
		}

		e, ok := relay.LastLLMError(token)
		if !ok {
			t.Fatal("LastLLMError must expose the captured herr")
		}
		if string(e.Code) != "no_provider_configured" {
			t.Errorf("captured code = %q", e.Code)
		}
		if e.Meta["http_status"] != http.StatusBadRequest {
			t.Errorf("captured http_status = %v, want 400", e.Meta["http_status"])
		}
		if len(e.Reasons) != 1 {
			t.Errorf("captured reasons = %d, want the chain preserved", len(e.Reasons))
		}

		// A later SUCCESS clears the capture: a retried-past transient failure
		// must not be blamed for an unrelated error reported afterwards.
		status, body = http.StatusOK, `{"ok":true}`
		resp2, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("second proxied call: %v", err)
		}
		resp2.Body.Close()
		if _, ok := relay.LastLLMError(token); ok {
			t.Error("a successful call must clear the captured error")
		}
	})

	t.Run("when a new turn starts", func(t *testing.T) {
		status, body := http.StatusBadRequest, herrBody
		gateway := newGateway(&status, &body)
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
		relay.SetTurnContext(token, turnContext())

		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		resp.Body.Close()
		if _, ok := relay.LastLLMError(token); !ok {
			t.Fatal("precondition: error captured")
		}

		relay.SetTurnContext(token, turnContext())
		if _, ok := relay.LastLLMError(token); ok {
			t.Error("a new turn must never inherit the previous turn's failure as its cause")
		}
	})

	// The gateway authors this envelope itself (codexSessionExpiredError):
	// `type` and `code` matched plus a message, no reasons. It must round-trip
	// typed, or the control plane loses the exact-code classification that
	// renders the re-authenticate card.
	t.Run("when the gateway answers the codex session-expired envelope", func(t *testing.T) {
		status := http.StatusUnauthorized
		body := `{"error":{"type":"codex_session_expired","code":"codex_session_expired","message":"Your OpenAI session expired. Sign in to Codex again to keep using it."}}`
		gateway := newGateway(&status, &body)
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
		relay.SetTurnContext(token, turnContext())

		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		resp.Body.Close()

		e, ok := relay.LastLLMError(token)
		if !ok {
			t.Fatal("LastLLMError must expose the captured herr")
		}
		if string(e.Code) != "codex_session_expired" {
			t.Errorf("captured code = %q, want the gateway's typed code preserved", e.Code)
		}
		if e.Meta["message"] != "Your OpenAI session expired. Sign in to Codex again to keep using it." {
			t.Errorf("captured message = %v, want the envelope's message in meta", e.Meta["message"])
		}
		if e.Meta["http_status"] != http.StatusUnauthorized {
			t.Errorf("captured http_status = %v, want 401", e.Meta["http_status"])
		}
	})

	t.Run("when the error body exceeds the capture cap", func(t *testing.T) {
		huge := `{"pad":"` + strings.Repeat("x", maxErrorBodyBytes) + `"}`
		status := http.StatusInternalServerError
		gateway := newGateway(&status, &huge)
		defer gateway.Close()

		relay := startRelay(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		got, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		// The whole >cap body must reach the worker intact — the peeked prefix
		// chained back onto the unread remainder.
		if string(got) != huge {
			t.Errorf("worker saw %d bytes, want the full %d untruncated", len(got), len(huge))
		}
		// Not a herr envelope and no readable message inside: captured
		// best-effort as an upstream error with the status, never corrupted.
		e, ok := relay.LastLLMError(token)
		if !ok {
			t.Fatal("a failed call must always leave a captured cause")
		}
		if string(e.Code) != string(llmUpstreamErrorCode) {
			t.Errorf("captured code = %q, want %q", e.Code, llmUpstreamErrorCode)
		}
		if _, hasMessage := e.Meta["message"]; hasMessage {
			t.Error("an unreadable body must not fabricate a message")
		}
	})

	// Provider-native error bodies the gateway forwards byte-for-byte are NOT
	// herr envelopes, even when they reuse `error.type` (Anthropic) or carry an
	// unmatched `error.code` (OpenAI), but they hold the only actionable prose
	// there is: the provider's own message. Every one of them must land as an
	// `llm_upstream_error` with that prose in meta, so the turn's error frame
	// (and the turn span) name the real failure. A body that names its own
	// error type keeps that discriminant as a typed reason, so exact-code
	// consumers (the codex plan-limit promotion) still classify it.
	t.Run("when the gateway forwards a provider-native error body", func(t *testing.T) {
		cases := []struct {
			name string
			body string
			want string
			// The provider's own error discriminant, expected as the captured
			// cause's single typed reason. Empty means no reason is captured.
			wantCauseType string
		}{
			{
				name:          "anthropic real credit-balance body",
				body:          `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}`,
				want:          "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
				wantCauseType: "invalid_request_error",
			},
			{
				name:          "codex backend usage limit",
				body:          `{"error":{"type":"usage_limit_reached","message":"You've hit your usage limit."}}`,
				want:          "You've hit your usage limit.",
				wantCauseType: "usage_limit_reached",
			},
			{
				name:          "openai unmatched type and code pair",
				body:          `{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Incorrect API key provided."}}`,
				want:          "Incorrect API key provided.",
				wantCauseType: "invalid_request_error",
			},
			{
				name: "codex backend detail",
				body: `{"detail":"The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account."}`,
				want: "The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account.",
			},
			{
				name: "bare message field",
				body: `{"message":"model overloaded"}`,
				want: "model overloaded",
			},
			{
				name: "plain text body",
				body: `upstream exploded`,
				want: "upstream exploded",
			},
		}
		for _, tc := range cases {
			t.Run(tc.name, func(t *testing.T) {
				status, body := http.StatusBadRequest, tc.body
				gateway := newGateway(&status, &body)
				defer gateway.Close()

				relay := startRelay(t)
				token, _ := relay.Register(WorkerInfo{ConversationID: "c", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
				relay.SetTurnContext(token, turnContext())

				resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
				if err != nil {
					t.Fatalf("proxied LLM call: %v", err)
				}
				got, _ := io.ReadAll(resp.Body)
				resp.Body.Close()
				if string(got) != tc.body {
					t.Errorf("worker saw body %q, want the provider's untouched", got)
				}

				e, ok := relay.LastLLMError(token)
				if !ok {
					t.Fatal("a failed call must always leave a captured cause")
				}
				if string(e.Code) != string(llmUpstreamErrorCode) {
					t.Errorf("captured code = %q, want %q", e.Code, llmUpstreamErrorCode)
				}
				if e.Meta["message"] != tc.want {
					t.Errorf("captured message = %q, want %q", e.Meta["message"], tc.want)
				}
				if e.Meta["http_status"] != http.StatusBadRequest {
					t.Errorf("captured http_status = %v, want 400", e.Meta["http_status"])
				}
				if tc.wantCauseType == "" {
					if len(e.Reasons) != 0 {
						t.Errorf("captured reasons = %v, want none for a body without an error type", e.Reasons)
					}
					return
				}
				if len(e.Reasons) != 1 {
					t.Fatalf("captured reasons = %d, want exactly the provider's discriminant", len(e.Reasons))
				}
				var cause herr.E
				if !errors.As(e.Reasons[0], &cause) || string(cause.Code) != tc.wantCauseType {
					t.Errorf("captured cause = %v, want code %q", e.Reasons[0], tc.wantCauseType)
				}
			})
		}
	})
}
