package otelrelay

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"

	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// startRelay boots a relay on loopback and tears it down with the test.
func startRelay(t *testing.T) *Relay {
	t.Helper()
	r, err := New(context.Background(), Options{})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = r.Shutdown(ctx)
	})
	return r
}

// capturedIngest is a fake customer LangWatch OTLP ingest recording the last
// forwarded request.
type capturedIngest struct {
	srv    *httptest.Server
	path   string
	auth   string
	body   []byte
	status int
}

func startIngest(t *testing.T) *capturedIngest {
	t.Helper()
	ci := &capturedIngest{status: http.StatusOK}
	ci.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ci.path = req.URL.Path
		ci.auth = req.Header.Get("Authorization")
		ci.body, _ = io.ReadAll(req.Body)
		w.WriteHeader(ci.status)
	}))
	t.Cleanup(ci.srv.Close)
	return ci
}

func protoBatch(t *testing.T) []byte {
	t.Helper()
	td, _, _ := workerBatch()
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	if err != nil {
		t.Fatalf("marshal fixture: %v", err)
	}
	return payload
}

func TestRelayTraces(t *testing.T) {
	t.Run("when a registered worker exports a span batch during a turn", func(t *testing.T) {
		relay := startRelay(t)
		ingest := startIngest(t)
		token, err := relay.Register(WorkerInfo{
			ConversationID:    "conv-1",
			LangwatchEndpoint: ingest.srv.URL,
			LangwatchAPIKey:   "sk-session",
		})
		if err != nil {
			t.Fatalf("Register: %v", err)
		}
		relay.SetTurnContext(token, turnContext())

		resp, err := http.Post(relay.OTLPEndpointFor(token)+"/v1/traces", "application/x-protobuf", bytes.NewReader(protoBatch(t)))
		if err != nil {
			t.Fatalf("POST traces: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("relay answered %d, want 200", resp.StatusCode)
		}

		if ingest.path != "/api/otel/v1/traces" {
			t.Errorf("forward path = %q, want /api/otel/v1/traces", ingest.path)
		}
		if ingest.auth != "Bearer sk-session" {
			t.Errorf("forward auth = %q, want the session key the MANAGER holds", ingest.auth)
		}
		td, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(ingest.body)
		if err != nil {
			t.Fatalf("forwarded payload is not OTLP protobuf: %v", err)
		}
		span := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
		if span.TraceID() != pcommon.TraceID(turnTraceID) {
			t.Errorf("forwarded span trace id = %v, want the turn's %v", span.TraceID(), turnTraceID)
		}
		if span.ParentSpanID() != pcommon.SpanID(turnSpanID) {
			t.Errorf("forwarded root parent = %v, want the turn span", span.ParentSpanID())
		}
		attrs := td.ResourceSpans().At(0).Resource().Attributes()
		if v, _ := attrs.Get("langwatch.thread.id"); v.AsString() != "conv-1" {
			t.Errorf("forwarded thread id = %q", v.AsString())
		}
	})

	t.Run("when the export body is gzipped", func(t *testing.T) {
		relay := startRelay(t)
		ingest := startIngest(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "conv-gz", LangwatchEndpoint: ingest.srv.URL, LangwatchAPIKey: "k"})

		var buf bytes.Buffer
		gz := gzip.NewWriter(&buf)
		_, _ = gz.Write(protoBatch(t))
		_ = gz.Close()
		req, _ := http.NewRequest(http.MethodPost, relay.OTLPEndpointFor(token)+"/v1/traces", &buf)
		req.Header.Set("Content-Type", "application/x-protobuf")
		req.Header.Set("Content-Encoding", "gzip")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("POST gzip traces: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("relay answered %d for a gzip body, want 200", resp.StatusCode)
		}
		if len(ingest.body) == 0 {
			t.Fatalf("nothing forwarded for a gzip export")
		}
	})

	t.Run("when the routing token is unknown", func(t *testing.T) {
		relay := startRelay(t)
		ingest := startIngest(t)
		resp, err := http.Post(relay.OTLPEndpointFor("deadbeef")+"/v1/traces", "application/x-protobuf", bytes.NewReader(protoBatch(t)))
		if err != nil {
			t.Fatalf("POST traces: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("unknown token must 404, got %d", resp.StatusCode)
		}
		if ingest.path != "" {
			t.Errorf("nothing may be forwarded for an unknown token; upstream saw %q", ingest.path)
		}
	})

	t.Run("when the worker was unregistered", func(t *testing.T) {
		relay := startRelay(t)
		ingest := startIngest(t)
		token, _ := relay.Register(WorkerInfo{ConversationID: "conv-dead", LangwatchEndpoint: ingest.srv.URL, LangwatchAPIKey: "k"})
		relay.Unregister(token)

		resp, err := http.Post(relay.OTLPEndpointFor(token)+"/v1/traces", "application/x-protobuf", bytes.NewReader(protoBatch(t)))
		if err != nil {
			t.Fatalf("POST traces: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("a dead worker's token must stop working, got %d", resp.StatusCode)
		}
	})

	t.Run("when the customer ingest is down", func(t *testing.T) {
		relay := startRelay(t)
		ingest := startIngest(t)
		ingest.status = http.StatusInternalServerError
		token, _ := relay.Register(WorkerInfo{ConversationID: "conv-err", LangwatchEndpoint: ingest.srv.URL, LangwatchAPIKey: "k"})

		resp, err := http.Post(relay.OTLPEndpointFor(token)+"/v1/traces", "application/x-protobuf", bytes.NewReader(protoBatch(t)))
		if err != nil {
			t.Fatalf("POST traces: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusBadGateway {
			t.Errorf("a failed forward must answer 502 so the worker exporter backs off, got %d", resp.StatusCode)
		}
	})
}

func TestRelayDropsNonTraceSignals(t *testing.T) {
	relay := startRelay(t)
	ingest := startIngest(t)
	token, _ := relay.Register(WorkerInfo{ConversationID: "conv-logs", LangwatchEndpoint: ingest.srv.URL, LangwatchAPIKey: "k"})

	for _, signal := range []string{"logs", "metrics"} {
		resp, err := http.Post(relay.OTLPEndpointFor(token)+"/v1/"+signal, "application/x-protobuf", bytes.NewReader([]byte("anything")))
		if err != nil {
			t.Fatalf("POST %s: %v", signal, err)
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Errorf("%s must be accepted (200) so the worker exporter stays quiet, got %d", signal, resp.StatusCode)
		}
	}
	if ingest.path != "" {
		t.Errorf("logs/metrics must be dropped, never forwarded; upstream saw %q", ingest.path)
	}
}

// opencode's native exporter ships OTLP/HTTP JSON and ignores
// OTEL_EXPORTER_OTLP_PROTOCOL — the relay must accept it, and everything it
// forwards must still be protobuf.
func TestRelayTraces_JSONEncodedExport(t *testing.T) {
	relay := startRelay(t)
	ingest := startIngest(t)
	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-json",
		LangwatchEndpoint: ingest.srv.URL,
		LangwatchAPIKey:   "sk-session",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	relay.SetTurnContext(token, turnContext())

	td, _, _ := workerBatch()
	payload, err := (&ptrace.JSONMarshaler{}).MarshalTraces(td)
	if err != nil {
		t.Fatalf("marshal JSON fixture: %v", err)
	}

	resp, err := http.Post(
		relay.OTLPEndpointFor(token)+"/v1/traces",
		"application/json",
		bytes.NewReader(payload),
	)
	if err != nil {
		t.Fatalf("POST JSON traces: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("relay answered %d for a JSON body, want 200", resp.StatusCode)
	}

	forwarded, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(ingest.body)
	if err != nil {
		t.Fatalf("forwarded payload is not OTLP protobuf: %v", err)
	}
	span := forwarded.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
	if span.TraceID() != pcommon.TraceID(turnTraceID) {
		t.Errorf("forwarded span trace id = %v, want the turn's %v", span.TraceID(), turnTraceID)
	}
	attrs := forwarded.ResourceSpans().At(0).Resource().Attributes()
	if origin, ok := attrs.Get("langwatch.origin"); !ok || origin.Str() != "langy" {
		t.Errorf("forwarded origin = %v, want langy", origin.Str())
	}
}

// The turn span is the platform-owned ROOT the customer's trace hangs off —
// same span id as the internal langy.turn (the cross-store correlation key),
// agent-scoped, origin-stamped at both span and resource level.
func TestForwardTurnSpan(t *testing.T) {
	relay := startRelay(t)
	ingest := startSignallingIngest(t)
	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-root",
		ActorUserID:       "user-a",
		LangwatchEndpoint: ingest.srv.URL,
		LangwatchAPIKey:   "sk-session",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	turn := turnContext()
	relay.SetTurnContext(token, turn)

	start := time.Now().Add(-3 * time.Second)
	relay.ForwardTurnSpan(token, turn, start, time.Now(), nil)

	forwarded, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(ingest.await(t))
	if err != nil {
		t.Fatalf("forwarded turn span is not OTLP protobuf: %v", err)
	}

	rs := forwarded.ResourceSpans().At(0)
	ss := rs.ScopeSpans().At(0)
	span := ss.Spans().At(0)

	if got := span.Name(); got != "langy.turn" {
		t.Fatalf("span name = %q", got)
	}
	if span.TraceID() != pcommon.TraceID(turn.TraceID()) || span.SpanID() != pcommon.SpanID(turn.SpanID()) {
		t.Fatal("turn span must carry the internal langy.turn identity — that id is what every child already parents on")
	}
	if !span.ParentSpanID().IsEmpty() {
		t.Fatalf("turn span must be a root, got parent %s", span.ParentSpanID())
	}
	if got := ss.Scope().Name(); got != "langy-agent" {
		t.Fatalf("instrumentation scope = %q, want langy-agent", got)
	}
	if v, ok := span.Attributes().Get("langwatch.origin"); !ok || v.Str() != "langy" {
		t.Fatalf("span-level origin = %v", v.Str())
	}
	attrs := rs.Resource().Attributes()
	if v, ok := attrs.Get("langwatch.origin"); !ok || v.Str() != "langy" {
		t.Fatalf("resource origin = %v", v.Str())
	}
	if v, ok := attrs.Get("langwatch.thread.id"); !ok || v.Str() != "conv-root" {
		t.Fatalf("thread id = %v", v.Str())
	}
	if v, ok := attrs.Get("service.name"); !ok || v.Str() != "langy" {
		t.Fatalf("service.name = %v", v.Str())
	}
	if got := span.Status().Code(); got != ptrace.StatusCodeOk {
		t.Fatalf("a completed turn's span status = %v, want Ok", got)
	}
	if span.Events().Len() != 0 {
		t.Fatalf("a completed turn's span must carry no exception events, got %d", span.Events().Len())
	}
}

// A failed turn's customer span must SHOW the failure: error status with the
// vetted message, plus an exception event — the shape the ingest folds into
// the trace-level error message the UI renders (span-status.service.ts reads
// the newest exception event first).
func TestForwardTurnSpanFailure(t *testing.T) {
	relay := startRelay(t)
	ingest := startSignallingIngest(t)
	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-root",
		ActorUserID:       "user-a",
		LangwatchEndpoint: ingest.srv.URL,
		LangwatchAPIKey:   "sk-session",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	turn := turnContext()
	relay.SetTurnContext(token, turn)

	failure := &domain.TurnFailure{
		Code:    "agent_error",
		Message: "Your credit balance is too low to access the Anthropic API.",
	}
	relay.ForwardTurnSpan(token, turn, time.Now().Add(-time.Second), time.Now(), failure)

	forwarded, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(ingest.await(t))
	if err != nil {
		t.Fatalf("forwarded turn span is not OTLP protobuf: %v", err)
	}
	span := forwarded.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)

	if got := span.Status().Code(); got != ptrace.StatusCodeError {
		t.Fatalf("failed turn's span status = %v, want Error", got)
	}
	if got := span.Status().Message(); got != failure.Message {
		t.Fatalf("span status message = %q, want the failure message", got)
	}
	if v, ok := span.Attributes().Get("langy.outcome"); !ok || v.Str() != "agent_error" {
		t.Fatalf("langy.outcome = %v, want agent_error", v.Str())
	}
	if span.Events().Len() != 1 {
		t.Fatalf("failed turn's span events = %d, want one exception event", span.Events().Len())
	}
	event := span.Events().At(0)
	if event.Name() != "exception" {
		t.Fatalf("event name = %q, want exception", event.Name())
	}
	if v, ok := event.Attributes().Get("exception.message"); !ok || v.Str() != failure.Message {
		t.Fatalf("exception.message = %v, want the failure message", v.Str())
	}
	if v, ok := event.Attributes().Get("exception.type"); !ok || v.Str() != "agent_error" {
		t.Fatalf("exception.type = %v, want agent_error", v.Str())
	}
}

// Cost classification treats span-level langwatch.cost.non_billable as
// authoritative bundled-usage evidence, so the relay must stamp it exactly
// when the MANAGER knows the turn runs on the codex (ChatGPT-plan) provider —
// and sweep any worker-supplied claim of it on every other turn: a bare model
// name is indistinguishable from paid API usage, so the discriminator is the
// provider/auth mode, never the model string.
func TestRelayTracesCodexNonBillable(t *testing.T) {
	// A model-call span (carries gen_ai.provider.name, as opencode's Responses
	// spans do) plus a tool span that must never receive a cost stamp.
	codexBatch := func(forgeFlag bool) []byte {
		td := ptrace.NewTraces()
		ss := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty()
		model := ss.Spans().AppendEmpty()
		model.SetName("ai.streamText.doStream")
		model.SetSpanID(pcommon.SpanID{1, 1, 1, 1, 1, 1, 1, 1})
		model.Attributes().PutStr("gen_ai.provider.name", "openai.responses")
		model.Attributes().PutStr("gen_ai.request.model", "gpt-5-mini")
		if forgeFlag {
			model.Attributes().PutStr("langwatch.cost.non_billable", "true")
		}
		tool := ss.Spans().AppendEmpty()
		tool.SetName("ai.toolCall")
		tool.SetSpanID(pcommon.SpanID{2, 2, 2, 2, 2, 2, 2, 2})
		tool.SetParentSpanID(pcommon.SpanID{1, 1, 1, 1, 1, 1, 1, 1})
		payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
		if err != nil {
			t.Fatalf("marshal fixture: %v", err)
		}
		return payload
	}

	post := func(t *testing.T, model string, payload []byte) ptrace.Traces {
		t.Helper()
		relay := startRelay(t)
		ingest := startIngest(t)
		token, err := relay.Register(WorkerInfo{
			ConversationID:    "conv-codex",
			Model:             model,
			LangwatchEndpoint: ingest.srv.URL,
			LangwatchAPIKey:   "sk-session",
		})
		if err != nil {
			t.Fatalf("Register: %v", err)
		}
		relay.SetTurnContext(token, turnContext())
		resp, err := http.Post(relay.OTLPEndpointFor(token)+"/v1/traces", "application/x-protobuf", bytes.NewReader(payload))
		if err != nil {
			t.Fatalf("POST traces: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("relay answered %d, want 200", resp.StatusCode)
		}
		td, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(ingest.body)
		if err != nil {
			t.Fatalf("forwarded payload is not OTLP protobuf: %v", err)
		}
		return td
	}

	t.Run("when the turn runs on the codex provider", func(t *testing.T) {
		td := post(t, "openai_codex/gpt-5-mini", codexBatch(false))
		spans := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
		model, tool := spans.At(0), spans.At(1)
		if v, ok := model.Attributes().Get("langwatch.cost.non_billable"); !ok || v.Str() != "true" {
			t.Errorf("codex model-call span must carry langwatch.cost.non_billable=true, got %v", v.Str())
		}
		if v, ok := model.Attributes().Get("gen_ai.provider.name"); !ok || v.Str() != "openai.responses" {
			t.Errorf("gen_ai.provider.name must stay as the worker reported it, got %v", v.Str())
		}
		if _, ok := tool.Attributes().Get("langwatch.cost.non_billable"); ok {
			t.Error("tool spans carry no cost and must not be stamped")
		}
	})

	t.Run("when the turn runs on an API-key provider", func(t *testing.T) {
		// The worker even FORGES the flag — it must be swept, not honored.
		td := post(t, "openai/gpt-5-mini", codexBatch(true))
		model := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
		if _, ok := model.Attributes().Get("langwatch.cost.non_billable"); ok {
			t.Error("an API-key turn must never carry the bundled flag, even worker-forged")
		}
	})

	// Every worker LLM call is mediated, so the gateway's gen_ai span in the
	// same trace is the meter; the worker SDK's model-call span repeats the
	// usage and must be excluded from the trace totals (while its per-span
	// detail stays visible). Applies to EVERY provider, not just codex.
	//
	// @scenario "A turn's usage is counted once across the worker and gateway views"
	t.Run("marks worker model-call spans as redundant usage copies", func(t *testing.T) {
		td := post(t, "openai/gpt-5-mini", codexBatch(false))
		spans := td.ResourceSpans().At(0).ScopeSpans().At(0).Spans()
		model, tool := spans.At(0), spans.At(1)
		if v, ok := model.Attributes().Get("langwatch.reserved.skip_token_accumulation"); !ok || v.Str() != "true" {
			t.Errorf("model-call span must carry skip_token_accumulation=true (the gateway span is the meter), got %v", v.Str())
		}
		if _, ok := tool.Attributes().Get("langwatch.reserved.skip_token_accumulation"); ok {
			t.Error("tool spans carry no usage and must not be stamped")
		}
	})

	// The REAL wire shape: opencode's Vercel AI SDK spans carry ai.model.id /
	// ai.model.provider, never the gen_ai.* names (those appear only after
	// ingest canonicalisation). A key list matching only gen_ai.* silently
	// no-ops on every real batch, verified live before this fixture existed.
	t.Run("matches the ai.model wire shape opencode actually exports", func(t *testing.T) {
		td := ptrace.NewTraces()
		ss := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty()
		model := ss.Spans().AppendEmpty()
		model.SetName("ai.streamText.doStream")
		model.SetSpanID(pcommon.SpanID{3, 3, 3, 3, 3, 3, 3, 3})
		model.Attributes().PutStr("ai.model.id", "gpt-5-mini")
		model.Attributes().PutStr("ai.model.provider", "openai.responses")
		payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
		if err != nil {
			t.Fatalf("marshal fixture: %v", err)
		}

		out := post(t, "openai_codex/gpt-5-mini", payload)
		span := out.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
		if v, ok := span.Attributes().Get("langwatch.reserved.skip_token_accumulation"); !ok || v.Str() != "true" {
			t.Errorf("wire-shape model span must carry the dedup stamp, got %v", v.Str())
		}
		if v, ok := span.Attributes().Get("langwatch.cost.non_billable"); !ok || v.Str() != "true" {
			t.Errorf("wire-shape model span on a codex turn must carry the bundled flag, got %v", v.Str())
		}
	})
}

func TestPathSignal(t *testing.T) {
	for path, want := range map[string]string{
		"/w/tok/v1/traces":               "v1/traces",
		"/w/tok/v1/logs":                 "v1/logs",
		"/w/tok/llm/v1/chat/completions": "llm",
		"/w/tok/llm/v1/responses":        "llm",
		"/w/tok/llm/models":              "llm",
		"/w/tok":                         "?",
	} {
		if got := pathSignal(path); got != want {
			t.Errorf("pathSignal(%q) = %q, want %q", path, got, want)
		}
	}
}
