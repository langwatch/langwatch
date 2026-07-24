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

// assertSilent fails if any export arrives within the grace window. Used to pin
// the skip tier: nothing about the turn may reach the mirror. Call it AFTER a
// sibling lane (the customer forward) has been observed, so the batch is known
// to have been processed and this is a true negative, not a race.
func (s *signallingIngest) assertSilent(t *testing.T, grace time.Duration) {
	t.Helper()
	select {
	case <-s.got:
		t.Fatal("an export arrived on a lane that must have stayed silent")
	case <-time.After(grace):
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

	t.Run("when a mirror destination is configured (ADR-061)", func(t *testing.T) {
		customer := startSignallingIngest(t)
		internal := startSignallingIngest(t)
		mirror := startSignallingIngest(t)
		relay := relayWithOptions(t, Options{
			InternalOTLPEndpoint: internal.srv.URL,
			MirrorEndpoint:       mirror.srv.URL,
			MirrorKey:            "sk-mirror-static",
		})

		token, err := relay.Register(WorkerInfo{
			ConversationID:    "conv-mirror",
			LangwatchEndpoint: customer.srv.URL,
			LangwatchAPIKey:   "sk-session",
			Model:             "gpt-5-mini",
			MirrorTier:        "content",
		})
		require.NoError(t, err)

		resp, err := http.Post(
			relay.OTLPEndpointFor(token)+"/v1/traces",
			"application/x-protobuf",
			bytes.NewReader(contentBatch(t)),
		)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		require.Equal(t, http.StatusOK, resp.StatusCode)

		t.Run("the mirror ingests like an ordinary LangWatch project", func(t *testing.T) {
			body := mirror.await(t)
			assert.Contains(t, string(body), "gpt-5-mini",
				"operational metadata must reach the mirror")
			assert.Equal(t, "Bearer sk-mirror-static", <-mirror.authz,
				"the mirror authenticates with the static mirror key")
			assert.Equal(t, "/api/otel/v1/traces", <-mirror.path,
				"the mirror is a LangWatch project ingest, not a bare collector")
		})

		t.Run("the customer forward never carries the mirror key", func(t *testing.T) {
			customer.await(t)
			assert.Equal(t, "Bearer sk-session", <-customer.authz)
		})

		t.Run("the collector copy still arrives alongside the mirror", func(t *testing.T) {
			internal.await(t)
			assert.Equal(t, "/v1/traces", <-internal.path)
		})
	})

	t.Run("when the mirror ingest is failing", func(t *testing.T) {
		customer := startSignallingIngest(t)
		mirror := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusBadGateway)
		}))
		t.Cleanup(mirror.Close)
		relay := relayWithOptions(t, Options{
			MirrorEndpoint: mirror.URL,
			MirrorKey:      "sk-mirror-static",
		})

		token, err := relay.Register(WorkerInfo{
			ConversationID:    "conv-mirror-down",
			LangwatchEndpoint: customer.srv.URL,
			LangwatchAPIKey:   "sk-session",
			Model:             "gpt-5-mini",
			MirrorTier:        "content",
		})
		require.NoError(t, err)

		resp, err := http.Post(
			relay.OTLPEndpointFor(token)+"/v1/traces",
			"application/x-protobuf",
			bytes.NewReader(contentBatch(t)),
		)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		assert.Equal(t, http.StatusOK, resp.StatusCode,
			"a mirror 5xx must never surface on the worker's export response")
		assert.True(t, bytes.Contains(customer.await(t), []byte(workerPrompt)),
			"the customer lane must be untouched by a mirror outage")
	})

	t.Run("when the mirror ingest hangs", func(t *testing.T) {
		customer := startSignallingIngest(t)
		release := make(chan struct{})
		mirror := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// Drain the body first: with it unread, the HTTP/1 server never
			// arms the background read, so a client-side abort would not fire
			// req.Context().Done() and Close would wait on this handler.
			_, _ = io.Copy(io.Discard, req.Body)
			select {
			case <-release:
			case <-req.Context().Done():
			}
		}))
		t.Cleanup(mirror.Close)
		// Registered AFTER mirror.Close so it runs FIRST (LIFO): the handler
		// must be released before the server's Close waits on it.
		t.Cleanup(func() { close(release) })
		relay := relayWithOptions(t, Options{
			MirrorEndpoint: mirror.URL,
			MirrorKey:      "sk-mirror-static",
		})

		token, err := relay.Register(WorkerInfo{
			ConversationID:    "conv-mirror-hang",
			LangwatchEndpoint: customer.srv.URL,
			LangwatchAPIKey:   "sk-session",
			Model:             "gpt-5-mini",
			MirrorTier:        "content",
		})
		require.NoError(t, err)

		start := time.Now()
		resp, err := http.Post(
			relay.OTLPEndpointFor(token)+"/v1/traces",
			"application/x-protobuf",
			bytes.NewReader(contentBatch(t)),
		)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		assert.Equal(t, http.StatusOK, resp.StatusCode)
		assert.Less(t, time.Since(start), 2*time.Second,
			"a hung mirror must not delay the worker's export response")
		assert.True(t, bytes.Contains(customer.await(t), []byte(workerPrompt)),
			"the customer forward must not wait on the mirror")
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

// The ADR-061 tier decides what of the turn reaches the mirror, end to end
// through the relay: content carries the bodies, structural strips them, skip
// mirrors nothing — and the SOURCE tenant is stamped on the mirror but never on
// the customer forward.
func TestMirrorTiersEndToEnd(t *testing.T) {
	register := func(relay *Relay, customerURL, tier string) string {
		t.Helper()
		token, err := relay.Register(WorkerInfo{
			ConversationID:       "conv-tier",
			LangwatchEndpoint:    customerURL,
			LangwatchAPIKey:      "sk-session",
			Model:                "gpt-5-mini",
			MirrorTier:           tier,
			SourceOrganizationID: "org-acme",
			SourceProjectID:      "proj-acme",
		})
		require.NoError(t, err)
		return token
	}
	post := func(relay *Relay, token string) {
		t.Helper()
		resp, err := http.Post(
			relay.OTLPEndpointFor(token)+"/v1/traces",
			"application/x-protobuf",
			bytes.NewReader(contentBatch(t)),
		)
		require.NoError(t, err)
		require.NoError(t, resp.Body.Close())
		require.Equal(t, http.StatusOK, resp.StatusCode)
	}

	t.Run("content tier mirrors the bodies and the source tenant", func(t *testing.T) {
		customer := startSignallingIngest(t)
		mirror := startSignallingIngest(t)
		relay := relayWithOptions(t, Options{MirrorEndpoint: mirror.srv.URL, MirrorKey: "sk-mirror"})
		post(relay, register(relay, customer.srv.URL, "content"))

		body := string(mirror.await(t))
		for _, want := range []string{workerPrompt, workerCompletion, workerToolOutput, "org-acme", "proj-acme"} {
			assert.Contains(t, body, want, "content tier + attribution must reach the mirror")
		}

		customerBody := string(customer.await(t))
		assert.NotContains(t, customerBody, "org-acme",
			"the source org must never ride the customer's own forward")
		assert.NotContains(t, customerBody, "proj-acme",
			"the source project must never ride the customer's own forward")
	})

	t.Run("structural tier mirrors the shape and tenant but no content", func(t *testing.T) {
		customer := startSignallingIngest(t)
		mirror := startSignallingIngest(t)
		relay := relayWithOptions(t, Options{MirrorEndpoint: mirror.srv.URL, MirrorKey: "sk-mirror"})
		post(relay, register(relay, customer.srv.URL, "structural"))

		body := string(mirror.await(t))
		for _, absent := range []string{workerPrompt, workerCompletion, workerToolOutput} {
			assert.NotContains(t, body, absent, "structural tier must carry no content")
		}
		assert.Contains(t, body, "org-acme", "structural still attributes the source tenant")
		assert.Contains(t, body, "gpt-5-mini", "structural still carries the operational model")
	})

	t.Run("skip tier mirrors nothing while the customer forward is unaffected", func(t *testing.T) {
		customer := startSignallingIngest(t)
		mirror := startSignallingIngest(t)
		relay := relayWithOptions(t, Options{MirrorEndpoint: mirror.srv.URL, MirrorKey: "sk-mirror"})
		post(relay, register(relay, customer.srv.URL, "skip"))

		// The customer forward proves the batch was processed; the mirror must
		// then be provably silent.
		assert.Contains(t, string(customer.await(t)), workerPrompt)
		mirror.assertSilent(t, 300*time.Millisecond)
	})
}
