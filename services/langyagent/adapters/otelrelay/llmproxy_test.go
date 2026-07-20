package otelrelay

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
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
// the gateway's REAL typed cause (herr) instead of opencode's laundered prose.
// Contract: a herr envelope on a >=400 answer is captured for LastLLMError; a
// later success — or a new turn — clears it; the body always reaches the
// worker's SDK byte-for-byte, even past the 64KB capture cap.
func TestLLMProxy_ErrorCapture(t *testing.T) {
	herrBody := `{"error":{"type":"no_provider_configured","message":"no model provider configured","reasons":[{"type":"unknown","message":"unknown"}]}}`

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
		// Not a herr envelope, so nothing is captured — but never corrupted.
		if _, ok := relay.LastLLMError(token); ok {
			t.Error("a non-herr body must not be captured as a typed cause")
		}
	})
}
