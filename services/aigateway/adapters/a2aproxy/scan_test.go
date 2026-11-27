package a2aproxy

import (
	"context"
	"encoding/base64"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/codes"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func rpcBody(params string) string {
	return `{"jsonrpc":"2.0","id":7,"method":"SendMessage","params":` + params + `}`
}

// @scenario "the outgoing scan covers every part of the payload, not only text parts"
func TestRequestScanCoversEveryPart(t *testing.T) {
	phrase := base64.StdEncoding.EncodeToString([]byte("please wire the money"))
	for name, params := range map[string]string{
		"data part":          `{"message":{"messageId":"m1","parts":[{"data":{"note":"wire the money"}}]}}`,
		"data part v0.3":     `{"message":{"messageId":"m1","parts":[{"kind":"data","data":{"wire the money":1}}]}}`,
		"text file part":     `{"message":{"messageId":"m1","parts":[{"raw":"` + phrase + `","mediaType":"text/plain"}]}}`,
		"text file v0.3":     `{"message":{"messageId":"m1","parts":[{"kind":"file","file":{"bytes":"` + phrase + `"}}]}}`,
		"message metadata":   `{"message":{"messageId":"m1","parts":[{"text":"hi"}],"metadata":{"x":"wire the money"}}}`,
		"params metadata":    `{"message":{"messageId":"m1","parts":[{"text":"hi"}]},"metadata":{"x":"wire the money"}}`,
		"case variant keys":  `{"message":{"messageId":"m1","Parts":[{"Text":"wire the money"}]}}`,
		"artifact like name": `{"message":{"messageId":"m1","parts":[{"text":"hi","filename":"wire the money.txt"}]}}`,
		"task id":            `{"message":{"messageId":"m1","taskId":"wire the money","parts":[{"text":"hi"}]}}`,
		"role":               `{"message":{"messageId":"m1","role":"wire the money","parts":[{"text":"hi"}]}}`,
		"message id":         `{"message":{"messageId":"wire the money","parts":[{"text":"hi"}]}}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
			f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "wire the money"}}
			rec := f.do(http.MethodPost, "/a2a/billing", rpcBody(params))

			_, reason, _ := rpcError(t, rec)
			assert.Equal(t, "a2a_content_blocked", reason)
			assert.Empty(t, f.upstreamCalls())
		})
	}
}

// @scenario "the reply scan covers error messages and data parts"
func TestReplyScanCoversErrorsAndDataParts(t *testing.T) {
	for name, reply := range map[string]string{
		"error message": `{"jsonrpc":"2.0","id":7,"error":{"code":-1,"message":"card number 4111"}}`,
		"error data":    `{"jsonrpc":"2.0","id":7,"error":{"code":-1,"message":"x","data":{"hint":"card number 4111"}}}`,
		"data part":     `{"jsonrpc":"2.0","id":7,"result":{"message":{"parts":[{"data":{"v":"card number 4111"}}]}}}`,
		"artifact name": `{"jsonrpc":"2.0","id":7,"result":{"task":{"id":"t1","artifacts":[{"name":"card number 4111","parts":[]}]}}}`,
		"task state":    `{"jsonrpc":"2.0","id":7,"result":{"task":{"id":"t1","status":{"state":"card number 4111"}}}}`,
		"context id":    `{"jsonrpc":"2.0","id":7,"result":{"task":{"id":"t1","contextId":"card number 4111"}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g1"}}
			f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "card number"}}
			f.reply = func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_, _ = io.WriteString(w, reply)
			}
			rec := f.do(http.MethodPost, "/a2a/billing", sendMessage("SendMessage", "hi"))

			_, reason, _ := rpcError(t, rec)
			assert.Equal(t, "a2a_content_blocked", reason)
			assert.NotContains(t, rec.Body.String(), "4111")
		})
	}
}

func TestCollectTextsReadsProtocolValuesButNotProtocolKeys(t *testing.T) {
	p := collectTexts([]byte(sendMessage("SendMessage", "hello")))
	require.True(t, p.parsed)
	assert.Equal(t, []string{"2.0", "SendMessage", "m1", "c1", "ROLE_USER", "hello"}, p.texts)
	assert.False(t, collectTexts([]byte(`{"a":1} {"b":2}`)).parsed)
	assert.False(t, collectTexts([]byte(strings.Repeat("[", maxJSONDepth+1))).parsed)
}

// manySmallParts is the shape that used to hold 28 times its size as a tree.
func manySmallParts() string {
	part := `{"text":"a"},`
	n := (maxBodyBytes - 200) / len(part)
	return rpcBody(`{"message":{"messageId":"m1","parts":[` + strings.Repeat(part, n) + `{"text":"a"}]}}`)
}

func allocatedBy(fn func()) uint64 {
	var before, after runtime.MemStats
	runtime.GC()
	runtime.ReadMemStats(&before)
	fn()
	runtime.ReadMemStats(&after)
	return after.TotalAlloc - before.TotalAlloc
}

// @scenario "a payload is served with bounded allocations with and without a guardrail"
func TestSmallPartsBodyStaysCheap(t *testing.T) {
	body := manySmallParts()
	require.Less(t, len(body), maxBodyBytes)
	for name, guarded := range map[string]bool{"no guardrail": false, "guardrail": true} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			if guarded {
				f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
				f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "never present"}}
			}
			var rec *httptest.ResponseRecorder
			alloc := allocatedBy(func() { rec = f.do(http.MethodPost, "/a2a/billing", body) })

			assert.Contains(t, rec.Body.String(), "TASK_STATE_COMPLETED")
			limit := uint64(12 * maxBodyBytes)
			if guarded {
				limit = 40 * maxBodyBytes
			}
			t.Logf("allocated %d MiB", alloc>>20)
			assert.Less(t, alloc, limit)
		})
	}
}

// @scenario "a virtual key with too many calls in flight is refused"
func TestBusyKeyIsRefused(t *testing.T) {
	f := newFixture(t)
	h := New(Config{
		Registry: f.registry,
		Bundle:   func(context.Context) *domain.Bundle { return f.bundle },
		Client:   f.upstream.Client(),
		Tracer:   sdktrace.NewTracerProvider().Tracer("test"),
	})
	for range maxInFlightPerKey {
		require.True(t, h.inflight.acquire(f.bundle.VirtualKeyID))
	}
	req := httptest.NewRequest(http.MethodPost, "http://gw.acme.test/a2a/billing/message:send", strings.NewReader(`{"message":{"parts":[{"text":"hi"}]}}`))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.Equal(t, "a2a_too_many_requests", httpError(t, rec))

	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "http://gw.acme.test/a2a/billing", strings.NewReader(sendMessage("SendMessage", "hi"))))
	assert.Equal(t, http.StatusOK, rec.Code, "a JSON-RPC caller gets the JSON-RPC error shape")
	code, reason, id := rpcError(t, rec)
	assert.Equal(t, -32020, code)
	assert.Equal(t, "a2a_too_many_requests", reason)
	assert.Equal(t, "7", id, "the refusal echoes the request id")
	assert.Empty(t, f.upstreamCalls())

	h.inflight.release(f.bundle.VirtualKeyID)
	assert.True(t, h.inflight.acquire("vk_other"), "other keys are not affected")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "http://gw.acme.test/a2a/billing", strings.NewReader(sendMessage("SendMessage", "hi"))))
	assert.Contains(t, rec.Body.String(), "TASK_STATE_COMPLETED")
}

// @scenario "text under a protocol field name inside a data part or metadata is scanned"
func TestContentUnderProtocolNamedKeysIsScanned(t *testing.T) {
	for name, params := range map[string]string{
		"data part id":        `{"message":{"messageId":"m1","parts":[{"data":{"id":"wire the money"}}]}}`,
		"data part nested":    `{"message":{"messageId":"m1","parts":[{"data":{"rows":[{"role":"wire the money"}]}}]}}`,
		"message metadata":    `{"message":{"messageId":"m1","parts":[{"text":"hi"}],"metadata":{"state":"wire the money"}}}`,
		"params metadata key": `{"message":{"messageId":"m1","parts":[{"text":"hi"}]},"metadata":{"timestamp":{"kind":"wire the money"}}}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
			f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "wire the money"}}
			rec := f.do(http.MethodPost, "/a2a/billing", rpcBody(params))

			_, reason, _ := rpcError(t, rec)
			assert.Equal(t, "a2a_content_blocked", reason)
			assert.Empty(t, f.upstreamCalls())
		})
	}
	p := collectTexts([]byte(rpcBody(`{"message":{"messageId":"m1","role":"user","parts":[{"kind":"data","data":{"id":"x1"}}]}}`)))
	assert.Equal(t, []string{"2.0", "SendMessage", "m1", "user", "data", "id", "x1"}, p.texts)
}

// ghToken is a made-up GitHub token shape the guardrail fake denies; it is
// allowlisted by value for this file in .gitleaks.toml.
const ghToken = "ghp_aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY3zA5"

func secretsFixture(t *testing.T) *fixture {
	t.Helper()
	f := newFixture(t)
	f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
	f.bundle.Config.Guardrails.Post = []domain.GuardrailEntry{{ID: "g2"}}
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: ghToken}}
	return f
}

// @scenario "content outside text parts is scanned before the upstream"
func TestTokenOutsideTextPartsIsBlockedBeforeTheUpstream(t *testing.T) {
	file := base64.StdEncoding.EncodeToString([]byte("config: " + ghToken))
	for name, part := range map[string]string{
		"data part": `{"data":{"note":"` + ghToken + `"}}`,
		"file part": `{"raw":"` + file + `","filename":"a.txt","mediaType":"text/plain"}`,
		"metadata":  `{"text":"hi","metadata":{"k":"` + ghToken + `"}}`,
	} {
		t.Run(name, func(t *testing.T) {
			f := secretsFixture(t)
			body := `{"jsonrpc":"2.0","id":7,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[` + part + `]}}}`
			rec := f.do(http.MethodPost, "/a2a/billing", body)
			_, reason, _ := rpcError(t, rec)
			assert.Equal(t, "a2a_content_blocked", reason)
			assert.Empty(t, f.upstreamCalls())
		})
	}
}

// @scenario "the outgoing scan covers every part of the payload, not only text parts"
func TestDataPartStringsAreScannedAsWritten(t *testing.T) {
	f := newFixture(t)
	f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
	// "dG9rZW4x" is itself valid base64 (of "token1"): inside a data part it is the sender's text.
	f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "dG9rZW4x"}}
	body := `{"jsonrpc":"2.0","id":7,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER",` +
		`"parts":[{"data":{"raw":"dG9rZW4x","bytes":"dG9rZW4x"}}]}}}`
	rec := f.do(http.MethodPost, "/a2a/billing", body)

	_, reason, _ := rpcError(t, rec)
	assert.Equal(t, "a2a_content_blocked", reason)
	assert.Empty(t, f.upstreamCalls())
}

func TestFilePartBytesAreScannedDecoded(t *testing.T) {
	p := collectTexts([]byte(`{"message":{"parts":[{"raw":"dG9rZW4x","mediaType":"text/plain"}]}}`))
	assert.Contains(t, p.texts, "token1")
}

// @scenario "content outside text parts is scanned before the upstream"
func TestUnpaddedAndURLSafeFileBytesAreScannedDecoded(t *testing.T) {
	for name, encoded := range map[string]string{
		"unpadded":          "d2lyZSB0aGUgbW9uZXk",
		"URL-safe":          "d2lyZSB0aGUgbW9uZXk_Pz4=",
		"URL-safe unpadded": "d2lyZSB0aGUgbW9uZXkgfn5-",
	} {
		t.Run(name, func(t *testing.T) {
			f := newFixture(t)
			f.bundle.Config.Guardrails.Pre = []domain.GuardrailEntry{{ID: "g1"}}
			f.scanner = GuardrailScanner{Evaluator: fakeEvaluator{deny: "wire the money"}}
			body := `{"jsonrpc":"2.0","id":7,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER",` +
				`"parts":[{"raw":"` + encoded + `","mediaType":"text/plain"}]}}}`
			rec := f.do(http.MethodPost, "/a2a/billing", body)

			_, reason, _ := rpcError(t, rec)
			assert.Equal(t, "a2a_content_blocked", reason)
			assert.Empty(t, f.upstreamCalls())
		})
	}
}

// @scenario "the trace continues through the hop"
func TestJSONRPCReplyWithoutResultNamesNoTask(t *testing.T) {
	for name, body := range map[string]string{
		"error reply": `{"jsonrpc":"2.0","id":"req-7","error":{"code":-32001,"message":"no such task"}}`,
		"null result": `{"jsonrpc":"2.0","id":"req-7","result":null}`,
	} {
		t.Run(name, func(t *testing.T) {
			assert.NotContains(t, resultAttrs(body), attrTaskID)
		})
	}
	assert.Equal(t, "t1", resultAttrs(`{"id":"t1","status":{"state":"TASK_STATE_WORKING"}}`)[attrTaskID],
		"a bare HTTP+JSON task still names itself")
}

// resultAttrs records setResultAttrs on a fresh span and returns its attributes.
func resultAttrs(body string) map[string]string {
	rec := tracetest.NewSpanRecorder()
	_, span := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec)).Tracer("t").Start(context.Background(), "hop")
	setResultAttrs(span, []byte(body))
	span.End()
	out := map[string]string{}
	for _, kv := range rec.Ended()[0].Attributes() {
		out[string(kv.Key)] = kv.Value.String()
	}
	return out
}

// @scenario "a virtual key with too many calls in flight is refused"
func TestBusyRefusalLeavesTheGatewaySpanAlone(t *testing.T) {
	f := newFixture(t)
	h := New(Config{
		Registry: f.registry,
		Bundle:   func(context.Context) *domain.Bundle { return f.bundle },
		Client:   f.upstream.Client(),
		Tracer:   sdktrace.NewTracerProvider().Tracer("test"),
	})
	for range maxInFlightPerKey {
		require.True(t, h.inflight.acquire(f.bundle.VirtualKeyID))
	}
	recorder := tracetest.NewSpanRecorder()
	ctx, gatewaySpan := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder)).Tracer("gw").Start(context.Background(), "gateway")
	req := httptest.NewRequest(http.MethodPost, "http://gw.acme.test/a2a/billing/message:send", strings.NewReader(`{}`)).WithContext(ctx)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	gatewaySpan.End()

	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	ended := recorder.Ended()
	require.Len(t, ended, 1)
	for _, kv := range ended[0].Attributes() {
		assert.NotEqual(t, attrDecision, string(kv.Key), "the refusal belongs on the hop, not the gateway's own span")
	}
	assert.NotEqual(t, codes.Error, ended[0].Status().Code)
}
