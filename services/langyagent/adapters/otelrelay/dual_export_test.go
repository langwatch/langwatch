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
	span.SetName("ai.streamText")
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

// The worker is a model-driven, prompt-injectable process. Whatever it puts in
// its OTLP resource, it must not be able to brand its spans with LangWatch's
// provenance marker in the customer's project — ingest-side enforcement keyed
// on langwatch.origin must never trust a worker-supplied value.
func TestCustomerForwardStripsForgedOriginMarker(t *testing.T) {
	customer := startSignallingIngest(t)
	relay := relayWithInternal(t, "")

	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-forge",
		LangwatchEndpoint: customer.srv.URL,
		LangwatchAPIKey:   "sk-session",
		Model:             "gpt-5-mini",
	})
	require.NoError(t, err)

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("langwatch.origin", "platform_internal")
	rs.Resource().Attributes().PutStr("service.name", "opencode")
	span := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetName("ai.streamText")
	span.SetTraceID(pcommon.TraceID{7})
	span.SetSpanID(pcommon.SpanID{2})
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	require.NoError(t, err)

	resp, err := http.Post(
		relay.OTLPEndpointFor(token)+"/v1/traces",
		"application/x-protobuf",
		bytes.NewReader(payload),
	)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, http.StatusOK, resp.StatusCode)

	forwarded, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(customer.await(t))
	require.NoError(t, err)
	require.Equal(t, 1, forwarded.ResourceSpans().Len())
	attrs := forwarded.ResourceSpans().At(0).Resource().Attributes()
	origin, found := attrs.Get("langwatch.origin")
	require.True(t, found, "the platform origin stamp must be present")
	assert.Equal(t, "langy", origin.Str(),
		"a worker-forged langwatch.origin must be replaced by the platform's stamp, never forwarded")
	serviceName, ok := attrs.Get("service.name")
	require.True(t, ok)
	assert.Equal(t, "opencode", serviceName.Str(), "legitimate worker resource attributes must survive the strip")
}

// The customer-forward allowlist fails closed: a resource attribute outside
// the policy — sdk metadata, pod identity, anything a future worker build
// starts emitting — never reaches the customer's project.
func TestCustomerForwardDropsUnlistedResourceAttributes(t *testing.T) {
	customer := startSignallingIngest(t)
	relay := relayWithInternal(t, "")

	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-allow",
		LangwatchEndpoint: customer.srv.URL,
		LangwatchAPIKey:   "sk-session",
		Model:             "gpt-5-mini",
	})
	require.NoError(t, err)

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("service.name", "opencode")
	rs.Resource().Attributes().PutStr("k8s.pod.name", "worker-pod-7")
	rs.Resource().Attributes().PutStr("telemetry.sdk.name", "opentelemetry")
	span := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetName("ai.toolCall")
	span.SetTraceID(pcommon.TraceID{9})
	span.SetSpanID(pcommon.SpanID{3})
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	require.NoError(t, err)

	resp, err := http.Post(
		relay.OTLPEndpointFor(token)+"/v1/traces",
		"application/x-protobuf",
		bytes.NewReader(payload),
	)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, http.StatusOK, resp.StatusCode)

	forwarded, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(customer.await(t))
	require.NoError(t, err)
	attrs := forwarded.ResourceSpans().At(0).Resource().Attributes()
	if _, found := attrs.Get("k8s.pod.name"); found {
		t.Fatal("an unlisted resource attribute reached the customer forward")
	}
	if _, found := attrs.Get("telemetry.sdk.name"); found {
		t.Fatal("sdk metadata reached the customer forward")
	}
	serviceName, ok := attrs.Get("service.name")
	require.True(t, ok)
	assert.Equal(t, "opencode", serviceName.Str())
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

// The reverse of the content-isolation guarantee: LangWatch's INTERNAL
// identity must never ride the customer forward, even when the worker itself
// claims it — a prompt-injectable process asserting platform identity on its
// resource is exactly the forgery the allowlist exists for.
func TestCustomerForwardCarriesNoInternalIdentity(t *testing.T) {
	customer := startSignallingIngest(t)
	relay := relayWithInternal(t, "")

	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-ident",
		LangwatchEndpoint: customer.srv.URL,
		LangwatchAPIKey:   "sk-session",
		Model:             "gpt-5-mini",
	})
	require.NoError(t, err)

	td := ptrace.NewTraces()
	rs := td.ResourceSpans().AppendEmpty()
	rs.Resource().Attributes().PutStr("langwatch.origin", "platform_internal")
	rs.Resource().Attributes().PutStr("service.name", "langwatch-service-langyagent")
	rs.Resource().Attributes().PutStr("deployment.environment.name", "lw-prod")
	span := rs.ScopeSpans().AppendEmpty().Spans().AppendEmpty()
	span.SetName("ai.toolCall")
	span.SetTraceID(pcommon.TraceID{5})
	span.SetSpanID(pcommon.SpanID{6})
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	require.NoError(t, err)

	resp, err := http.Post(
		relay.OTLPEndpointFor(token)+"/v1/traces",
		"application/x-protobuf",
		bytes.NewReader(payload),
	)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, http.StatusOK, resp.StatusCode)

	body := customer.await(t)
	if bytes.Contains(body, []byte("platform_internal")) {
		t.Fatal("the internal-origin marker reached the customer forward")
	}
	if bytes.Contains(body, []byte("lw-prod")) {
		t.Fatal("platform environment identity reached the customer forward")
	}
	if bytes.Contains(body, []byte("langwatch-service-langyagent")) {
		t.Fatal("a worker-forged platform service identity reached the customer forward")
	}

	forwarded, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(body)
	require.NoError(t, err)
	attrs := forwarded.ResourceSpans().At(0).Resource().Attributes()
	origin, ok := attrs.Get("langwatch.origin")
	require.True(t, ok)
	assert.Equal(t, "langy", origin.Str(),
		"the platform's own origin stamp must replace the forged one")
}

// Plumbing spans (storage, session bookkeeping) never reach the customer —
// and because their dropped ancestors were what broke parentage, the
// surviving ai.* spans attach cleanly to the turn.
func TestCustomerForwardFiltersPlumbingSpans(t *testing.T) {
	customer := startSignallingIngest(t)
	relay := relayWithInternal(t, "")
	token, err := relay.Register(WorkerInfo{
		ConversationID:    "conv-filter",
		LangwatchEndpoint: customer.srv.URL,
		LangwatchAPIKey:   "sk-session",
	})
	require.NoError(t, err)
	turn := turnContext()
	relay.SetTurnContext(token, turn)

	td := ptrace.NewTraces()
	ss := td.ResourceSpans().AppendEmpty().ScopeSpans().AppendEmpty()
	session := ss.Spans().AppendEmpty()
	session.SetName("SessionProcessor.flushV2Fragments")
	session.SetSpanID(pcommon.SpanID{7})
	sql := ss.Spans().AppendEmpty()
	sql.SetName("sql.execute")
	sql.SetSpanID(pcommon.SpanID{8})
	llm := ss.Spans().AppendEmpty()
	llm.SetName("ai.streamText")
	llm.SetSpanID(pcommon.SpanID{9})
	llm.SetParentSpanID(pcommon.SpanID{7}) // parent is plumbing → filtered → orphan
	payload, err := (&ptrace.ProtoMarshaler{}).MarshalTraces(td)
	require.NoError(t, err)

	resp, err := http.Post(
		relay.OTLPEndpointFor(token)+"/v1/traces",
		"application/x-protobuf",
		bytes.NewReader(payload),
	)
	require.NoError(t, err)
	require.NoError(t, resp.Body.Close())
	require.Equal(t, http.StatusOK, resp.StatusCode)

	forwarded, err := (&ptrace.ProtoUnmarshaler{}).UnmarshalTraces(customer.await(t))
	require.NoError(t, err)
	require.Equal(t, 1, forwarded.SpanCount(), "only the ai.* span may reach the customer")
	span := forwarded.ResourceSpans().At(0).ScopeSpans().At(0).Spans().At(0)
	assert.Equal(t, "ai.streamText", span.Name())
	assert.Equal(t, pcommon.SpanID(turn.SpanID()), span.ParentSpanID(),
		"with its plumbing ancestor filtered, the span must attach to the turn")
}
