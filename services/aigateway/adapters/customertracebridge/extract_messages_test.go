package customertracebridge

// Tests for extractInputMessages + extractOutputMessages across:
//   - sync JSON bodies (existing baseline)
//   - SSE-streamed bodies (the gateway accumulates every chunk into a
//     single buffer at stream close; these tests assert the SSE walker
//     reassembles the assistant text for every provider shape)
//   - the OpenAI Responses API request/response shape (codex), which
//     previously had NO extractor case and rendered empty input + output
//     on every codex Path A trace.

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestExtractInputMessages_RequestTypeResponses_stringInput(t *testing.T) {
	body := []byte(`{"input":"hello world","model":"gpt-5.5"}`)
	got := extractInputMessages(body, domain.RequestTypeResponses)
	assert.JSONEq(t, `[{"role":"user","content":"hello world"}]`, got)
}

func TestExtractInputMessages_RequestTypeResponses_arrayInput(t *testing.T) {
	body := []byte(`{
		"input":[
			{"role":"system","content":[{"type":"input_text","text":"You are codex."}]},
			{"role":"user","content":[{"type":"input_text","text":"Refactor my auth middleware."}]}
		],
		"model":"gpt-5.5"
	}`)
	got := extractInputMessages(body, domain.RequestTypeResponses)
	require.NotEmpty(t, got, "responses array input must flatten to messages")
	assert.Contains(t, got, `"role":"system"`)
	assert.Contains(t, got, `"role":"user"`)
	assert.Contains(t, got, `Refactor my auth middleware.`)
}

func TestExtractInputMessages_RequestTypeResponses_missing(t *testing.T) {
	body := []byte(`{"model":"gpt-5.5"}`)
	assert.Empty(t, extractInputMessages(body, domain.RequestTypeResponses))
}

func TestExtractOutputMessages_RequestTypeResponses_syncJSON(t *testing.T) {
	body := []byte(`{
		"output":[
			{"type":"message","role":"assistant","content":[{"type":"output_text","text":"PONG"}]}
		],
		"model":"gpt-5.5"
	}`)
	got := extractOutputMessages(body, domain.RequestTypeResponses)
	assert.JSONEq(t, `[{"role":"assistant","content":"PONG"}]`, got)
}

func TestExtractOutputMessages_RequestTypeResponses_streamingSSE_completed(t *testing.T) {
	body := []byte(strings.Join([]string{
		`event: response.created`,
		`data: {"type":"response.created","response":{"id":"resp_1"}}`,
		``,
		`event: response.output_text.delta`,
		`data: {"type":"response.output_text.delta","delta":"PO"}`,
		``,
		`event: response.output_text.delta`,
		`data: {"type":"response.output_text.delta","delta":"NG"}`,
		``,
		`event: response.completed`,
		`data: {"type":"response.completed","response":{"output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"PONG"}]}]}}`,
		``,
	}, "\n"))
	got := extractOutputMessages(body, domain.RequestTypeResponses)
	// Prefer the completed snapshot's final shape — must match the sync case verbatim.
	assert.JSONEq(t, `[{"role":"assistant","content":"PONG"}]`, got)
}

func TestExtractOutputMessages_RequestTypeResponses_streamingSSE_deltasOnly(t *testing.T) {
	// No response.completed (e.g. stream cut off / aborted). The delta
	// accumulator path takes over.
	body := []byte(strings.Join([]string{
		`event: response.output_text.delta`,
		`data: {"type":"response.output_text.delta","delta":"PO"}`,
		``,
		`event: response.output_text.delta`,
		`data: {"type":"response.output_text.delta","delta":"NG"}`,
		``,
	}, "\n"))
	got := extractOutputMessages(body, domain.RequestTypeResponses)
	assert.JSONEq(t, `[{"role":"assistant","content":"PONG"}]`, got)
}

func TestExtractOutputMessages_RequestTypeMessages_streamingSSE(t *testing.T) {
	// Anthropic streaming wire: content_block_delta carries text_delta
	// fragments. The walker concatenates them and re-wraps as a single
	// assistant message with one text content block (mirrors what the
	// non-streaming sync /v1/messages response shape would look like).
	body := []byte(strings.Join([]string{
		`event: message_start`,
		`data: {"type":"message_start","message":{"id":"msg_1","role":"assistant"}}`,
		``,
		`event: content_block_start`,
		`data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		``,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"PO"}}`,
		``,
		`event: content_block_delta`,
		`data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"NG"}}`,
		``,
		`event: message_stop`,
		`data: {"type":"message_stop"}`,
		``,
	}, "\n"))
	got := extractOutputMessages(body, domain.RequestTypeMessages)
	assert.JSONEq(t, `[{"role":"assistant","content":[{"type":"text","text":"PONG"}]}]`, got)
}

func TestExtractOutputMessages_RequestTypeChat_streamingSSE(t *testing.T) {
	// OpenAI chat-completion stream: choices[].delta.content fragments.
	body := []byte(strings.Join([]string{
		`data: {"choices":[{"delta":{"role":"assistant","content":""}}]}`,
		``,
		`data: {"choices":[{"delta":{"content":"PO"}}]}`,
		``,
		`data: {"choices":[{"delta":{"content":"NG"}}]}`,
		``,
		`data: [DONE]`,
		``,
	}, "\n"))
	got := extractOutputMessages(body, domain.RequestTypeChat)
	assert.JSONEq(t, `[{"role":"assistant","content":"PONG"}]`, got)
}

func TestExtractOutputMessages_RequestTypePassthrough_geminiStreamingSSE(t *testing.T) {
	// Gemini streamGenerateContent emits a sequence of data events; each
	// chunk's candidates[0].content.parts[*].text is a fresh delta. The
	// walker concatenates them in order.
	body := []byte(strings.Join([]string{
		`data: {"candidates":[{"content":{"parts":[{"text":"PO"}],"role":"model"}}]}`,
		``,
		`data: {"candidates":[{"content":{"parts":[{"text":"NG"}],"role":"model"}}]}`,
		``,
	}, "\n"))
	got := extractOutputMessages(body, domain.RequestTypePassthrough)
	assert.JSONEq(t, `[{"role":"assistant","content":"PONG"}]`, got)
}

func TestExtractOutputMessages_emptyBody_returnsEmpty(t *testing.T) {
	for _, rt := range []domain.RequestType{
		domain.RequestTypeChat,
		domain.RequestTypeMessages,
		domain.RequestTypeResponses,
		domain.RequestTypePassthrough,
	} {
		assert.Empty(t, extractOutputMessages(nil, rt), "rt=%s", rt)
		assert.Empty(t, extractOutputMessages([]byte{}, rt), "rt=%s", rt)
	}
}

func TestExtractOutputMessages_RequestTypeMessages_syncJSON_unchanged(t *testing.T) {
	// Regression: the pre-existing sync /v1/messages shape MUST keep
	// returning the same wrapped form so traces emitted before the SSE
	// walker don't reshape under the swap.
	body := []byte(`{"content":[{"type":"text","text":"hello"}],"role":"assistant"}`)
	got := extractOutputMessages(body, domain.RequestTypeMessages)
	assert.JSONEq(t, `[{"role":"assistant","content":[{"type":"text","text":"hello"}]}]`, got)
}

func TestExtractOutputMessages_RequestTypeChat_syncJSON_unchanged(t *testing.T) {
	body := []byte(`{"choices":[{"message":{"role":"assistant","content":"hello"}}]}`)
	got := extractOutputMessages(body, domain.RequestTypeChat)
	assert.JSONEq(t, `[{"role":"assistant","content":"hello"}]`, got)
}

func TestExtractOutputMessages_RequestTypePassthrough_syncJSON_unchanged(t *testing.T) {
	body := []byte(`{"candidates":[{"content":{"parts":[{"text":"hello"}]}}]}`)
	got := extractOutputMessages(body, domain.RequestTypePassthrough)
	assert.JSONEq(t, `[{"role":"assistant","content":"hello"}]`, got)
}

func TestWalkSSEData_skipsDoneAndComments(t *testing.T) {
	body := []byte(strings.Join([]string{
		`: this is a comment`,
		`event: foo`,
		`data: {"a":1}`,
		``,
		`data: [DONE]`,
		``,
		`data: {"a":2}`,
		``,
	}, "\n"))
	var seen []string
	walkSSEData(body, func(data []byte) {
		seen = append(seen, string(data))
	})
	assert.Equal(t, []string{`{"a":1}`, `{"a":2}`}, seen)
}
