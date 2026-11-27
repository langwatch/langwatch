package a2aproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/trace"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func httpError(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var out struct {
		Error struct {
			Reason string `json:"reason"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), rec.Body.String())
	return out.Error.Reason
}

func (f *fixture) serve(req *http.Request, client *http.Client) *httptest.ResponseRecorder {
	if client == nil {
		client = f.upstream.Client()
	}
	h := New(Config{
		Registry:      f.registry,
		Scanner:       f.scanner,
		Bundle:        func(context.Context) *domain.Bundle { return f.bundle },
		Client:        client,
		Tracer:        sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(f.spans)).Tracer("test"),
		PublicBaseURL: testPublicBaseURL,
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

// @scenario "a request body over the size limit is refused, not cut"
func TestOversizedRequestIsRefused(t *testing.T) {
	f := newFixture(t)
	body := `{"message":{"parts":[{"text":"` + strings.Repeat("a", maxBodyBytes) + `"}]}}`
	rec := f.do(http.MethodPost, "/a2a/billing/message:send", body)

	assert.Equal(t, http.StatusRequestEntityTooLarge, rec.Code)
	assert.Equal(t, "a2a_payload_too_large", httpError(t, rec))
	assert.Empty(t, f.upstreamCalls())
}

// @scenario "a reply over the size limit is refused, not cut"
func TestOversizedReplyIsRefused(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(bytes.Repeat([]byte(" "), maxBodyBytes+1))
	}
	rec := f.do(http.MethodPost, "/a2a/billing/message:send", `{"message":{"parts":[{"text":"hi"}]}}`)

	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Equal(t, "a2a_payload_too_large", httpError(t, rec))
}

// @scenario "a path that could leave the upstream base path is refused"
func TestPathThatLeavesTheBaseIsRefused(t *testing.T) {
	for _, path := range []string{
		"/a2a/billing/%2e%2e/admin",
		"/a2a/billing/../admin",
		"/a2a/billing/..%2Fadmin",
		"/a2a/billing/tasks/x%3Fadmin=1",
		"/a2a/billing/tasks/x%23frag",
		"/a2a/billing/tasks/x%5C..",
		"/a2a/billing/a%2Fb/message:send",
	} {
		t.Run(path, func(t *testing.T) {
			for _, method := range []string{http.MethodGet, http.MethodPost} {
				f := newFixture(t)
				rec := f.do(method, path, sendMessage("SendMessage", "hi"))
				assert.Equal(t, http.StatusBadRequest, rec.Code, method+" "+rec.Body.String())
				assert.Equal(t, "a2a_invalid_request", httpError(t, rec))
				assert.Contains(t, rec.Body.String(), `"message":"the A2A path is not allowed"`)
				assert.Empty(t, f.upstreamCalls())
			}
		})
	}
}

// @scenario "a method and path that is not an A2A operation is refused"
func TestUnsupportedOperationIsRefused(t *testing.T) {
	for _, call := range [][2]string{
		{http.MethodGet, "/a2a/billing/admin"},
		{http.MethodPost, "/a2a/billing/tasks/abc"},
		{http.MethodGet, "/a2a/billing/tasks/abc:cancel"},
		{http.MethodDelete, "/a2a/billing/message:send"},
		{http.MethodGet, "/a2a/billing/tasks/abc/other"},
		{http.MethodPut, "/a2a/billing/tasks/abc/pushNotificationConfigs/c1"},
	} {
		t.Run(call[0]+" "+call[1], func(t *testing.T) {
			f := newFixture(t)
			rec := f.do(call[0], call[1], "")
			assert.Equal(t, http.StatusNotFound, rec.Code, rec.Body.String())
			assert.Equal(t, "a2a_operation_not_supported", httpError(t, rec))
			assert.Empty(t, f.upstreamCalls())
		})
	}
}

func TestKnownOperationsAreNamed(t *testing.T) {
	for _, c := range []struct{ method, path, want string }{
		{http.MethodGet, "/tasks/abc", "GetTask"},
		{http.MethodPost, "/tasks/abc:cancel", "CancelTask"},
		{http.MethodGet, "/tasks/abc:subscribe", "SubscribeToTask"},
		{http.MethodGet, "/tasks", "ListTasks"},
		{http.MethodGet, "/extendedAgentCard", "GetExtendedAgentCard"},
		{http.MethodPost, "/tasks/abc/pushNotificationConfigs", "CreateTaskPushNotificationConfig"},
		{http.MethodDelete, "/tasks/abc/pushNotificationConfigs/c1", "DeleteTaskPushNotificationConfig"},
	} {
		got, ok := restMethod(c.method, c.path, c.path)
		assert.True(t, ok, c.path)
		assert.Equal(t, c.want, got)
	}
}

func TestEscapedPathIsForwardedEscaped(t *testing.T) {
	f := newFixture(t)
	var escaped string
	f.reply = func(w http.ResponseWriter, r *http.Request) {
		escaped = r.URL.EscapedPath()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{}`)
	}
	rec := f.do(http.MethodGet, "/a2a/billing/tasks/a%20b?historyLength=2", "")

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, "/a2a/tasks/a%20b", escaped)
}

// @scenario "a request the scanner cannot read is refused when the key scans requests"
func TestUnreadableRequestIsRefusedWhenScanned(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "wire the money"}}
	rec := f.do(http.MethodPost, "/a2a/billing/message:send", "wire the money")

	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, "a2a_content_unscannable", httpError(t, rec))
	assert.Empty(t, f.upstreamCalls())
}

func TestUnreadableRequestPassesWithoutRequestGuardrails(t *testing.T) {
	f := newFixture(t)
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "wire the money"}}
	rec := f.do(http.MethodPost, "/a2a/billing/message:send", "not json")

	assert.Equal(t, http.StatusOK, rec.Code)
	assert.Len(t, f.upstreamCalls(), 1)
}

// @scenario "a reply the scanner cannot read is refused when the key scans replies"
func TestUnreadableReplyIsRefusedWhenScanned(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "card number"}}
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "card number 4111")
	}
	rec := f.do(http.MethodPost, "/a2a/billing/message:send", `{"message":{"parts":[{"text":"hi"}]}}`)

	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Equal(t, "a2a_content_unscannable", httpError(t, rec))
	assert.NotContains(t, rec.Body.String(), "4111")
}

func TestUnreadableStreamEventIsRefusedWhenScanned(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "card number"}}
	f.reply = sseReply(`card number 4111`)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.Contains(t, rec.Body.String(), `"reason":"a2a_content_unscannable"`)
	assert.NotContains(t, rec.Body.String(), "4111")
}

// @scenario "hop-by-hop and cookie headers from the upstream are dropped"
func TestHopByHopAndCookieHeadersAreDropped(t *testing.T) {
	src := http.Header{}
	for _, k := range []string{"Keep-Alive", "Proxy-Authenticate", "Te", "Trailer", "Upgrade", "Set-Cookie", "X-Upstream-Secret", "X-Kept", "Content-Type"} {
		src.Set(k, "v")
	}
	src.Set("Connection", "close, x-upstream-secret")
	dst := http.Header{}
	copyHeader(dst, src)

	assert.Equal(t, http.Header{"Content-Type": {"application/json"}, "X-Content-Type-Options": {"nosniff"}, "Cache-Control": {"no-store"}}, dst)

	src = http.Header{"Content-Type": {"text/event-stream"}, "Access-Control-Allow-Origin": {"*"}, "Www-Authenticate": {"Basic"}, "A2a-Version": {"1.0"}}
	dst = http.Header{}
	copyHeader(dst, src)
	assert.Equal(t, http.Header{"Content-Type": {"text/event-stream"}, "A2a-Version": {"1.0"}, "X-Content-Type-Options": {"nosniff"}, "Cache-Control": {"no-store"}}, dst)
}

func TestCardURLWithDotSegmentsBecomesTheProxyBase(t *testing.T) {
	card := map[string]any{
		"url": "https://up.acme.test/a2a/../../v1/chat/completions",
		"supportedInterfaces": []any{
			map[string]any{"url": "https://up.acme.test/a2a/%2e%2e/v1"},
			map[string]any{"url": "https://up.acme.test/a2a/"},
		},
	}
	rewriteCard(card, "https://up.acme.test/a2a", "https://gw/a2a/billing")
	assert.Equal(t, "https://gw/a2a/billing", card["url"])
	assert.Equal(t, []any{map[string]any{"url": "https://gw/a2a/billing"}}, card["supportedInterfaces"])
}

// @scenario "the extended Agent Card reply points at the gateway in v1.0 and v0.3"
func TestExtendedCardReplyIsRewritten(t *testing.T) {
	for _, method := range []string{"GetExtendedAgentCard", "agent/getAuthenticatedExtendedCard"} {
		t.Run(method, func(t *testing.T) {
			f := newFixture(t)
			f.reply = func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":7,"result":{"name":"Billing","url":"`+f.upstream.URL+`/a2a","supportedInterfaces":[{"url":"`+f.upstream.URL+`/a2a"},{"url":"`+f.upstream.URL+`/a2a/rest"}]}}`)
			}
			rec := f.do(http.MethodPost, "/a2a/billing", `{"jsonrpc":"2.0","id":7,"method":"`+method+`"}`)

			assert.NotContains(t, rec.Body.String(), f.upstream.URL)
			assert.Contains(t, rec.Body.String(), `"supportedInterfaces":[{"url":"http://gw.acme.test/a2a/billing"}]`)
		})
	}
}

// @scenario "an overlong streamed event ends the stream with an error event"
func TestOverlongStreamEventEndsWithErrorEvent(t *testing.T) {
	f := newFixture(t)
	first := `{"jsonrpc":"2.0","id":7,"result":{"statusUpdate":{"taskId":"t1","status":{"state":"TASK_STATE_WORKING"}}}}`
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = io.WriteString(w, "data: "+first+"\n\n")
		line := "data: " + strings.Repeat("x", 1<<10) + "\n"
		for range (maxEventBytes / len(line)) + 2 {
			_, _ = io.WriteString(w, line)
		}
	}
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	chunks := strings.Split(strings.TrimSpace(rec.Body.String()), "\n\n")
	require.Len(t, chunks, 2)
	assert.Equal(t, "data: "+first, chunks[0])
	assert.Contains(t, chunks[1], `"reason":"a2a_payload_too_large"`)
}

func TestReadEventsBoundsOneLongLine(t *testing.T) {
	body := "data: " + strings.Repeat("x", maxEventBytes) + "\n\n"
	err := readEvents(strings.NewReader(body), func([]byte) bool { return true })
	assert.ErrorIs(t, err, errEventTooLarge)
}

// @scenario "the hop's span is routed to the caller's project"
func TestSpanIsRoutedToTheCallersProject(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.TraceProjectID = "proj-trace"
	req := httptest.NewRequest(http.MethodPost, "http://gw.acme.test/a2a/billing", strings.NewReader(sendMessage("SendMessage", "hi")))
	gatewaySpan := trace.NewSpanContext(trace.SpanContextConfig{
		TraceID: trace.TraceID{1}, SpanID: trace.SpanID{1}, TraceFlags: trace.FlagsSampled,
	})
	ctx := trace.ContextWithSpanContext(req.Context(), gatewaySpan)
	ctx = customertracebridge.WithTraceParent(ctx, "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01")
	rec := f.serve(req.WithContext(ctx), nil)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	spans := f.spans.Ended()
	require.Len(t, spans, 1)
	assert.Equal(t, "4bf92f3577b34da6a3ce929d0e0e4736", spans[0].SpanContext().TraceID().String(),
		"the caller's traceparent is the parent, never the gateway's own span")
	assert.Contains(t, spans[0].Attributes(), attribute.String(attrProjectID, "proj-trace"))
}

// @scenario "a redirect from the upstream is not followed"
func TestUpstreamRedirectIsNotFollowed(t *testing.T) {
	f := newFixture(t)
	var leaked []string
	other := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		leaked = append(leaked, r.Header.Get("X-Billing-Token"))
	}))
	t.Cleanup(other.Close)
	f.reply = func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, other.URL+"/steal", http.StatusTemporaryRedirect)
	}
	req := httptest.NewRequest(http.MethodPost, "http://gw.acme.test/a2a/billing/message:send", strings.NewReader(`{}`))
	rec := f.serve(req, NewUpstreamClient(UpstreamPolicy{}))

	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Equal(t, "a2a_upstream_unreachable", httpError(t, rec))
	assert.Empty(t, leaked)
}

// @scenario "an upstream on a blocked address is not called"
func TestBlockedUpstreamAddressIsNotCalled(t *testing.T) {
	f := newFixture(t)
	req := httptest.NewRequest(http.MethodPost, "http://gw.acme.test/a2a/billing/message:send", strings.NewReader(`{}`))
	rec := f.serve(req, NewUpstreamClient(UpstreamPolicy{BlockLocal: true}))

	assert.Equal(t, http.StatusBadGateway, rec.Code)
	assert.Contains(t, rec.Body.String(), "not allowed")
	assert.Empty(t, f.upstreamCalls())
}

func TestReadEventsSplitsBareCRAndDropsBOM(t *testing.T) {
	body := "\xef\xbb\xbfdata: one\r\r: ping\rdata: two\r\n\r\ndata: three\n\n"
	var got []string
	err := readEvents(strings.NewReader(body), func(event []byte) bool {
		got = append(got, string(eventData(event)))
		return true
	})
	if err != nil {
		t.Fatalf("readEvents: %v", err)
	}
	want := []string{"one\n", "two\n", "three\n"}
	if len(got) != len(want) {
		t.Fatalf("events = %q, want %q", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("event %d = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestReadEventsDropsAnUnfinishedEventAtEOF(t *testing.T) {
	for _, body := range []string{"data: one\n\ndata: {\"result\":{}}", "data: one\n\ndata: two\n"} {
		var got []string
		err := readEvents(strings.NewReader(body), func(event []byte) bool {
			got = append(got, string(eventData(event)))
			return true
		})
		require.NoError(t, err)
		assert.Equal(t, []string{"one\n"}, got, body)
	}
}

func TestCardAndRefusalRepliesForbidSniffing(t *testing.T) {
	f := newFixture(t)
	card := f.do(http.MethodGet, "/a2a/billing/.well-known/agent-card.json", "")
	require.Equal(t, http.StatusOK, card.Code)
	assert.Equal(t, "nosniff", card.Header().Get("X-Content-Type-Options"))

	refused := f.do(http.MethodPost, "/a2a/unknown", sendMessage("SendMessage", "hello"))
	assert.Equal(t, "nosniff", refused.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "no-store", refused.Header().Get("Cache-Control"))
}

// @scenario "a task id with an escaped colon is a task id, not an action"
func TestEscapedColonInTaskIDIsNotAnAction(t *testing.T) {
	f := newFixture(t)
	rec := f.do(http.MethodGet, "/a2a/billing/tasks/team%3A42", "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	rec = f.do(http.MethodPost, "/a2a/billing/tasks/team%3A42:cancel", "{}")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	calls := f.upstreamCalls()
	require.Len(t, calls, 2)
	assert.Equal(t, "/a2a/tasks/team:42", calls[0].path)
	assert.Equal(t, "/a2a/tasks/team:42:cancel", calls[1].path)

	refused := f.do(http.MethodGet, "/a2a/billing/tasks/team%3A42:cancel", "")
	assert.Equal(t, "a2a_operation_not_supported", httpError(t, refused), "a literal :cancel is still the action")
}

// @scenario "caller headers named in Connection are not forwarded"
func TestCallerFieldsNamedByConnectionAreNotForwarded(t *testing.T) {
	f := newFixture(t)
	var got http.Header
	f.reply = func(w http.ResponseWriter, r *http.Request) {
		got = r.Header.Clone()
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"task":{"id":"t1"}}`)
	}
	body := `{"message":{"parts":[{"text":"hi"}]}}`
	headers := []string{"Connection", "keep-alive, A2A-Extensions", "A2A-Extensions", "https://ext.test/caller", "A2A-Version", "1.0"}

	rec := f.do(http.MethodPost, "/a2a/billing/message:send", body, headers...)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Empty(t, got.Values("A2A-Extensions"), "a field the caller named in Connection is hop-by-hop")
	assert.Equal(t, "1.0", got.Get("A2A-Version"))

	f.setTarget(func(tg *domain.A2ATarget) { tg.UpstreamHeaders["A2A-Extensions"] = "https://ext.test/target" })
	rec = f.do(http.MethodPost, "/a2a/billing/message:send", body, headers...)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.Equal(t, []string{"https://ext.test/target"}, got.Values("A2A-Extensions"), "the target's own headers still apply")
}
