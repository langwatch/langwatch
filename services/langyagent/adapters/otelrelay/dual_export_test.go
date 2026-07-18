package otelrelay

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

const workerSecret = "my api key is sk-live-abc123 and the patient is Jane Doe"

// signallingIngest records one OTLP body and announces its arrival, so a test
// can wait on the detached internal export instead of sleeping.
type signallingIngest struct {
	srv  *httptest.Server
	got  chan []byte
	auth chan string
}

func startSignallingIngest(t *testing.T) *signallingIngest {
	t.Helper()
	si := &signallingIngest{got: make(chan []byte, 4), auth: make(chan string, 4)}
	si.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		si.got <- body
		si.auth <- req.Header.Get("X-Auth-Token")
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(si.srv.Close)
	return si
}

func (s *signallingIngest) await(t *testing.T) []byte {
	t.Helper()
	select {
	case body := <-s.got:
		return body
	case <-time.After(3 * time.Second):
		t.Fatal("no export arrived")
		return nil
	}
}

// contentBatch is a worker batch whose spans carry prompt/completion bodies.
func contentBatch(t *testing.T) []byte {
	t.Helper()
	td := ptrace.NewTraces()
	ss := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty()
	span := ss.Spans().AppendEmpty()
	span.SetName("llm.call")
	span.SetTraceID(pcommon.TraceID{9})
	span.SetSpanID(pcommon.SpanID{1})
	span.Attributes().PutStr("gen_ai.request.model", "gpt-5-mini")
	span.Attributes().PutStr("gen_ai.input.messages", workerSecret)

	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return payload
}

func relayWithInternal(t *testing.T, internalURL string) *Relay {
	t.Helper()
	r, err := New(context.Background(), Options{InternalOTLPEndpoint: internalURL})
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

func TestDualExport(t *testing.T) {
	t.Run("when a worker exports spans carrying prompt content", func(t *testing.T) {
		customer := startSignallingIngest(t)
		internal := startSignallingIngest(t)
		relay := relayWithInternal(t, internal.srv.URL)

		token, err := relay.Register(WorkerInfo{
			ConversationID:    "conv-1",
			LangwatchEndpoint: customer.srv.URL,
			LangwatchAPIKey:   "sk-session",
		})
		if err != nil {
			t.Fatalf("Register: %v", err)
		}

		resp, err := http.Post(
			relay.OTLPEndpointFor(token)+"/v1/traces",
			"application/x-protobuf",
			bytes.NewReader(contentBatch(t)),
		)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			t.Fatalf("relay answered %d", resp.StatusCode)
		}

		t.Run("the customer's project receives the content", func(t *testing.T) {
			if !bytes.Contains(customer.await(t), []byte(workerSecret)) {
				t.Fatal("the customer's own agent output must reach their project")
			}
		})

		t.Run("LangWatch's own collector receives none of it", func(t *testing.T) {
			body := internal.await(t)
			if bytes.Contains(body, []byte(workerSecret)) {
				t.Fatal("worker prompt content reached LangWatch's internal collector")
			}
			if !bytes.Contains(body, []byte("gpt-5-mini")) {
				t.Fatal("operational metadata was stripped along with the content")
			}
		})
	})

	t.Run("when no internal collector is configured", func(t *testing.T) {
		customer := startSignallingIngest(t)
		relay := relayWithInternal(t, "")

		token, err := relay.Register(WorkerInfo{
			ConversationID:    "conv-2",
			LangwatchEndpoint: customer.srv.URL,
			LangwatchAPIKey:   "sk-session",
		})
		if err != nil {
			t.Fatalf("Register: %v", err)
		}

		resp, err := http.Post(
			relay.OTLPEndpointFor(token)+"/v1/traces",
			"application/x-protobuf",
			bytes.NewReader(contentBatch(t)),
		)
		if err != nil {
			t.Fatalf("post: %v", err)
		}
		defer resp.Body.Close()

		if !bytes.Contains(customer.await(t), []byte(workerSecret)) {
			t.Fatal("the customer path must be unaffected by the second export being off")
		}
	})
}
