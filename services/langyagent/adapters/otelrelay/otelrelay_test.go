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
)

// startRelay boots a relay on loopback and tears it down with the test.
func startRelay(t *testing.T) *Relay {
	t.Helper()
	r, err := New(context.Background())
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
