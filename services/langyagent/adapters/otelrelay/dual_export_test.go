package otelrelay

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/collector/pdata/pcommon"
	"go.opentelemetry.io/collector/pdata/ptrace"
)

const (
	workerPrompt     = "my api key is sk-live-abc123 and the patient is Jane Doe"
	workerCompletion = "the patient record has been summarized"
	workerToolOutput = "tool result: customer database backup is complete"
)

// signallingIngest records one OTLP body and announces its arrival, so a test
// can wait on the detached internal export instead of sleeping.
type signallingIngest struct {
	srv   *httptest.Server
	got   chan []byte
	auth  chan string
	authz chan string
	path  chan string
}

func startSignallingIngest(t *testing.T) *signallingIngest {
	t.Helper()
	si := &signallingIngest{
		got:   make(chan []byte, 4),
		auth:  make(chan string, 4),
		authz: make(chan string, 4),
		path:  make(chan string, 4),
	}
	si.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		body, _ := io.ReadAll(req.Body)
		si.got <- body
		si.auth <- req.Header.Get("X-Auth-Token")
		si.authz <- req.Header.Get("Authorization")
		si.path <- req.URL.Path
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
	span.Attributes().PutStr("gen_ai.input.messages", workerPrompt)
	span.Attributes().PutStr("gen_ai.output.messages", workerCompletion)
	span.Attributes().PutStr("gen_ai.tool.result", workerToolOutput)

	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return payload
}

func relayWithInternal(t *testing.T, internalURL string) *Relay {
	t.Helper()
	return relayWithOptions(t, Options{InternalOTLPEndpoint: internalURL})
}

func relayWithOptions(t *testing.T, options Options) *Relay {
	t.Helper()
	r, err := New(context.Background(), options)
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
		relay := relayWithOptions(t, Options{
			InternalOTLPEndpoint: internal.srv.URL,
			InternalOTLPHeaders:  map[string]string{"X-Auth-Token": "internal-secret"},
		})

		token, err := relay.Register(WorkerInfo{
			ConversationID:    "conv-1",
			LangwatchEndpoint: customer.srv.URL,
			LangwatchAPIKey:   "sk-session",
			Model:             "gpt-5-mini",
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
			body := customer.await(t)
			for _, content := range []string{workerPrompt, workerCompletion, workerToolOutput} {
				if !bytes.Contains(body, []byte(content)) {
					t.Fatalf("the customer's own agent content %q must reach their project", content)
				}
			}
			if got := <-customer.authz; got != "Bearer sk-session" {
				t.Fatalf("customer forward Authorization = %q, want the session key", got)
			}
			if got := <-customer.auth; got != "" {
				t.Fatalf("LangWatch's internal collector credential crossed onto the customer forward: X-Auth-Token=%q", got)
			}
			if got := <-customer.path; got != "/api/otel/v1/traces" {
				t.Fatalf("customer path = %q", got)
			}
		})

		t.Run("LangWatch's own collector receives none of it", func(t *testing.T) {
			body := internal.await(t)
			for _, content := range []string{workerPrompt, workerCompletion, workerToolOutput} {
				if bytes.Contains(body, []byte(content)) {
					t.Fatalf("worker content %q reached LangWatch's internal collector", content)
				}
			}
			if !bytes.Contains(body, []byte("gpt-5-mini")) {
				t.Fatal("operational metadata was stripped along with the content")
			}
			if got := <-internal.auth; got != "internal-secret" {
				t.Fatalf("internal auth header = %q", got)
			}
			if got := <-internal.authz; got != "" {
				t.Fatalf("the customer's session key crossed onto the internal export: Authorization=%q", got)
			}
			if got := <-internal.path; got != "/v1/traces" {
				t.Fatalf("internal path = %q", got)
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
			Model:             "gpt-5-mini",
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

		if !bytes.Contains(customer.await(t), []byte(workerPrompt)) {
			t.Fatal("the customer path must be unaffected by the second export being off")
		}
	})
}

func TestInternalExportIsBoundedDuringCollectorOutage(t *testing.T) {
	started := make(chan struct{}, internalExportWorkers+1)
	release := make(chan struct{})
	internal := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		started <- struct{}{}
		select {
		case <-release:
			w.WriteHeader(http.StatusOK)
		case <-req.Context().Done():
		}
	}))
	t.Cleanup(internal.Close)

	var customerRequests atomic.Int64
	customer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		customerRequests.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(customer.Close)

	relay := relayWithInternal(t, internal.URL)
	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-outage",
		LangwatchEndpoint: customer.URL,
		LangwatchAPIKey:   "sk-session",
		Model:             "gpt-5-mini",
	})
	require.NoError(t, err)

	total := internalExportWorkers + internalExportQueueSize + 6
	payload := contentBatch(t)
	for range total {
		resp, postErr := http.Post(
			relay.OTLPEndpointFor(token)+"/v1/traces",
			"application/x-protobuf",
			bytes.NewReader(payload),
		)
		require.NoError(t, postErr)
		require.Equal(t, http.StatusOK, resp.StatusCode)
		require.NoError(t, resp.Body.Close())
	}

	for range internalExportWorkers {
		select {
		case <-started:
		case <-time.After(3 * time.Second):
			t.Fatal("internal export worker did not start")
		}
	}
	select {
	case <-started:
		t.Fatalf("more than %d internal exports ran concurrently", internalExportWorkers)
	case <-time.After(100 * time.Millisecond):
	}
	assert.Equal(t, int64(total), customerRequests.Load(), "internal outage delayed customer forwarding")
	assert.LessOrEqual(t, len(relay.internalJobs), internalExportQueueSize)
	close(release)
}
