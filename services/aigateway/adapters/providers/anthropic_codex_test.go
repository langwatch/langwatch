package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Claude Code on a codex-backed virtual key: /v1/messages must route through
// the translated codex lane, not the Responses-only fast path that rejects
// anything but RequestTypeResponses. These tests drive the REAL Dispatch and
// DispatchStream entry points, because the bug they pin was precisely a
// routing-order one: the codex branch returned before the messages branches
// could run.
//
// Spec: specs/ai-gateway/messages-translation.feature
// Spec: specs/model-providers/codex-account-provider.feature

// codexResponsesBackend serves a fixed Responses-API SSE script the way the
// codex backend does (SSE only), recording the request bodies it received.
func codexResponsesBackend(t *testing.T, script string) (*httptest.Server, func() [][]byte) {
	t.Helper()
	var mu sync.Mutex
	var bodies [][]byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, body)
		mu.Unlock()
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, script)
	}))
	t.Cleanup(srv.Close)
	return srv, func() [][]byte {
		mu.Lock()
		defer mu.Unlock()
		return append([][]byte(nil), bodies...)
	}
}

func codexMessagesRequest(stream bool) *domain.Request {
	streamField := ""
	if stream {
		streamField = `"stream":true,`
	}
	return &domain.Request{
		Type:  domain.RequestTypeMessages,
		Model: "claude-sonnet-4-5",
		Resolved: &domain.ResolvedModel{
			ModelID:    "openai_codex/gpt-5.6-terra",
			ProviderID: domain.ProviderOpenAICodex,
			Source:     domain.ModelSourceAlias,
		},
		Body: []byte(`{"model":"claude-sonnet-4-5",` + streamField + `"max_tokens":1024,` +
			`"system":"be brief","messages":[{"role":"user","content":"hi"}]}`),
	}
}

const codexAnswerScript = "event: response.created\n" +
	`data: {"type":"response.created","response":{"id":"resp_1"}}` + "\n\n" +
	"event: response.output_text.delta\n" +
	`data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":"Hello"}` + "\n\n" +
	"event: response.output_text.delta\n" +
	`data: {"type":"response.output_text.delta","output_index":0,"content_index":0,"delta":" there"}` + "\n\n" +
	"event: response.completed\n" +
	`data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.6-terra","output":[],` +
	`"usage":{"input_tokens":12,"output_tokens":5,"input_tokens_details":{"cached_tokens":8}}}}` + "\n\n"

// assertCodexOutboundIsResponsesShaped pins the translation half: what leaves
// for the codex backend must be its own dialect, with the backend invariants
// pinned, never the Anthropic body forwarded verbatim.
func assertCodexOutboundIsResponsesShaped(t *testing.T, outbound []byte) {
	t.Helper()
	assert.Equal(t, "gpt-5.6-terra", gjson.GetBytes(outbound, "model").String(),
		"the model must be rewritten to the bare codex name")
	assert.True(t, gjson.GetBytes(outbound, "stream").Bool(), "the backend is SSE-only; stream must be pinned on")
	assert.False(t, gjson.GetBytes(outbound, "store").Bool(), "the backend is stateless; store must be pinned off")
	assert.True(t, gjson.GetBytes(outbound, "input").Exists(),
		"the conversation must arrive as Responses input, not Anthropic messages: %s", outbound)
	assert.False(t, gjson.GetBytes(outbound, "messages").Exists(),
		"an Anthropic messages array must never be forwarded to the codex backend")
	assert.False(t, gjson.GetBytes(outbound, "max_tokens").Exists(),
		"Anthropic's max_tokens must be translated, not forwarded verbatim")
	assert.Contains(t, string(outbound), "be brief",
		"the Anthropic system prompt must survive translation")
}

// @scenario "A non-Anthropic destination is translated instead of raw-forwarded"
func TestMessagesTranslatedCodexStream_ProducesValidAnthropicUnion(t *testing.T) {
	backend, bodies := codexResponsesBackend(t, codexAnswerScript)
	router := codexTestRouter(backend.URL, nil)

	iter, err := router.DispatchStream(
		context.Background(),
		codexMessagesRequest(true),
		codexCredential(),
	)
	require.NoError(t, err,
		"a /v1/messages stream on a codex key must be translated, not rejected as a non-Responses request")

	framer, ok := iter.(domain.RawFramer)
	require.True(t, ok, "the translated iterator must advertise its own SSE framing")
	assert.True(t, framer.RawFraming())

	events, streamErr := collectAnthropicStream(t, context.Background(), iter)
	require.NoError(t, streamErr)
	assertValidAnthropicSequence(t, events)

	captured := bodies()
	require.Len(t, captured, 1)
	assertCodexOutboundIsResponsesShaped(t, captured[0])

	var text strings.Builder
	for _, e := range events {
		if e.Type != "content_block_delta" {
			continue
		}
		if delta, ok := e.Raw["delta"].(map[string]any); ok {
			if s, ok := delta["text"].(string); ok {
				text.WriteString(s)
			}
		}
	}
	assert.Equal(t, "Hello there", text.String(), "the model's answer must survive the round trip")

	usage := iter.Usage()
	assert.Equal(t, 12, usage.PromptTokens, "usage must be extracted for accounting")
	assert.Equal(t, 5, usage.CompletionTokens)
	assert.Equal(t, 8, usage.CacheReadTokens, "the cached prompt share must survive the translated lane")
}

// The non-streaming sibling aggregates the SSE-only backend into one complete
// Anthropic message envelope.
//
// @scenario "A non-Anthropic destination is translated instead of raw-forwarded"
func TestMessagesTranslatedCodex_NonStreaming_ReturnsCompleteAnthropicMessage(t *testing.T) {
	// The codex backend's response.completed carries an empty output array;
	// the aggregation stitches output items back in from output_item.done.
	script := "event: response.output_item.done\n" +
		`data: {"type":"response.output_item.done","output_index":0,"item":{"id":"msg_1","type":"message","role":"assistant",` +
		`"status":"completed","content":[{"type":"output_text","text":"the answer is 42"}]}}` + "\n\n" +
		"event: response.completed\n" +
		`data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.6-terra","output":[],` +
		`"usage":{"input_tokens":11,"output_tokens":7}}}` + "\n\n"

	backend, bodies := codexResponsesBackend(t, script)
	router := codexTestRouter(backend.URL, nil)

	resp, err := router.Dispatch(
		context.Background(),
		codexMessagesRequest(false),
		codexCredential(),
	)
	require.NoError(t, err,
		"a non-streaming /v1/messages on a codex key must be translated, not rejected")
	require.NotNil(t, resp)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	captured := bodies()
	require.Len(t, captured, 1)
	assertCodexOutboundIsResponsesShaped(t, captured[0])

	var msg map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &msg))
	assert.Equal(t, "message", msg["type"])
	assert.Equal(t, "assistant", msg["role"])
	content, ok := msg["content"].([]any)
	require.True(t, ok, "content must be a block array, got %T", msg["content"])
	require.NotEmpty(t, content)
	block, ok := content[0].(map[string]any)
	require.True(t, ok, "content[0] must be a content block object, got %T", content[0])
	assert.Equal(t, "text", block["type"])
	assert.Equal(t, "the answer is 42", block["text"])

	assert.Equal(t, 11, resp.Usage.PromptTokens, "usage must reach billing")
	assert.Equal(t, 7, resp.Usage.CompletionTokens)
}

// A plan-limit refusal must reach the Claude Code client as an Anthropic error
// envelope with the retry hint intact; the OpenAI-shaped body the codex
// backend answers with is not decodable on the /v1/messages surface.
func TestMessagesTranslatedCodex_PlanLimitBecomesAnthropicEnvelope(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "3600")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"type":"usage_limit_reached","message":"You've hit your usage limit."}}`))
	}))
	defer backend.Close()

	router := codexTestRouter(backend.URL, nil)

	for name, dispatch := range map[string]func() error{
		"stream": func() error {
			_, err := router.DispatchStream(context.Background(),
				codexMessagesRequest(true), codexCredential())
			return err
		},
		"sync": func() error {
			_, err := router.Dispatch(context.Background(),
				codexMessagesRequest(false), codexCredential())
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			err := dispatch()
			var upstream *domain.UpstreamError
			require.ErrorAs(t, err, &upstream)
			assert.Equal(t, http.StatusTooManyRequests, upstream.StatusCode)
			assert.Equal(t, "3600", upstream.Headers["Retry-After"], "the retry hint must survive re-enveloping")

			var envelope map[string]any
			require.NoError(t, json.Unmarshal(upstream.Body, &envelope))
			assert.Equal(t, "error", envelope["type"], "the body must be the Anthropic envelope, got: %s", upstream.Body)
			detail, ok := envelope["error"].(map[string]any)
			require.True(t, ok, "the error field must be an object, got %T", envelope["error"])
			assert.Equal(t, "rate_limit_error", detail["type"])
			assert.Contains(t, detail["message"], "usage limit",
				"the provider's human message must survive so the user knows what happened")
		})
	}
}
