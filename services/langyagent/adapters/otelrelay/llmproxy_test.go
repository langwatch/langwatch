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
	// @scenario "The manager injects the virtual key and the turn's trace context"
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

	// The worker's AI SDK injects a traceparent on the outbound LLM fetch. The
	// relay translates it through the SAME remap the span re-parenting applies
	// (worker trace ids collapse onto the turn's trace, span ids survive), so
	// the gateway's gen_ai span nests under the exported copy of the worker
	// span that made the call rather than landing as a sibling of the call tree.
	//
	// @scenario "The gateway's model call nests under the agent's own call span"
	t.Run("when the worker injects its own traceparent", func(t *testing.T) {
		requestWithWorkerTP := func(t *testing.T, workerTraceparent string) string {
			t.Helper()
			var gotTraceparent string
			gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
				gotTraceparent = req.Header.Get("traceparent")
				w.WriteHeader(http.StatusOK)
				_, _ = w.Write([]byte(`{"ok":true}`))
			}))
			defer gateway.Close()

			relay := startRelay(t)
			token, _ := relay.Register(WorkerInfo{
				ConversationID: "conv-remap",
				GatewayBaseURL: gateway.URL,
				LLMVirtualKey:  "vk-real",
			})
			relay.SetTurnContext(token, turnContext())

			req, _ := http.NewRequest(http.MethodPost, relay.LLMBaseURLFor(token)+"/chat/completions", strings.NewReader(`{}`))
			if workerTraceparent != "" {
				req.Header.Set("traceparent", workerTraceparent)
			}
			resp, err := http.DefaultClient.Do(req)
			if err != nil {
				t.Fatalf("proxied LLM call: %v", err)
			}
			resp.Body.Close()
			return gotTraceparent
		}

		t.Run("the forward carries the turn's trace id with the worker's span id", func(t *testing.T) {
			workerSpan := "aabbccdd11223344"
			got := requestWithWorkerTP(t, "00-9f86d081884c7d659a2feaa0c55ad015-"+workerSpan+"-01")
			want := fmt.Sprintf("00-%s-%s-01", turnTraceID, workerSpan)
			if got != want {
				t.Errorf("forwarded traceparent = %q, want the remapped %q", got, want)
			}
		})

		t.Run("the worker's own trace id never reaches the gateway", func(t *testing.T) {
			got := requestWithWorkerTP(t, "00-9f86d081884c7d659a2feaa0c55ad015-aabbccdd11223344-01")
			if strings.Contains(got, "9f86d081884c7d659a2feaa0c55ad015") {
				t.Errorf("worker-chosen trace id leaked to the gateway: %q", got)
			}
		})

		t.Run("a malformed worker traceparent falls back to the turn span", func(t *testing.T) {
			got := requestWithWorkerTP(t, "not-a-traceparent")
			want := fmt.Sprintf("00-%s-%s-01", turnTraceID, turnSpanID)
			if got != want {
				t.Errorf("forwarded traceparent = %q, want the turn fallback %q", got, want)
			}
		})

		t.Run("an all-zero worker span id falls back to the turn span", func(t *testing.T) {
			got := requestWithWorkerTP(t, "00-9f86d081884c7d659a2feaa0c55ad015-0000000000000000-01")
			want := fmt.Sprintf("00-%s-%s-01", turnTraceID, turnSpanID)
			if got != want {
				t.Errorf("forwarded traceparent = %q, want the turn fallback %q", got, want)
			}
		})
	})

	// @scenario "Streaming LLM responses pass through unbuffered"
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
// provider-native body as a safe handled upstream error; a later success — or a
// new turn — clears it; the body always reaches the worker's SDK
// byte-for-byte, even past the 64KB capture cap.
func TestLLMProxy_ErrorCapture(t *testing.T) {
	// The gateway's real wire shape (pkg/herr toErrorBody): `type` and `code`
	// carry the same value, `message` is always present.
	herrBody := `{"error":{"type":"no_provider_configured","code":"no_provider_configured","message":"no model provider configured","reasons":[{"type":"unknown","message":"unknown"}]}}`

	newGateway := func(status *int, body *string, handledCode ...string) *httptest.Server {
		return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			if len(handledCode) > 0 {
				w.Header().Set(herr.HandledErrorHeader, handledCode[0])
			}
			w.WriteHeader(*status)
			_, _ = io.WriteString(w, *body)
		}))
	}

	t.Run("when the gateway answers with a herr envelope", func(t *testing.T) {
		status, body := http.StatusBadRequest, herrBody
		gateway := newGateway(&status, &body, "no_provider_configured")
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
		gateway := newGateway(&status, &body, "no_provider_configured")
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
		gateway := newGateway(&status, &body, "codex_session_expired")
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
	// unmatched `error.code` (OpenAI). Every one lands as a safe handled
	// `llm_upstream_error`: a provider discriminant when present, otherwise a
	// stable status-derived reason. Provider prose never enters the frame.
	t.Run("when the gateway forwards a provider-native error body", func(t *testing.T) {
		cases := []struct {
			name string
			body string
			// formerlyCaptured is the sentence this body's Meta["message"] USED
			// to carry before the no-prose contract. Not asserted: it exists
			// so each case still names the body it is about in failure output.
			formerlyCaptured string
			// The provider discriminant, or the status-derived fallback,
			// expected as the captured cause's single typed reason.
			wantCauseType string
		}{
			{
				name:             "anthropic real credit-balance body",
				body:             `{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}`,
				formerlyCaptured: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
				wantCauseType:    "invalid_request_error",
			},
			{
				name:             "codex backend usage limit",
				body:             `{"error":{"type":"usage_limit_reached","message":"You've hit your usage limit."}}`,
				formerlyCaptured: "You've hit your usage limit.",
				wantCauseType:    "usage_limit_reached",
			},
			{
				name:             "openai unmatched type and code pair",
				body:             `{"error":{"type":"invalid_request_error","code":"invalid_api_key","message":"Incorrect API key provided."}}`,
				formerlyCaptured: "Incorrect API key provided.",
				wantCauseType:    "invalid_api_key",
			},
			{
				name:             "codex backend detail",
				body:             `{"detail":"The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account."}`,
				formerlyCaptured: "The 'gpt-5-mini' model is not supported when using Codex with a ChatGPT account.",
				wantCauseType:    "upstream_bad_request",
			},
			{
				name:             "bare message field",
				body:             `{"message":"model overloaded"}`,
				formerlyCaptured: "model overloaded",
				wantCauseType:    "upstream_bad_request",
			},
			{
				name:             "plain text body",
				body:             `upstream exploded`,
				formerlyCaptured: "upstream exploded",
				wantCauseType:    "upstream_bad_request",
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
				// The provider's prose never reaches the frame — see
				// decodeLLMErrorBody.
				if _, hasMessage := e.Meta["message"]; hasMessage {
					t.Errorf("captured message = %q, want the provider's prose dropped (was %q)", e.Meta["message"], tc.formerlyCaptured)
				}
				if e.Meta["http_status"] != http.StatusBadRequest {
					t.Errorf("captured http_status = %v, want 400", e.Meta["http_status"])
				}
				if len(e.Reasons) != 1 {
					t.Fatalf("captured reasons = %d, want exactly one handled reason", len(e.Reasons))
				}
				var cause herr.E
				if !errors.As(e.Reasons[0], &cause) || string(cause.Code) != tc.wantCauseType {
					t.Errorf("captured cause = %v, want code %q", e.Reasons[0], tc.wantCauseType)
				}
			})
		}
	})
}

// The proxy ends a hopeless retry loop: a hard plan limit answers every retry
// identically, and the worker SDK's ever-growing backoff otherwise leaves the
// turn spinning silently for hours while the panel's plan-limit card never
// gets its chance.

const rateLimitUsageLimitBody = `{"error":{"type":"usage_limit_reached","message":"You've hit your usage limit.","resets_in_seconds":10000}}`
const rateLimitBurstBody = `{"error":{"type":"rate_limit_exceeded","message":"Rate limit reached, retry shortly."}}`

func rateLimitGateway(t *testing.T, status *int) *httptest.Server {
	t.Helper()
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "2")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(*status)
		switch *status {
		case http.StatusTooManyRequests:
			_, _ = w.Write([]byte(rateLimitBurstBody))
		case http.StatusOK:
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			_, _ = w.Write([]byte(`{"error":{"message":"upstream sad"}}`))
		}
	}))
	t.Cleanup(gateway.Close)
	return gateway
}

func rateLimitCall(t *testing.T, relay *Relay, token string) *http.Response {
	t.Helper()
	resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("proxied LLM call: %v", err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

// @scenario "A provider that says its usage limit is reached fails the turn at once"
func TestLLMProxyRateLimitCut_HardLimit(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "600")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(rateLimitUsageLimitBody))
	}))
	defer gateway.Close()

	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-hard-limit", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

	resp := rateLimitCall(t, relay, token)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("first hard-limit call answered %d, want 400: the SDK must not retry into the same wall", resp.StatusCode)
	}
	if got := resp.Header.Get("Retry-After"); got != "" {
		t.Errorf("Retry-After %q survived the cut; no header may invite a retry", got)
	}
	body, _ := io.ReadAll(resp.Body)
	if string(body) != rateLimitUsageLimitBody {
		t.Errorf("body was altered by the cut:\n got %s\nwant %s", body, rateLimitUsageLimitBody)
	}

	// The captured cause still tells the truth: upstream said 429, and the
	// discriminant the panel promotes to the plan-limit card is intact.
	e, ok := relay.LastLLMError(token)
	if !ok {
		t.Fatal("the cut call must still leave a captured cause")
	}
	if e.Meta["http_status"] != http.StatusTooManyRequests {
		t.Errorf("captured http_status = %v, want the REAL upstream 429", e.Meta["http_status"])
	}
	var cause herr.E
	if len(e.Reasons) != 1 || !errors.As(e.Reasons[0], &cause) || cause.Code != "usage_limit_reached" {
		t.Errorf("captured reasons = %v, want the usage_limit_reached discriminant", e.Reasons)
	}
}

// @scenario "A rate-limit burst keeps its normal retries, then is cut"
func TestLLMProxyRateLimitCut_BurstThenCut(t *testing.T) {
	status := http.StatusTooManyRequests
	gateway := rateLimitGateway(t, &status)

	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-burst", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

	for i := 1; i <= 2; i++ {
		resp := rateLimitCall(t, relay, token)
		if resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("burst strike %d answered %d, want the 429 passed through for the SDK's own backoff", i, resp.StatusCode)
		}
		if resp.Header.Get("Retry-After") == "" {
			t.Errorf("burst strike %d lost its Retry-After; a passed-through 429 keeps its headers", i)
		}
	}
	if resp := rateLimitCall(t, relay, token); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("third consecutive 429 answered %d, want 400: the loop must be cut", resp.StatusCode)
	}

	// A success starts the count over: the next 429 is a fresh strike one.
	status = http.StatusOK
	if resp := rateLimitCall(t, relay, token); resp.StatusCode != http.StatusOK {
		t.Fatal("the scripted success must pass through")
	}
	status = http.StatusTooManyRequests
	if resp := rateLimitCall(t, relay, token); resp.StatusCode != http.StatusTooManyRequests {
		t.Fatal("after a success the first 429 must pass through again: the count restarted")
	}
}

// A mixed flap is not a deterministic limit: any non-429 answer, a 500
// included, breaks the run and the count starts over, while the captured
// cause keeps naming the most recent real failure.
//
// @scenario "A rate-limit burst keeps its normal retries, then is cut"
func TestLLMProxyRateLimitCut_InterruptedRunResets(t *testing.T) {
	status := http.StatusTooManyRequests
	gateway := rateLimitGateway(t, &status)

	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-flap", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

	rateLimitCall(t, relay, token) // 429, strike one

	status = http.StatusInternalServerError
	if resp := rateLimitCall(t, relay, token); resp.StatusCode != http.StatusInternalServerError {
		t.Fatal("the scripted 500 must pass through")
	}
	// The 500 resets the run but its capture survives as the latest cause.
	if e, ok := relay.LastLLMError(token); !ok || e.Meta["http_status"] != http.StatusInternalServerError {
		t.Errorf("after the 500 the captured cause = %v, want the 500 kept", e.Meta)
	}

	status = http.StatusTooManyRequests
	for i := 1; i <= 2; i++ {
		if resp := rateLimitCall(t, relay, token); resp.StatusCode != http.StatusTooManyRequests {
			t.Fatalf("429 number %d after the 500 answered %d, want passthrough: the 500 restarted the count", i, resp.StatusCode)
		}
	}
	if resp := rateLimitCall(t, relay, token); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("third uninterrupted 429 answered %d, want 400: the fresh run reached the cut", resp.StatusCode)
	}
}

// @scenario "A rate-limited conversation never blocks a healthy one"
func TestLLMProxyRateLimitCut_ConversationIsolation(t *testing.T) {
	status := http.StatusTooManyRequests
	gateway := rateLimitGateway(t, &status)

	relay := startRelay(t)
	cutToken, _ := relay.Register(WorkerInfo{ConversationID: "conv-cut", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})
	freshToken, _ := relay.Register(WorkerInfo{ConversationID: "conv-fresh", GatewayBaseURL: gateway.URL, LLMVirtualKey: "vk"})

	for i := 0; i < rateLimitCutAfter; i++ {
		rateLimitCall(t, relay, cutToken)
	}
	if resp := rateLimitCall(t, relay, freshToken); resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("the fresh conversation's first 429 answered %d, want the passthrough of its own strike one", resp.StatusCode)
	}
}
