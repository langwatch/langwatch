package customertracebridge

// Regression tests for the bare-concatenated-JSON-objects streaming body
// shape. The trace accumulator (traceStreamWrapper) stores the chunks the
// gateway received from Bifrost BEFORE the client-edge `data:` re-framing.
// For OpenAI Responses (codex) + Chat, Bifrost decodes the upstream stream
// and re-emits bare JSON objects, so the captured buffer is
// `{…}{…}{…}` with no SSE framing at all. looksLikeSSE returns false for
// that buffer, so the pre-fix dispatch handed it straight to the
// single-object JSON extractor, which read only the first object
// (`response.created` — no `output`) and returned "". Every codex Path A
// trace therefore rendered an empty output cell while the assistant text
// was plainly on the wire.
//
// testdata/codex_responses_stream_bare.json is a real codex /v1/responses
// stream captured live against the running gateway (gpt-5.5), reduced to
// exactly what the accumulator holds: the bare inner chunks concatenated,
// with the client-edge `data:` framing and the gateway-appended
// `[DONE]` / warning trailers stripped.

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestExtractOutputMessages_RequestTypeResponses_bareConcatenatedObjects_realCapture(t *testing.T) {
	body, err := os.ReadFile("testdata/codex_responses_stream_bare.json")
	require.NoError(t, err, "fixture must exist")
	require.False(t, looksLikeSSE(body),
		"the accumulator buffer for codex responses is bare JSON objects, not SSE-framed")

	got := extractOutputMessages(body, domain.RequestTypeResponses)
	require.NotEmpty(t, got,
		"assistant output must be lifted from the bare-object stream (regression: was empty)")
	assert.Contains(t, got, "PURPLE-ELEPHANT-SEVENTEEN",
		"the captured assistant answer must round-trip into gen_ai.output.messages")
	assert.Contains(t, got, `"role":"assistant"`)
}

func TestExtractOutputMessages_RequestTypeResponses_bareConcatenated_minimal(t *testing.T) {
	// Hand-built minimal version of the bare-object stream: response.created
	// (no output), a reasoning item (must be skipped), output_text deltas,
	// and response.completed carrying the final message. No `data:` framing,
	// no separators between objects — exactly the accumulator shape.
	body := []byte(
		`{"type":"response.created","response":{"id":"resp_x"}}` +
			`{"type":"response.output_item.added","item":{"type":"reasoning"}}` +
			`{"type":"response.output_text.delta","delta":"PO"}` +
			`{"type":"response.output_text.delta","delta":"NG"}` +
			`{"type":"response.completed","response":{"output":[` +
			`{"type":"reasoning"},` +
			`{"type":"message","role":"assistant","content":[{"type":"output_text","text":"PONG"}]}` +
			`]}}`,
	)
	require.False(t, looksLikeSSE(body))
	got := extractOutputMessages(body, domain.RequestTypeResponses)
	assert.JSONEq(t, `[{"role":"assistant","content":"PONG"}]`, got)
}

func TestExtractOutputMessages_RequestTypeChat_bareConcatenated(t *testing.T) {
	// OpenAI chat-completion streaming, bare-object framing (same Bifrost
	// decode-and-re-emit path as responses). delta.content fragments must
	// still concatenate into the assistant text.
	body := []byte(
		`{"choices":[{"delta":{"role":"assistant"}}]}` +
			`{"choices":[{"delta":{"content":"PO"}}]}` +
			`{"choices":[{"delta":{"content":"NG"}}]}` +
			`{"choices":[{"delta":{},"finish_reason":"stop"}]}`,
	)
	require.False(t, looksLikeSSE(body))
	got := extractOutputMessages(body, domain.RequestTypeChat)
	assert.JSONEq(t, `[{"role":"assistant","content":"PONG"}]`, got)
}

func TestWalkConcatenatedJSON_yieldsEachObject_andToleratesTruncatedTail(t *testing.T) {
	var seen []string
	walkConcatenatedJSON(
		[]byte(`{"a":1}{"b":2}{"c":3}{"trunc":`),
		func(obj []byte) { seen = append(seen, string(obj)) },
	)
	// The three complete objects are yielded; the truncated trailing object
	// (a body cut at the 8 MiB cap) is dropped best-effort, not panicked on.
	assert.Equal(t, []string{`{"a":1}`, `{"b":2}`, `{"c":3}`}, seen)
}

func TestWalkStreamEvents_dispatchesSSEvsBareConcat(t *testing.T) {
	// SSE-framed input routes through walkSSEData.
	var sseSeen int
	walkStreamEvents([]byte("data: {\"x\":1}\n\ndata: {\"x\":2}\n\n"),
		func(_ []byte) { sseSeen++ })
	assert.Equal(t, 2, sseSeen)

	// Bare concatenated objects route through walkConcatenatedJSON.
	var bareSeen int
	walkStreamEvents([]byte(`{"x":1}{"x":2}{"x":3}`),
		func(_ []byte) { bareSeen++ })
	assert.Equal(t, 3, bareSeen)
}
