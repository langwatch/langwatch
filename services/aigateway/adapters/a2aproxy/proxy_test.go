package a2aproxy

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type upstreamCall struct {
	method, path, auth, token, traceparent string
	body                                   []byte
}

type fixture struct {
	t        *testing.T
	upstream *httptest.Server
	registry Registry
	bundle   *domain.Bundle
	scanner  Scanner
	spans    *tracetest.SpanRecorder
	mu       sync.Mutex
	calls    []upstreamCall
	reply    func(w http.ResponseWriter, r *http.Request)
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{t: t, registry: BundleRegistry{}, spans: tracetest.NewSpanRecorder()}
	f.bundle = &domain.Bundle{VirtualKeyID: "vk_support", ProjectID: "p1"}
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":1,"result":{"task":{"id":"t1","contextId":"c1","status":{"state":"TASK_STATE_COMPLETED"}}}}`)
	}
	f.upstream = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.calls = append(f.calls, upstreamCall{
			method: r.Method, path: r.URL.Path, auth: r.Header.Get("Authorization"),
			token: r.Header.Get("X-Billing-Token"), traceparent: r.Header.Get("traceparent"), body: body,
		})
		f.mu.Unlock()
		f.reply(w, r)
	}))
	t.Cleanup(f.upstream.Close)
	f.bundle.Config.A2ATargets = []domain.A2ATarget{{
		Name: "billing", AgentName: "Billing Agent", UpstreamURL: f.upstream.URL + "/a2a",
		UpstreamHeaders: map[string]string{"X-Billing-Token": "upstream-secret"},
	}}
	return f
}

func (f *fixture) setTarget(mut func(*domain.A2ATarget)) {
	for i := range f.bundle.Config.A2ATargets {
		if f.bundle.Config.A2ATargets[i].Name == "billing" {
			mut(&f.bundle.Config.A2ATargets[i])
			return
		}
	}
	f.t.Fatal("no billing target in the fixture bundle")
}

func (f *fixture) do(method, path, body string, headers ...string) *httptest.ResponseRecorder {
	h := New(Config{
		Registry: f.registry,
		Scanner:  f.scanner,
		Bundle:   func(context.Context) *domain.Bundle { return f.bundle },
		Client:   f.upstream.Client(),
		Tracer:   sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(f.spans)).Tracer("test"),
	})
	req := httptest.NewRequest(method, "http://gw.acme.test"+path, strings.NewReader(body))
	req.Header.Set("Authorization", "Bearer vk_support_secret")
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func (f *fixture) upstreamCalls() []upstreamCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]upstreamCall(nil), f.calls...)
}

func sendMessage(method, text string) string {
	return fmt.Sprintf(`{"jsonrpc":"2.0","id":7,"method":%q,"params":{"message":{"messageId":"m1","contextId":"c1","role":"ROLE_USER","parts":[{"text":%q}]}}}`, method, text)
}

func rpcError(t *testing.T, rec *httptest.ResponseRecorder) (int, string, string) {
	t.Helper()
	var out struct {
		ID    json.RawMessage `json:"id"`
		Error struct {
			Code int `json:"code"`
			Data struct {
				Reason string `json:"reason"`
			} `json:"data"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out), rec.Body.String())
	return out.Error.Code, out.Error.Data.Reason, string(out.ID)
}

// @scenario "an allowed JSON-RPC call is forwarded"
func TestAllowedJSONRPCCallIsForwarded(t *testing.T) {
	f := newFixture(t)
	f.setTarget(func(tg *domain.A2ATarget) {
		tg.Policy = &domain.A2APolicy{AllowedVirtualKeyIDs: []string{"vk_support"}}
	})
	body := sendMessage("SendMessage", "hello")
	rec := f.do(http.MethodPost, "/a2a/billing", body)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"TASK_STATE_COMPLETED"`)
	calls := f.upstreamCalls()
	require.Len(t, calls, 1)
	assert.Equal(t, "/a2a", calls[0].path)
	assert.Equal(t, body, string(calls[0].body))
	assert.Empty(t, calls[0].auth, "the caller's virtual key must not reach the upstream")
	assert.Equal(t, "upstream-secret", calls[0].token)
}

// @scenario "an HTTP+JSON call is forwarded on its path"
func TestHTTPJSONCallIsForwardedOnItsPath(t *testing.T) {
	f := newFixture(t)
	rec := f.do(http.MethodPost, "/a2a/billing/message:send", `{"message":{"parts":[{"text":"hi"}]}}`)

	require.Equal(t, http.StatusOK, rec.Code)
	calls := f.upstreamCalls()
	require.Len(t, calls, 1)
	assert.Equal(t, http.MethodPost, calls[0].method)
	assert.Equal(t, "/a2a/message:send", calls[0].path)
}

// @scenario "a target with no allow list accepts any key of its project"
func TestNoPolicyAdmitsAnyProjectKey(t *testing.T) {
	f := newFixture(t)
	rec := f.do(http.MethodPost, "/a2a/billing", `{"jsonrpc":"2.0","id":1,"method":"GetTask","params":{"id":"t1"}}`)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Len(t, f.upstreamCalls(), 1)
}

// @scenario "a caller missing from the allow list is refused"
func TestCallerMissingFromAllowListIsRefused(t *testing.T) {
	f := newFixture(t)
	f.setTarget(func(tg *domain.A2ATarget) {
		tg.Policy = &domain.A2APolicy{AllowedVirtualKeyIDs: []string{"vk_finance"}}
	})
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hello"))

	code, reason, id := rpcError(t, rec)
	assert.Equal(t, -32013, code)
	assert.Equal(t, "a2a_target_not_found", reason)
	assert.Equal(t, "7", id)
	assert.Empty(t, f.upstreamCalls())
}

// @scenario "a blocked target refuses every caller"
func TestBlockedTargetRefusesEveryCaller(t *testing.T) {
	f := newFixture(t)
	f.setTarget(func(tg *domain.A2ATarget) { tg.Blocked, tg.BlockReason = true, "kill switch" })
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hello"))

	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32011, code)
	assert.Equal(t, "a2a_target_blocked", reason)
	assert.Empty(t, f.upstreamCalls())
}

// @scenario "an unknown target is refused"
func TestUnknownTargetIsRefused(t *testing.T) {
	f := newFixture(t)
	rec := f.do(http.MethodPost, "/a2a/unknown", sendMessage("SendMessage", "hello"))
	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32013, code)
	assert.Equal(t, "a2a_target_not_found", reason)
}

// @scenario "an HTTP+JSON refusal uses an HTTP status"
func TestHTTPJSONRefusalUsesHTTPStatus(t *testing.T) {
	f := newFixture(t)
	f.setTarget(func(tg *domain.A2ATarget) { tg.Blocked = true })
	rec := f.do(http.MethodPost, "/a2a/billing/message:send", `{"message":{"parts":[{"text":"hi"}]}}`)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	var out struct {
		Error struct {
			Reason string `json:"reason"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &out))
	assert.Equal(t, "a2a_target_blocked", out.Error.Reason)
	assert.Empty(t, f.upstreamCalls())
}

// fakeEvaluator blocks any content holding its phrase, like a guardrail would.
type fakeEvaluator struct{ deny string }

func (e fakeEvaluator) verdict(body []byte) domain.GuardrailVerdict {
	if bytes.Contains(body, []byte(e.deny)) {
		return domain.GuardrailVerdict{Action: domain.GuardrailBlock, Message: "denied phrase"}
	}
	return domain.GuardrailVerdict{Action: domain.GuardrailAllow}
}

func (e fakeEvaluator) EvaluatePre(_ context.Context, _ *domain.Bundle, req *domain.Request) (domain.GuardrailVerdict, error) {
	return e.verdict(req.Body), nil
}

func (e fakeEvaluator) EvaluatePost(_ context.Context, _ *domain.Bundle, _ *domain.Request, resp *domain.Response) (domain.GuardrailVerdict, error) {
	return e.verdict(resp.Body), nil
}

// @scenario "the outgoing message is scanned and a deny verdict blocks it"
func TestOutgoingMessageDenyBlocks(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "wire the money"}}
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "please wire the money"))

	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32012, code)
	assert.Equal(t, "a2a_content_blocked", reason)
	assert.Empty(t, f.upstreamCalls())

	allowed := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "what is my balance"))
	assert.Contains(t, allowed.Body.String(), "TASK_STATE_COMPLETED")
}

// @scenario "the reply is scanned and a deny verdict blocks it"
func TestReplyDenyBlocks(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "card number"}}
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"jsonrpc":"2.0","id":7,"result":{"task":{"id":"t1","artifacts":[{"parts":[{"text":"your card number is 4111"}]}]}}}`)
	}
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hello"))

	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32012, code)
	assert.Equal(t, "a2a_content_blocked", reason)
	assert.NotContains(t, rec.Body.String(), "4111")
}

func sseReply(events ...string) func(w http.ResponseWriter, r *http.Request) {
	return func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		for _, e := range events {
			_, _ = fmt.Fprintf(w, "data: %s\n\n", e)
			w.(http.Flusher).Flush()
		}
	}
}

// @scenario "a streamed reply is forwarded event by event"
func TestStreamedReplyIsForwarded(t *testing.T) {
	f := newFixture(t)
	events := []string{
		`{"jsonrpc":"2.0","id":7,"result":{"task":{"id":"t1","status":{"state":"TASK_STATE_WORKING"}}}}`,
		`{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","artifact":{"parts":[{"text":"part one"}]}}}}`,
		`{"jsonrpc":"2.0","id":7,"result":{"statusUpdate":{"taskId":"t1","status":{"state":"TASK_STATE_COMPLETED"}}}}`,
	}
	f.reply = sseReply(events...)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	assert.Equal(t, "text/event-stream", rec.Header().Get("Content-Type"))
	want := ""
	for _, e := range events {
		want += "data: " + e + "\n\n"
	}
	assert.Equal(t, want, rec.Body.String())
}

// @scenario "a streamed event that fails the scan ends the stream"
func TestStreamedEventDenyEndsStream(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "card number"}}
	first := `{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","artifact":{"parts":[{"text":"hello"}]}}}}`
	f.reply = sseReply(first,
		`{"jsonrpc":"2.0","id":7,"result":{"artifactUpdate":{"taskId":"t1","artifact":{"parts":[{"text":"card number 4111"}]}}}}`,
		`{"jsonrpc":"2.0","id":7,"result":{"statusUpdate":{"taskId":"t1","status":{"state":"TASK_STATE_COMPLETED"}}}}`)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendStreamingMessage", "hello"))

	chunks := strings.Split(strings.TrimSpace(rec.Body.String()), "\n\n")
	require.Len(t, chunks, 2, rec.Body.String())
	assert.Equal(t, "data: "+first, chunks[0])
	assert.Contains(t, chunks[1], `"reason":"a2a_content_blocked"`)
	assert.NotContains(t, rec.Body.String(), "4111")
	assert.NotContains(t, rec.Body.String(), "TASK_STATE_COMPLETED")
}

// @scenario "the trace continues through the hop"
func TestTraceContinuesThroughTheHop(t *testing.T) {
	f := newFixture(t)
	rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hello"),
		"traceparent", "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
		CallerAgentHeader, "Support Agent")
	require.Equal(t, http.StatusOK, rec.Code)

	calls := f.upstreamCalls()
	require.Len(t, calls, 1)
	assert.True(t, strings.HasPrefix(calls[0].traceparent, "00-4bf92f3577b34da6a3ce929d0e0e4736-"), calls[0].traceparent)

	spans := f.spans.Ended()
	require.Len(t, spans, 1)
	span := spans[0]
	assert.Equal(t, "invoke_agent billing", span.Name())
	assert.Equal(t, "4bf92f3577b34da6a3ce929d0e0e4736", span.SpanContext().TraceID().String())
	assert.Equal(t, "00f067aa0ba902b7", span.Parent().SpanID().String())
	assert.NotContains(t, calls[0].traceparent, "00f067aa0ba902b7", "the upstream's parent is the proxy span")
	attrs := map[attribute.Key]string{}
	for _, kv := range span.Attributes() {
		attrs[kv.Key] = kv.Value.String()
	}
	assert.Equal(t, "Billing Agent", attrs[attrAgentName])
	assert.Equal(t, "SendMessage", attrs[attrMethod])
	assert.Equal(t, "JSONRPC", attrs[attrBinding])
	assert.Equal(t, "vk_support", attrs[attrCallerVK])
	assert.Equal(t, "Support Agent", attrs[attrCallerAgentName])
	assert.Equal(t, "c1", attrs[attrContextID])
	assert.Equal(t, "t1", attrs[attrTaskID])
	assert.Equal(t, "TASK_STATE_COMPLETED", attrs[attrTaskState])
}

// @scenario "the Agent Card is served with the gateway URL in place of the upstream"
func TestAgentCardURLIsRewritten(t *testing.T) {
	f := newFixture(t)
	f.reply = func(w http.ResponseWriter, _ *http.Request) {
		base := f.upstream.URL + "/a2a"
		_, _ = fmt.Fprintf(w, `{"name":"Billing Agent","url":%q,"supportedInterfaces":[{"url":%q,"protocolBinding":"JSONRPC"},{"url":%q,"protocolBinding":"HTTP+JSON"}],"additionalInterfaces":[{"url":"https://elsewhere.acme.test/rpc"}]}`, base, base, base+"/v1")
	}
	rec := f.do(http.MethodGet, "/a2a/billing/.well-known/agent-card.json", "")

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	calls := f.upstreamCalls()
	require.Len(t, calls, 1)
	assert.Equal(t, "/a2a/.well-known/agent-card.json", calls[0].path)
	var card struct {
		URL        string `json:"url"`
		Interfaces []struct {
			URL string `json:"url"`
		} `json:"supportedInterfaces"`
		Additional []struct {
			URL string `json:"url"`
		} `json:"additionalInterfaces"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &card))
	assert.Equal(t, "http://gw.acme.test/a2a/billing", card.URL)
	require.Len(t, card.Interfaces, 1)
	assert.Equal(t, "http://gw.acme.test/a2a/billing", card.Interfaces[0].URL)
	assert.Empty(t, card.Additional)
	assert.NotContains(t, rec.Body.String(), f.upstream.URL)
}

func TestBundleRegistryFindsTargetInBundle(t *testing.T) {
	bundle := &domain.Bundle{Config: domain.BundleConfig{A2ATargets: []domain.A2ATarget{{Name: "billing", UpstreamURL: "http://billing"}}}}
	got, err := BundleRegistry{}.Lookup(context.Background(), bundle, "billing")
	if err != nil || got.UpstreamURL != "http://billing" {
		t.Fatalf("lookup = %+v, %v", got, err)
	}
	if _, err := (BundleRegistry{}).Lookup(context.Background(), bundle, "other"); !errors.Is(err, domain.ErrA2ATargetNotFound) {
		t.Fatalf("missing target err = %v", err)
	}
}
