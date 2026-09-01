package otelrelay

// The pi-harness half of the LLM proxy: the anthropic-messages and responses
// lane pass-through (path join + x-api-key credential injection), and the
// gen_ai span synthesis that replaces the OTLP a pi worker never exports.

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// The version-rooted anthropic-messages dialect appends /v1/messages to its
// base URL while the gateway base already ends in /v1: the join deduplicates
// the segment. OpenAI-relative dialects are untouched, and a base URL without
// /v1 keeps the client's full path.
func TestLLMTargetURL_VersionRootedDialects(t *testing.T) {
	for _, tc := range []struct {
		name string
		base string
		path string
		want string
	}{
		{"anthropic messages behind a /v1 base", "https://gw.internal/v1", "/w/tok/llm/v1/messages", "https://gw.internal/v1/messages"},
		{"anthropic messages behind a bare base", "https://gw.internal", "/w/tok/llm/v1/messages", "https://gw.internal/v1/messages"},
		{"responses stays SDK-relative", "https://gw.internal/v1", "/w/tok/llm/responses", "https://gw.internal/v1/responses"},
		{"chat completions stays SDK-relative", "https://gw.internal/openai/v1", "/w/tok/llm/chat/completions", "https://gw.internal/openai/v1/chat/completions"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reqURL, _ := url.Parse("http://127.0.0.1:1" + tc.path)
			got, err := llmTargetURL(tc.base, "tok", reqURL)
			if err != nil {
				t.Fatalf("llmTargetURL: %v", err)
			}
			if got.String() != tc.want {
				t.Errorf("target = %q, want %q", got.String(), tc.want)
			}
		})
	}
}

// The anthropic-native dialect authenticates with x-api-key: the relay must
// replace the worker's placeholder there too, so the real virtual key is
// injected and the placeholder never reaches the gateway.
func TestLLMProxy_MessagesLaneInjectsXAPIKey(t *testing.T) {
	var gotXAPIKey, gotAuth, gotPath string
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		gotXAPIKey = req.Header.Get("x-api-key")
		gotAuth = req.Header.Get("Authorization")
		gotPath = req.URL.Path
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer gateway.Close()

	relay := startRelay(t)
	token, _ := relay.Register(WorkerInfo{
		ConversationID: "conv-am",
		GatewayBaseURL: gateway.URL + "/v1",
		LLMVirtualKey:  "vk-real",
	})

	req, _ := http.NewRequest(http.MethodPost, relay.LLMBaseURLFor(token)+"/v1/messages", strings.NewReader(`{}`))
	req.Header.Set("x-api-key", "langy-mediated")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("proxied messages call: %v", err)
	}
	resp.Body.Close()

	if gotPath != "/v1/messages" {
		t.Errorf("gateway saw path %q, want /v1/messages", gotPath)
	}
	if gotXAPIKey != "vk-real" {
		t.Errorf("x-api-key = %q, want the injected virtual key", gotXAPIKey)
	}
	if gotAuth != "Bearer vk-real" {
		t.Errorf("Authorization = %q, want the injected virtual key", gotAuth)
	}
}

// piWorkerInfo registers a pi-harness worker whose customer ingest is the
// signaling fake, and arms the turn context.
func registerPiWorker(t *testing.T, relay *Relay, gatewayURL, ingestURL string) string {
	t.Helper()
	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-pi",
		ActorUserID:       "user-pi",
		LangwatchEndpoint: ingestURL,
		LangwatchAPIKey:   "sk-session",
		Model:             "openai/gpt-5-mini",
		GatewayBaseURL:    gatewayURL,
		LLMVirtualKey:     "vk-real",
		Harness:           domain.HarnessPi,
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	relay.SetTurnContext(token, turnContext())
	return token
}

func firstSpan(t *testing.T, payload []byte) (ptrace.ResourceSpans, ptrace.Span) {
	t.Helper()
	td, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(payload)
	if err != nil {
		t.Fatalf("forwarded payload is not OTLP protobuf: %v", err)
	}
	rs := td.ResourceSpans().At(0)
	return rs, rs.ScopeSpans().At(0).Spans().At(0)
}

// A pi worker's mediated LLM call is retold as ONE gen_ai span in the
// customer's trace: parented on the turn, carrying the manager-held model and
// the usage read off the response, marked as a non-metering copy (the
// gateway's own span stays the meter).
func TestLLMProxy_PiHarnessSynthesizesGenAISpan(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cmpl_1","usage":{"prompt_tokens":120,"completion_tokens":45}}`))
	}))
	defer gateway.Close()

	relay := startRelay(t)
	ingest := startSignallingIngest(t)
	token := registerPiWorker(t, relay, gateway.URL, ingest.srv.URL)

	resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("proxied LLM call: %v", err)
	}
	_, _ = io.ReadAll(resp.Body)
	resp.Body.Close()

	rs, span := firstSpan(t, ingest.await(t))
	if span.Name() != "gen_ai.chat" {
		t.Errorf("span name = %q, want gen_ai.chat", span.Name())
	}
	if span.TraceID() != pcommon.TraceID(turnTraceID) {
		t.Errorf("trace id = %v, want the turn's", span.TraceID())
	}
	if span.ParentSpanID() != pcommon.SpanID(turnSpanID) {
		t.Errorf("parent = %v, want the turn span", span.ParentSpanID())
	}
	if span.SpanID() == pcommon.SpanID(turnSpanID) || span.SpanID().IsEmpty() {
		t.Errorf("the synthesized span needs its own id, got %v", span.SpanID())
	}
	if v, ok := span.Attributes().Get("gen_ai.request.model"); !ok || v.Str() != "openai/gpt-5-mini" {
		t.Errorf("model attr = %v, want the manager-held id", v.Str())
	}
	if v, ok := span.Attributes().Get("gen_ai.usage.input_tokens"); !ok || v.Int() != 120 {
		t.Errorf("input tokens = %v, want 120", v.Int())
	}
	if v, ok := span.Attributes().Get("gen_ai.usage.output_tokens"); !ok || v.Int() != 45 {
		t.Errorf("output tokens = %v, want 45", v.Int())
	}
	if v, ok := span.Attributes().Get("langwatch.reserved.skip_token_accumulation"); !ok || v.Str() != "true" {
		t.Errorf("the synthesized span must not double the gateway's metering")
	}
	if v, ok := span.Attributes().Get("langwatch.origin"); !ok || v.Str() != "langy" {
		t.Errorf("origin = %v", v.Str())
	}
	attrs := rs.Resource().Attributes()
	if v, ok := attrs.Get("langwatch.thread.id"); !ok || v.Str() != "conv-pi" {
		t.Errorf("thread id = %v", v.Str())
	}
	if v, ok := attrs.Get("service.name"); !ok || v.Str() != "langy" {
		t.Errorf("service.name = %v", v.Str())
	}
	if span.Status().Code() != ptrace.StatusCodeOk {
		t.Errorf("status = %v, want Ok", span.Status().Code())
	}
}

// Streaming responses carry usage in a trailing SSE chunk; the scanner reads
// it off the pass-through bytes without buffering the stream.
func TestLLMProxy_PiHarnessReadsUsageFromSSE(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fl := w.(http.Flusher)
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n")
		fl.Flush()
		_, _ = io.WriteString(w, "data: {\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":3}}\n\n")
		_, _ = io.WriteString(w, "data: [DONE]\n\n")
	}))
	defer gateway.Close()

	relay := startRelay(t)
	ingest := startSignallingIngest(t)
	token := registerPiWorker(t, relay, gateway.URL, ingest.srv.URL)

	resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("proxied SSE call: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if !strings.Contains(string(body), "data: [DONE]") {
		t.Fatalf("stream did not pass through: %q", body)
	}

	_, span := firstSpan(t, ingest.await(t))
	if v, ok := span.Attributes().Get("gen_ai.usage.input_tokens"); !ok || v.Int() != 9 {
		t.Errorf("input tokens = %v, want 9", v.Int())
	}
	if v, ok := span.Attributes().Get("gen_ai.usage.output_tokens"); !ok || v.Int() != 3 {
		t.Errorf("output tokens = %v, want 3", v.Int())
	}
}

// A call the proxy can never deliver still reaches the customer's trace: the
// upstream never answers, so ModifyResponse never runs and the span has to be
// closed from the proxy's error path, marked as a failure.
func TestLLMProxy_PiHarnessSynthesizesSpanForAnUnreachableUpstream(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := gateway.URL
	gateway.Close() // the listener is gone: every dial is refused.

	relay := startRelay(t)
	ingest := startSignallingIngest(t)
	token := registerPiWorker(t, relay, deadURL, ingest.srv.URL)

	resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("proxied LLM call: %v", err)
	}
	_, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("relay answered %d for an unreachable upstream, want 502", resp.StatusCode)
	}

	_, span := firstSpan(t, ingest.await(t))
	if span.Name() != "gen_ai.chat" {
		t.Errorf("span name = %q, want gen_ai.chat", span.Name())
	}
	if span.Status().Code() != ptrace.StatusCodeError {
		t.Errorf("status = %v, want Error", span.Status().Code())
	}
	if v, ok := span.Attributes().Get("error.type"); !ok || v.Str() != "transport_error" {
		t.Errorf("error.type = %v, want transport_error", v.Str())
	}
}

// Anthropic streams split usage across message_start (input) and message_delta
// (cumulative output): both spellings land on the same span.
func TestLLMProxy_PiHarnessReadsAnthropicStreamUsage(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":77,\"output_tokens\":1}}}\n\n")
		_, _ = io.WriteString(w, "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":12}}\n\n")
	}))
	defer gateway.Close()

	relay := startRelay(t)
	ingest := startSignallingIngest(t)
	token := registerPiWorker(t, relay, gateway.URL, ingest.srv.URL)

	req, _ := http.NewRequest(http.MethodPost, relay.LLMBaseURLFor(token)+"/v1/messages", strings.NewReader(`{}`))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("proxied messages call: %v", err)
	}
	_, _ = io.ReadAll(resp.Body)
	resp.Body.Close()

	_, span := firstSpan(t, ingest.await(t))
	if span.Name() != "gen_ai.messages" {
		t.Errorf("span name = %q, want gen_ai.messages", span.Name())
	}
	if v, ok := span.Attributes().Get("gen_ai.usage.input_tokens"); !ok || v.Int() != 77 {
		t.Errorf("input tokens = %v, want 77", v.Int())
	}
	if v, ok := span.Attributes().Get("gen_ai.usage.output_tokens"); !ok || v.Int() != 12 {
		t.Errorf("output tokens = %v, want the cumulative 12", v.Int())
	}
}

// Cached-token usage lands on the retold span under the same attribute names
// the gateway's customer span uses, across the provider spellings: Anthropic
// states reads and writes next to input_tokens (message_start on the stream,
// a bare usage on the non-stream body) with the hour-long write share nested
// under cache_creation; the OpenAI Responses API reports reads as
// input_tokens_details.cached_tokens.
// @scenario "An option the gateway dropped from a model call is visible on the turn's telemetry"
func TestLLMProxy_PiHarnessRecordsGatewayDroppedParams(t *testing.T) {
	// A, B, A: the first set must stay deduped after a different set arrives
	// in between, so a turn that alternates bodies does not log A twice.
	sets := []string{"max_output_tokens,temperature", "top_p", "max_output_tokens,temperature"}
	var calls atomic.Int32
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		n := calls.Add(1)
		w.Header().Set("X-LangWatch-Params-Dropped", sets[(int(n)-1)%len(sets)])
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"cmpl_1","usage":{"prompt_tokens":1,"completion_tokens":1}}`))
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
	ingest := startSignallingIngest(t)
	token := registerPiWorker(t, relay, gateway.URL, ingest.srv.URL)

	for range len(sets) {
		resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("proxied LLM call: %v", err)
		}
		_, _ = io.ReadAll(resp.Body)
		resp.Body.Close()
	}

	_, span := firstSpan(t, ingest.await(t))
	if v, ok := span.Attributes().Get("langwatch.langy.params_dropped"); !ok || v.Str() != "max_output_tokens,temperature" {
		t.Errorf("the retold span must record what the gateway dropped, got %v", v.Str())
	}
	if int(calls.Load()) != len(sets) {
		t.Fatalf("expected every call to reach the gateway, got %d", calls.Load())
	}
	// A busy turn makes many LLM calls; each distinct drop set is logged once.
	logged := logs.FilterMessage("gateway dropped params from a langy model call")
	if logged.Len() != 2 {
		t.Errorf("the two distinct drop sets must be logged once each, got %d lines", logged.Len())
	}
}

// @scenario "The retold LLM span carries the provider's cached-token usage"
func TestLLMProxy_PiHarnessReadsCachedTokenUsage(t *testing.T) {
	for _, tc := range []struct {
		name         string
		path         string
		handler      http.HandlerFunc
		wantInput    int64
		wantOutput   int64
		wantRead     int64
		wantCreate   int64
		wantCreate1h int64
	}{
		{
			name: "anthropic stream keeps the message_start cache counts past message_delta",
			path: "/v1/messages",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":1,\"cache_read_input_tokens\":300,\"cache_creation_input_tokens\":40,\"cache_creation\":{\"ephemeral_5m_input_tokens\":10,\"ephemeral_1h_input_tokens\":30}}}}\n\n")
				_, _ = io.WriteString(w, "data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":12}}\n\n")
			},
			wantInput:    10,
			wantOutput:   12,
			wantRead:     300,
			wantCreate:   40,
			wantCreate1h: 30,
		},
		{
			name: "anthropic non-stream body states the cache counts once",
			path: "/v1/messages",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"id":"msg_1","usage":{"input_tokens":5,"output_tokens":7,"cache_read_input_tokens":100,"cache_creation_input_tokens":20,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":20}}}`)
			},
			wantInput:    5,
			wantOutput:   7,
			wantRead:     100,
			wantCreate:   20,
			wantCreate1h: 20,
		},
		{
			name: "openai responses body reports its cached read share",
			path: "/responses",
			handler: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"id":"resp_1","usage":{"input_tokens":50,"output_tokens":9,"input_tokens_details":{"cached_tokens":32}}}`)
			},
			wantInput:  50,
			wantOutput: 9,
			wantRead:   32,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			gateway := httptest.NewServer(tc.handler)
			defer gateway.Close()

			relay := startRelay(t)
			ingest := startSignallingIngest(t)
			token := registerPiWorker(t, relay, gateway.URL, ingest.srv.URL)

			resp, err := http.Post(relay.LLMBaseURLFor(token)+tc.path, "application/json", strings.NewReader(`{}`))
			if err != nil {
				t.Fatalf("proxied LLM call: %v", err)
			}
			_, _ = io.ReadAll(resp.Body)
			resp.Body.Close()

			_, span := firstSpan(t, ingest.await(t))
			assertIntAttr := func(key string, want int64) {
				t.Helper()
				v, ok := span.Attributes().Get(key)
				if want == 0 {
					if ok {
						t.Errorf("%s = %v, want the attribute absent", key, v.Int())
					}
					return
				}
				if !ok || v.Int() != want {
					t.Errorf("%s = %v, want %d", key, v.Int(), want)
				}
			}
			assertIntAttr("gen_ai.usage.input_tokens", tc.wantInput)
			assertIntAttr("gen_ai.usage.output_tokens", tc.wantOutput)
			assertIntAttr("gen_ai.usage.cache_read.input_tokens", tc.wantRead)
			assertIntAttr("gen_ai.usage.cache_creation.input_tokens", tc.wantCreate)
			assertIntAttr("gen_ai.usage.cache_creation_1h.input_tokens", tc.wantCreate1h)
		})
	}
}

// Synthesis is GATED on the pi harness: an opencode worker exports its own
// spans, and the relay must not add a duplicate retelling.
func TestLLMProxy_OpencodeHarnessSynthesizesNothing(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(w, `{"usage":{"prompt_tokens":5,"completion_tokens":2}}`)
	}))
	defer gateway.Close()

	relay := startRelay(t)
	ingest := startIngest(t)
	// The error is checked: an empty token would make the POST below miss every
	// registered worker, so the negative assertion would pass for the wrong reason.
	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-oc",
		LangwatchEndpoint: ingest.srv.URL,
		LangwatchAPIKey:   "sk-session",
		GatewayBaseURL:    gateway.URL,
		LLMVirtualKey:     "vk",
		Harness:           domain.HarnessOpenCode,
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	relay.SetTurnContext(token, turnContext())

	resp, err := http.Post(relay.LLMBaseURLFor(token)+"/chat/completions", "application/json", strings.NewReader(`{}`))
	if err != nil {
		t.Fatalf("proxied LLM call: %v", err)
	}
	_, _ = io.ReadAll(resp.Body)
	resp.Body.Close()

	time.Sleep(300 * time.Millisecond)
	if len(ingest.lastBody()) != 0 {
		t.Fatalf("an opencode worker's LLM call must synthesize no span; ingest got %d bytes", len(ingest.lastBody()))
	}
}
