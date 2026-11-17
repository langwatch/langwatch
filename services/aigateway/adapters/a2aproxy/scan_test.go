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
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

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

func TestCollectTextsSkipsProtocolValues(t *testing.T) {
	p := collectTexts([]byte(sendMessage("SendMessage", "hello")))
	require.True(t, p.parsed)
	assert.Equal(t, []string{"hello"}, p.texts)
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

// @scenario "a payload is read without building a tree, and only when a guardrail applies"
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
	code, reason, _ := rpcError(t, rec)
	assert.Equal(t, -32020, code)
	assert.Equal(t, "a2a_too_many_requests", reason)
	assert.Empty(t, f.upstreamCalls())

	h.inflight.release(f.bundle.VirtualKeyID)
	assert.True(t, h.inflight.acquire("vk_other"), "other keys are not affected")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "http://gw.acme.test/a2a/billing", strings.NewReader(sendMessage("SendMessage", "hi"))))
	assert.Contains(t, rec.Body.String(), "TASK_STATE_COMPLETED")
}
