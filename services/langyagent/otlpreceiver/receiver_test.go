package otlpreceiver

import (
	"bytes"
	"compress/gzip"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"google.golang.org/protobuf/proto"
)

// capturedRequest is what the fake upstream saw.
type capturedRequest struct {
	path            string
	contentType     string
	contentEncoding string
	authorization   string
	body            []byte
}

// fakeUpstream stands in for the control plane's /api/otel.
type fakeUpstream struct {
	server *httptest.Server

	mu       sync.Mutex
	requests []capturedRequest
	received chan struct{}

	status int
	block  chan struct{}
}

func newFakeUpstream(t *testing.T) *fakeUpstream {
	t.Helper()
	up := &fakeUpstream{received: make(chan struct{}, 64), status: http.StatusOK}
	up.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if up.block != nil {
			<-up.block
		}
		body, _ := io.ReadAll(r.Body)
		up.mu.Lock()
		up.requests = append(up.requests, capturedRequest{
			path:            r.URL.Path,
			contentType:     r.Header.Get("Content-Type"),
			contentEncoding: r.Header.Get("Content-Encoding"),
			authorization:   r.Header.Get("Authorization"),
			body:            body,
		})
		up.mu.Unlock()
		up.received <- struct{}{}
		w.WriteHeader(up.status)
	}))
	t.Cleanup(up.server.Close)
	return up
}

func (u *fakeUpstream) waitFor(t *testing.T, n int) {
	t.Helper()
	for range n {
		select {
		case <-u.received:
		case <-time.After(2 * time.Second):
			t.Fatalf("timed out waiting for %d upstream request(s); got %d", n, len(u.snapshot()))
		}
	}
}

func (u *fakeUpstream) snapshot() []capturedRequest {
	u.mu.Lock()
	defer u.mu.Unlock()
	return append([]capturedRequest(nil), u.requests...)
}

// recordingSink collects every batch the receiver hands over.
type recordingSink struct {
	mu     sync.Mutex
	calls  int
	events []Event
	done   chan struct{}
}

func newRecordingSink() *recordingSink {
	return &recordingSink{done: make(chan struct{}, 64)}
}

func (s *recordingSink) OnSpans(_ context.Context, events []Event) {
	s.mu.Lock()
	s.calls++
	s.events = append(s.events, events...)
	s.mu.Unlock()
	s.done <- struct{}{}
}

func (s *recordingSink) snapshot() (int, []Event) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls, append([]Event(nil), s.events...)
}

func protobufBody(t *testing.T, conversationID string) []byte {
	t.Helper()
	body, err := proto.Marshal(traceRequest(
		attrs(AttrConversationID, conversationID),
		span("chat gpt-5-mini", attrs("gen_ai.request.model", "gpt-5-mini")),
	))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return body
}

func post(t *testing.T, h http.Handler, path, contentType string, body []byte, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body))
	req.Header.Set("Content-Type", contentType)
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestReceiverForwardsUpstreamPreservingContentTypeAndHeaders(t *testing.T) {
	upstream := newFakeUpstream(t)
	sink := newRecordingSink()

	r := New(Options{
		UpstreamEndpoint: upstream.server.URL + "/api/otel",
		UpstreamHeaders:  map[string]string{"Authorization": "Bearer project-key"},
		Sink:             sink,
	})
	defer func() { _ = r.Shutdown(context.Background()) }()

	body := protobufBody(t, "conv-1")
	rec := post(t, r.Handler(), "/v1/traces", "application/x-protobuf", body, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	upstream.waitFor(t, 1)
	got := upstream.snapshot()[0]
	if got.path != "/api/otel/v1/traces" {
		t.Errorf("upstream path = %q, want /api/otel/v1/traces", got.path)
	}
	if got.contentType != "application/x-protobuf" {
		t.Errorf("upstream content-type = %q, want application/x-protobuf", got.contentType)
	}
	if got.authorization != "Bearer project-key" {
		t.Errorf("upstream authorization = %q, want the project key", got.authorization)
	}
	if !bytes.Equal(got.body, body) {
		t.Error("upstream body was not forwarded byte-for-byte")
	}
}

// TestReceiverForwardsTheWorkersOwnCredentials is the multi-tenancy contract.
// The manager holds no credentials; each worker exports with its own project
// key. The receiver must forward the key the WORKER sent, not one of its own —
// otherwise every conversation's telemetry lands in whichever project the
// manager was configured with.
func TestReceiverForwardsTheWorkersOwnCredentials(t *testing.T) {
	upstream := newFakeUpstream(t)

	r := New(Options{
		UpstreamEndpoint: upstream.server.URL + "/api/otel",
		// A configured default exists, and must LOSE to the inbound header.
		UpstreamHeaders: map[string]string{"Authorization": "Bearer manager-default"},
		Sink:            newRecordingSink(),
	})
	defer func() { _ = r.Shutdown(context.Background()) }()

	post(t, r.Handler(), "/v1/traces", "application/x-protobuf", protobufBody(t, "conv-a"),
		map[string]string{"Authorization": "Bearer worker-a-key"})
	upstream.waitFor(t, 1)

	post(t, r.Handler(), "/v1/traces", "application/x-protobuf", protobufBody(t, "conv-b"),
		map[string]string{"Authorization": "Bearer worker-b-key"})
	upstream.waitFor(t, 1)

	got := upstream.snapshot()
	if len(got) != 2 {
		t.Fatalf("upstream got %d requests, want 2", len(got))
	}
	for i, want := range []string{"Bearer worker-a-key", "Bearer worker-b-key"} {
		if got[i].authorization != want {
			t.Errorf("request %d authorization = %q, want %q — each worker's own key must survive",
				i, got[i].authorization, want)
		}
	}
}

// TestReceiverFallsBackToConfiguredHeaders: a producer that sends no credentials
// still gets the configured default (the fixed-key self-hosted case).
func TestReceiverFallsBackToConfiguredHeaders(t *testing.T) {
	upstream := newFakeUpstream(t)

	r := New(Options{
		UpstreamEndpoint: upstream.server.URL + "/api/otel",
		UpstreamHeaders:  map[string]string{"Authorization": "Bearer configured-key"},
		Sink:             newRecordingSink(),
	})
	defer func() { _ = r.Shutdown(context.Background()) }()

	post(t, r.Handler(), "/v1/traces", "application/x-protobuf", protobufBody(t, "conv-1"), nil)
	upstream.waitFor(t, 1)

	if got := upstream.snapshot()[0].authorization; got != "Bearer configured-key" {
		t.Errorf("authorization = %q, want the configured fallback", got)
	}
}

// TestReceiverForwardsUnstrippedContent pins the governance split: the SINK is
// content-stripped, the customer's own project upstream is NOT.
func TestReceiverForwardsUnstrippedContent(t *testing.T) {
	upstream := newFakeUpstream(t)
	sink := newRecordingSink()

	r := New(Options{
		UpstreamEndpoint: upstream.server.URL + "/api/otel",
		Sink:             sink,
		StripContent:     true,
	})
	defer func() { _ = r.Shutdown(context.Background()) }()

	body, err := proto.Marshal(traceRequest(
		attrs(AttrConversationID, "conv-1"),
		span("chat", attrs("gen_ai.prompt", "the customer's words", "gen_ai.request.model", "gpt-5-mini")),
	))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	post(t, r.Handler(), "/v1/traces", "application/x-protobuf", body, nil)
	upstream.waitFor(t, 1)

	if !bytes.Contains(upstream.snapshot()[0].body, []byte("the customer's words")) {
		t.Error("content was stripped from the upstream forward; it must only be stripped from the sink")
	}

	_, events := sink.snapshot()
	if len(events) != 1 {
		t.Fatalf("got %d events, want 1", len(events))
	}
	if _, ok := events[0].Attributes["gen_ai.prompt"]; ok {
		t.Error("gen_ai.prompt reached the sink despite StripContent")
	}
	if events[0].Attributes["gen_ai.request.model"] != "gpt-5-mini" {
		t.Error("stripping removed behavioural signal from the sink event")
	}
}

func TestReceiverSinkSurvivesDeadUpstream(t *testing.T) {
	sink := newRecordingSink()

	// A port nothing listens on: every forward fails.
	r := New(Options{
		UpstreamEndpoint: "http://127.0.0.1:1/api/otel",
		Sink:             sink,
		HTTPClient:       &http.Client{Timeout: 100 * time.Millisecond},
	})
	defer func() { _ = r.Shutdown(context.Background()) }()

	rec := post(t, r.Handler(), "/v1/traces", "application/x-protobuf", protobufBody(t, "conv-1"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 — a dead upstream must not fail the request", rec.Code)
	}

	calls, events := sink.snapshot()
	if calls != 1 || len(events) != 1 {
		t.Fatalf("sink calls = %d, events = %d; want 1 and 1 — a dead upstream must not starve the sink", calls, len(events))
	}
	if events[0].ConversationID != "conv-1" {
		t.Errorf("conversationId = %q, want conv-1", events[0].ConversationID)
	}
}

func TestReceiverSinkSurvivesRejectingUpstream(t *testing.T) {
	upstream := newFakeUpstream(t)
	upstream.status = http.StatusInternalServerError
	sink := newRecordingSink()

	r := New(Options{UpstreamEndpoint: upstream.server.URL + "/api/otel", Sink: sink})
	defer func() { _ = r.Shutdown(context.Background()) }()

	rec := post(t, r.Handler(), "/v1/traces", "application/x-protobuf", protobufBody(t, "conv-1"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if calls, _ := sink.snapshot(); calls != 1 {
		t.Fatalf("sink calls = %d, want 1", calls)
	}
	upstream.waitFor(t, 1)
}

// TestReceiverDropsOnOverflowRatherThanBlocking is the load-shedding contract: a
// stalled upstream fills the bounded queue and further payloads are DROPPED —
// the request still returns and the sink still gets every span. Blocking here
// would wedge a live turn behind a dead collector.
func TestReceiverDropsOnOverflowRatherThanBlocking(t *testing.T) {
	upstream := newFakeUpstream(t)
	upstream.block = make(chan struct{})
	sink := newRecordingSink()

	r := New(Options{
		UpstreamEndpoint: upstream.server.URL + "/api/otel",
		Sink:             sink,
		QueueSize:        1,
		ForwardWorkers:   1,
	})

	const posts = 6
	done := make(chan struct{})
	go func() {
		defer close(done)
		for range posts {
			post(t, r.Handler(), "/v1/traces", "application/x-protobuf", protobufBody(t, "conv-1"), nil)
		}
	}()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("requests blocked behind a stalled upstream; enqueue must never block")
	}

	calls, events := sink.snapshot()
	if calls != posts || len(events) != posts {
		t.Errorf("sink calls = %d, events = %d; want %d each — the sink must be untouched by forward pressure",
			calls, len(events), posts)
	}

	// One payload is in flight in the blocked worker and one sits in the queue,
	// so everything beyond the first two is dropped.
	if dropped := r.forwarder.Dropped(); dropped < posts-2 {
		t.Errorf("dropped = %d, want at least %d", dropped, posts-2)
	}

	close(upstream.block)
	_ = r.Shutdown(context.Background())
}

func TestReceiverShutdownDrainsQueue(t *testing.T) {
	upstream := newFakeUpstream(t)
	r := New(Options{UpstreamEndpoint: upstream.server.URL + "/api/otel", Sink: newRecordingSink()})

	post(t, r.Handler(), "/v1/traces", "application/x-protobuf", protobufBody(t, "conv-1"), nil)

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := r.Shutdown(ctx); err != nil {
		t.Fatalf("Shutdown: %v", err)
	}
	if got := len(upstream.snapshot()); got != 1 {
		t.Errorf("upstream got %d requests after drain, want 1", got)
	}
	// Shutdown is idempotent — the lifecycle group may call it twice.
	if err := r.Shutdown(ctx); err != nil {
		t.Fatalf("second Shutdown: %v", err)
	}
}

func TestReceiverPassthroughSignalsAreForwardedButNotDecoded(t *testing.T) {
	tests := []struct {
		name     string
		path     string
		wantPath string
	}{
		{name: "logs", path: "/v1/logs", wantPath: "/api/otel/v1/logs"},
		{name: "metrics", path: "/v1/metrics", wantPath: "/api/otel/v1/metrics"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			upstream := newFakeUpstream(t)
			sink := newRecordingSink()

			r := New(Options{
				UpstreamEndpoint: upstream.server.URL + "/api/otel",
				UpstreamHeaders:  map[string]string{"Authorization": "Bearer project-key"},
				Sink:             sink,
			})
			defer func() { _ = r.Shutdown(context.Background()) }()

			// Deliberately undecodable as a trace export — a passthrough signal is
			// never parsed, so this must sail through untouched.
			body := []byte{0xff, 0xfe, 0xfd}
			rec := post(t, r.Handler(), tc.path, "application/x-protobuf", body, nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}

			upstream.waitFor(t, 1)
			got := upstream.snapshot()[0]
			if got.path != tc.wantPath {
				t.Errorf("upstream path = %q, want %q", got.path, tc.wantPath)
			}
			if !bytes.Equal(got.body, body) {
				t.Error("passthrough body was altered")
			}
			if got.authorization != "Bearer project-key" {
				t.Errorf("upstream authorization = %q, want the project key", got.authorization)
			}
			if calls, _ := sink.snapshot(); calls != 0 {
				t.Errorf("sink calls = %d, want 0 — %s must not be decoded", calls, tc.path)
			}
		})
	}
}

// TestReceiverDecodesGzippedBodyAndForwardsItStillCompressed covers the OTel Go
// SDK's default: gzip. Decoding must gunzip; forwarding must not.
func TestReceiverDecodesGzippedBodyAndForwardsItStillCompressed(t *testing.T) {
	upstream := newFakeUpstream(t)
	sink := newRecordingSink()

	r := New(Options{UpstreamEndpoint: upstream.server.URL + "/api/otel", Sink: sink})
	defer func() { _ = r.Shutdown(context.Background()) }()

	raw := protobufBody(t, "conv-gzip")
	var compressed bytes.Buffer
	zw := gzip.NewWriter(&compressed)
	if _, err := zw.Write(raw); err != nil {
		t.Fatalf("gzip write: %v", err)
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("gzip close: %v", err)
	}

	rec := post(t, r.Handler(), "/v1/traces", "application/x-protobuf", compressed.Bytes(),
		map[string]string{"Content-Encoding": "gzip"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}

	_, events := sink.snapshot()
	if len(events) != 1 || events[0].ConversationID != "conv-gzip" {
		t.Fatalf("sink events = %+v, want one conv-gzip event", events)
	}

	upstream.waitFor(t, 1)
	got := upstream.snapshot()[0]
	if got.contentEncoding != "gzip" {
		t.Errorf("upstream content-encoding = %q, want gzip", got.contentEncoding)
	}
	if !bytes.Equal(got.body, compressed.Bytes()) {
		t.Error("upstream body was re-encoded; it must be forwarded verbatim")
	}
}

func TestReceiverAcceptsJSONAndAnswersJSON(t *testing.T) {
	sink := newRecordingSink()
	r := New(Options{Sink: sink})
	defer func() { _ = r.Shutdown(context.Background()) }()

	rec := post(t, r.Handler(), "/v1/traces", "application/json", []byte(otlpJSON), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("response content-type = %q, want application/json", ct)
	}
	if body := rec.Body.String(); body != "{}" {
		t.Errorf("response body = %q, want {}", body)
	}

	_, events := sink.snapshot()
	if len(events) != 1 || events[0].ConversationID != "conv-json" {
		t.Fatalf("sink events = %+v, want one conv-json event", events)
	}
}

// TestReceiverAnswersOKOnUndecodableTraces: the batch is already on its way
// upstream, so a 4xx/5xx would only make the exporter retry a payload we cannot
// parse.
func TestReceiverAnswersOKOnUndecodableTraces(t *testing.T) {
	upstream := newFakeUpstream(t)
	sink := newRecordingSink()

	r := New(Options{UpstreamEndpoint: upstream.server.URL + "/api/otel", Sink: sink})
	defer func() { _ = r.Shutdown(context.Background()) }()

	rec := post(t, r.Handler(), "/v1/traces", "application/json", []byte("{nonsense"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if calls, _ := sink.snapshot(); calls != 0 {
		t.Errorf("sink calls = %d, want 0", calls)
	}
	upstream.waitFor(t, 1)
}

func TestReceiverWithoutSinkStillForwards(t *testing.T) {
	upstream := newFakeUpstream(t)
	r := New(Options{UpstreamEndpoint: upstream.server.URL + "/api/otel"})
	defer func() { _ = r.Shutdown(context.Background()) }()

	rec := post(t, r.Handler(), "/v1/traces", "application/x-protobuf", protobufBody(t, "conv-1"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	upstream.waitFor(t, 1)
}

func TestReceiverRejectsOversizedBody(t *testing.T) {
	r := New(Options{Sink: newRecordingSink(), MaxBodyBytes: 16})
	defer func() { _ = r.Shutdown(context.Background()) }()

	rec := post(t, r.Handler(), "/v1/traces", "application/x-protobuf", bytes.Repeat([]byte{0x01}, 64), nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestReceiverRejectsNonPost(t *testing.T) {
	r := New(Options{Sink: newRecordingSink()})
	defer func() { _ = r.Shutdown(context.Background()) }()

	req := httptest.NewRequest(http.MethodGet, "/v1/traces", nil)
	rec := httptest.NewRecorder()
	r.Handler().ServeHTTP(rec, req)
	if rec.Code == http.StatusOK {
		t.Fatal("GET /v1/traces returned 200; only POST is an OTLP export")
	}
}
