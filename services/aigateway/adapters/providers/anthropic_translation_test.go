package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// These tests drive the REAL dispatch path: a router built by
// NewBifrostRouter, DispatchStream/Dispatch called as the HTTP layer calls
// them, and a local upstream standing in for the provider. Nothing calls the
// vendored converters or the framer directly, because the bugs this feature
// exists to fix all live in the wiring between them rather than inside any one
// of them.
//
// The upstream is an OpenAI-compatible chat-completions server reached through
// a customer-endpoint credential. That is the transport every provider without
// a native Responses API falls back to (Gemini, vLLM, self-hosted proxies), so
// it exercises the longest conversion chain in the feature: Anthropic body ->
// neutral Responses request -> chat request -> chat SSE -> Responses events ->
// Anthropic events.
//
// Spec: specs/ai-gateway/messages-translation.feature

// sseEvent is one parsed Anthropic SSE frame.
type sseEvent struct {
	Type  string
	Index *int
	Raw   map[string]any
}

// collectAnthropicStream drives the iterator to exhaustion and parses every
// frame it produced into the Anthropic event union.
func collectAnthropicStream(t *testing.T, iter domain.StreamIterator) ([]sseEvent, error) {
	t.Helper()
	var events []sseEvent
	for iter.Next(context.Background()) {
		chunk := string(iter.Chunk())
		for _, frame := range strings.Split(chunk, "\n\n") {
			frame = strings.TrimSpace(frame)
			if frame == "" {
				continue
			}
			var eventName, data string
			for _, line := range strings.Split(frame, "\n") {
				switch {
				case strings.HasPrefix(line, "event: "):
					eventName = strings.TrimPrefix(line, "event: ")
				case strings.HasPrefix(line, "data: "):
					data = strings.TrimPrefix(line, "data: ")
				}
			}
			if data == "" {
				continue
			}
			var parsed map[string]any
			require.NoError(t, json.Unmarshal([]byte(data), &parsed),
				"every data payload must be valid JSON; clients schema-validate each one")
			ev := sseEvent{Type: eventName, Raw: parsed}
			// Anthropic names the event twice, on the `event:` line and in the
			// payload's `type`. A client may read either, so they must agree.
			if payloadType, ok := parsed["type"].(string); ok {
				assert.Equal(t, payloadType, eventName,
					"the event: line and the payload type must name the same event")
			}
			if idx, ok := parsed["index"].(float64); ok {
				i := int(idx)
				ev.Index = &i
			}
			events = append(events, ev)
		}
	}
	return events, iter.Err()
}

func eventTypes(events []sseEvent) []string {
	out := make([]string, 0, len(events))
	for _, e := range events {
		out = append(out, e.Type)
	}
	return out
}

// assertValidAnthropicSequence pins the invariants Claude Code enforces on the
// event union. This is the shared teeth of the whole feature: any framing
// regression trips one of these.
func assertValidAnthropicSequence(t *testing.T, events []sseEvent) {
	t.Helper()
	require.NotEmpty(t, events, "a translated stream must produce events, never zero bytes")

	types := eventTypes(events)
	assert.Equal(t, "message_start", types[0],
		"the union opens with message_start; anything else and the client cannot build the message")
	assert.Equal(t, "message_stop", types[len(types)-1],
		"a stream that never says message_stop is indistinguishable from the hang this replaces")

	var starts, stops, deltas int
	for _, ty := range types {
		switch ty {
		case "message_start":
			starts++
		case "message_stop":
			stops++
		case "message_delta":
			deltas++
		}
	}
	assert.Equal(t, 1, starts, "exactly one message_start")
	assert.Equal(t, 1, stops, "exactly one message_stop")
	assert.Equal(t, 1, deltas, "exactly one message_delta, carrying the stop reason")

	// message_delta must be the last event before message_stop.
	assert.Equal(t, "message_delta", types[len(types)-2],
		"message_delta must immediately precede message_stop")

	// Every block delta sits inside a matching start/stop for its own index.
	open := map[int]bool{}
	seen := map[int]bool{}
	maxIndex := -1
	for _, e := range events {
		switch e.Type {
		case "content_block_start":
			require.NotNil(t, e.Index, "content_block_start must carry an index")
			assert.False(t, open[*e.Index], "block %d started twice without a stop", *e.Index)
			open[*e.Index] = true
			seen[*e.Index] = true
			if *e.Index > maxIndex {
				maxIndex = *e.Index
			}
		case "content_block_delta":
			require.NotNil(t, e.Index, "content_block_delta must carry an index")
			assert.True(t, open[*e.Index],
				"delta for block %d arrived outside a start/stop pair", *e.Index)
		case "content_block_stop":
			require.NotNil(t, e.Index, "content_block_stop must carry an index")
			assert.True(t, open[*e.Index], "block %d stopped without being started", *e.Index)
			open[*e.Index] = false
		}
	}
	for idx, stillOpen := range open {
		assert.False(t, stillOpen, "block %d was left open when the message ended", idx)
	}

	// Anthropic requires contiguous indices from zero.
	for i := 0; i <= maxIndex; i++ {
		assert.True(t, seen[i],
			"content block indices must be contiguous from 0; index %d is missing (saw up to %d)", i, maxIndex)
	}
}

// chatSSEBackend serves a fixed OpenAI chat-completions SSE script and records
// the request bodies it received.
func chatSSEBackend(t *testing.T, script string) (*httptest.Server, *[]string) {
	t.Helper()
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		bodies = append(bodies, string(body))
		assert.Equal(t, "/v1/chat/completions", r.URL.Path,
			"a translated /v1/messages request must reach the provider on its own route, never /v1/messages")
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(script))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}))
	t.Cleanup(srv.Close)
	return srv, &bodies
}

func newTestRouter(t *testing.T) *BifrostRouter {
	t.Helper()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{Logger: zap.NewNop()})
	require.NoError(t, err)
	t.Cleanup(router.Close)
	return router
}

// customEndpointCred points a credential at the local upstream, which is how a
// self-hosted OpenAI-compatible provider is configured in production.
func customEndpointCred(url string) domain.Credential {
	return domain.Credential{
		ID:         "cred-translated",
		ProviderID: domain.ProviderCustom,
		APIKey:     "sk-test",
		Extra:      map[string]string{"base_url": url},
	}
}

func messagesRequest(body string) *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeMessages,
		Model: "claude-sonnet-4-5",
		Body:  []byte(body),
	}
}

const simpleMessagesBody = `{"model":"claude-sonnet-4-5","max_tokens":1024,"system":"be brief","messages":[{"role":"user","content":"hi"}],"stream":true}`

func chatChunk(parts string) string {
	return fmt.Sprintf("data: {\"id\":\"chatcmpl-1\",\"object\":\"chat.completion.chunk\",\"created\":1,\"model\":\"local-model\",%s}\n\n", parts)
}

// A plain text answer must produce the canonical Anthropic envelope. This is
// the baseline every other streaming scenario builds on.
//
// @scenario "A translated stream opens with message_start and closes with message_stop"
// @scenario "Every content block delta arrives inside a matching start and stop pair"
// @scenario "A non-Anthropic destination is translated instead of raw-forwarded"
func TestMessagesTranslatedStream_TextAnswer_ProducesValidAnthropicUnion(t *testing.T) {
	script := chatChunk(`"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":3,"total_tokens":14}`) +
		"data: [DONE]\n\n"

	backend, bodies := chatSSEBackend(t, script)
	router := newTestRouter(t)

	iter, err := router.DispatchStream(context.Background(), messagesRequest(simpleMessagesBody), customEndpointCred(backend.URL))
	require.NoError(t, err)

	events, streamErr := collectAnthropicStream(t, iter)
	require.NoError(t, streamErr)
	assertValidAnthropicSequence(t, events)

	// The provider must have received ITS OWN wire shape, not the Anthropic one.
	require.Len(t, *bodies, 1)
	outbound := (*bodies)[0]
	assert.Contains(t, outbound, `"messages"`, "the chat-completions body carries messages")
	assert.NotContains(t, outbound, `"max_tokens":1024`,
		"Anthropic's mandatory max_tokens must not be forwarded verbatim; OpenAI rejects it as unsupported")
	assert.Contains(t, outbound, "be brief",
		"the Anthropic system prompt must survive translation into the provider's own system role")

	// The text itself must arrive.
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

	assert.Equal(t, 11, iter.Usage().PromptTokens, "usage must be extracted on the translated lane")
	assert.Equal(t, 3, iter.Usage().CompletionTokens)
}

// Claude Code's entire loop is tool_use out, tool_result back in. The call has
// to arrive as a well-formed tool_use block with its id, name and arguments.
//
// @scenario "A tool call streams as a tool_use block with its arguments"
// @scenario "Content block indices are contiguous from zero"
func TestMessagesTranslatedStream_ToolCall_RoundTripsAsToolUseBlock(t *testing.T) {
	script := chatChunk(`"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"content":"Reading"},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"Read","arguments":""}}]},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"path\":"}}]},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"/tmp/a\"}"}}]},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":9,"total_tokens":29}`) +
		"data: [DONE]\n\n"

	backend, _ := chatSSEBackend(t, script)
	router := newTestRouter(t)

	iter, err := router.DispatchStream(context.Background(), messagesRequest(simpleMessagesBody), customEndpointCred(backend.URL))
	require.NoError(t, err)

	events, streamErr := collectAnthropicStream(t, iter)
	require.NoError(t, streamErr)
	assertValidAnthropicSequence(t, events)

	// Find the tool_use block and reassemble its arguments from the deltas.
	toolIndex := -1
	var toolID, toolName string
	for _, e := range events {
		if e.Type != "content_block_start" {
			continue
		}
		block, ok := e.Raw["content_block"].(map[string]any)
		if !ok || block["type"] != "tool_use" {
			continue
		}
		require.NotNil(t, e.Index)
		toolIndex = *e.Index
		toolID, _ = block["id"].(string)
		toolName, _ = block["name"].(string)
	}
	require.NotEqual(t, -1, toolIndex, "a tool call must open a tool_use content block")
	assert.Equal(t, "call_abc", toolID, "the provider's call id must ride through untouched")
	assert.Equal(t, "Read", toolName, "the tool name must survive; the client dispatches on it")

	var args strings.Builder
	for _, e := range events {
		if e.Type != "content_block_delta" || e.Index == nil || *e.Index != toolIndex {
			continue
		}
		delta, ok := e.Raw["delta"].(map[string]any)
		require.True(t, ok)
		assert.Equal(t, "input_json_delta", delta["type"],
			"tool arguments must stream as input_json_delta, the only shape the client parses for tool input")
		if s, ok := delta["partial_json"].(string); ok {
			args.WriteString(s)
		}
	}
	assert.JSONEq(t, `{"path":"/tmp/a"}`, args.String(),
		"the concatenated input_json_delta payloads must reconstitute the tool arguments exactly")

	// stop_reason must tell the client a tool call is pending, or it will end
	// the turn instead of running the tool.
	stopReason := terminalStopReason(t, events)
	assert.Equal(t, "tool_use", stopReason,
		"a turn that ends in a tool call must report stop_reason tool_use")
}

// Parallel tool calls are routine for Claude Code; collapsing them into one
// block would lose calls silently.
//
// @scenario "Parallel tool calls each get their own block"
func TestMessagesTranslatedStream_ParallelToolCalls_EachGetOwnBlock(t *testing.T) {
	script := chatChunk(`"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"Read","arguments":"{\"p\":1}"}}]},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"tool_calls":[{"index":1,"id":"call_2","type":"function","function":{"name":"Bash","arguments":"{\"c\":\"ls\"}"}}]},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":30,"completion_tokens":12,"total_tokens":42}`) +
		"data: [DONE]\n\n"

	backend, _ := chatSSEBackend(t, script)
	router := newTestRouter(t)

	iter, err := router.DispatchStream(context.Background(), messagesRequest(simpleMessagesBody), customEndpointCred(backend.URL))
	require.NoError(t, err)

	events, streamErr := collectAnthropicStream(t, iter)
	require.NoError(t, streamErr)
	assertValidAnthropicSequence(t, events)

	byIndex := map[int]string{}
	for _, e := range events {
		if e.Type != "content_block_start" {
			continue
		}
		block, ok := e.Raw["content_block"].(map[string]any)
		if !ok || block["type"] != "tool_use" {
			continue
		}
		require.NotNil(t, e.Index)
		name, _ := block["name"].(string)
		byIndex[*e.Index] = name
	}
	require.Len(t, byIndex, 2, "two parallel calls must occupy two distinct content blocks")

	names := make([]string, 0, 2)
	for _, n := range byIndex {
		names = append(names, n)
	}
	assert.ElementsMatch(t, []string{"Read", "Bash"}, names,
		"both tool calls must survive with their own names")
}

// A max_tokens truncation is where the vendored converter goes silent: the
// Responses lane emits response.incomplete, which has no case in its switch,
// so without the framer the client gets no terminal event at all. That is the
// same hang the feature exists to remove, arriving by a different road.
//
// @scenario "A truncated answer still closes the message"
func TestMessagesTranslatedStream_TruncatedAnswer_StillClosesTheMessage(t *testing.T) {
	script := chatChunk(`"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{"content":"a long answer that runs out"},"finish_reason":null}]`) +
		chatChunk(`"choices":[{"index":0,"delta":{},"finish_reason":"length"}],"usage":{"prompt_tokens":8,"completion_tokens":1024,"total_tokens":1032}`) +
		"data: [DONE]\n\n"

	backend, _ := chatSSEBackend(t, script)
	router := newTestRouter(t)

	iter, err := router.DispatchStream(context.Background(), messagesRequest(simpleMessagesBody), customEndpointCred(backend.URL))
	require.NoError(t, err)

	events, streamErr := collectAnthropicStream(t, iter)
	require.NoError(t, streamErr)
	assertValidAnthropicSequence(t, events)

	assert.Equal(t, "max_tokens", terminalStopReason(t, events),
		"a token-limit truncation must be reported as max_tokens so the client can continue the turn")
}

// The exact failure the issue reports: an upstream that produces nothing and
// then goes away. The client must not be left holding an open connection.
//
// @scenario "A provider that stops sending without a terminal event does not hang the client"
func TestMessagesTranslatedStream_UpstreamClosesEarly_ClientStillGetsTerminalFrames(t *testing.T) {
	// A block opens, then the provider drops the connection: no finish_reason,
	// no [DONE], no error, just a socket that goes away. Hijacking is what
	// makes this a real disconnect; letting an httptest handler return would
	// leave the connection alive in the pool and merely idle, which is a
	// different case governed by the provider idle timeout.
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hj, ok := w.(http.Hijacker)
		if !ok {
			assert.Fail(t, "test server must support hijacking to simulate a dropped upstream")
			return
		}
		conn, buf, err := hj.Hijack()
		if !assert.NoError(t, err) {
			return
		}
		_, _ = buf.WriteString("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n")
		_, _ = buf.WriteString(chatChunk(`"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]`))
		_, _ = buf.WriteString(chatChunk(`"choices":[{"index":0,"delta":{"content":"half an ans"},"finish_reason":null}]`))
		_ = buf.Flush()
		_ = conn.Close()
	}))
	defer backend.Close()

	router := newTestRouter(t)

	iter, err := router.DispatchStream(context.Background(), messagesRequest(simpleMessagesBody), customEndpointCred(backend.URL))
	require.NoError(t, err)

	done := make(chan struct{})
	var events []sseEvent
	go func() {
		defer close(done)
		events, _ = collectAnthropicStream(t, iter)
	}()
	select {
	case <-done:
	case <-time.After(30 * time.Second):
		t.Fatal("the stream never terminated; a dropped upstream must not leave the client waiting")
	}

	require.NotEmpty(t, events, "an upstream that vanishes must not produce zero bytes")

	types := eventTypes(events)
	assert.Contains(t, types, "message_delta",
		"the gateway must close the message itself when the upstream does not")
	assert.Equal(t, "message_stop", types[len(types)-1],
		"message_stop is what releases the client; without it the request hangs")

	// No block may be left dangling.
	open := map[int]bool{}
	for _, e := range events {
		switch e.Type {
		case "content_block_start":
			open[*e.Index] = true
		case "content_block_stop":
			open[*e.Index] = false
		}
	}
	for idx, stillOpen := range open {
		assert.False(t, stillOpen, "block %d must be closed before message_stop", idx)
	}
}

// A provider that rejects the request must produce an actionable, correctly
// shaped error rather than a stall.
//
// @scenario "A request that cannot be served fails with an Anthropic-shaped error"
func TestMessagesTranslatedStream_ProviderRejects_SurfacesAnthropicError(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"rate limit reached","type":"rate_limit"}}`))
	}))
	defer backend.Close()

	router := newTestRouter(t)

	iter, err := router.DispatchStream(context.Background(), messagesRequest(simpleMessagesBody), customEndpointCred(backend.URL))

	// The failure may surface at dispatch or as a terminal stream error;
	// either is acceptable, silence is not.
	var failure error
	if err != nil {
		failure = err
	} else {
		_, failure = collectAnthropicStream(t, iter)
	}
	require.Error(t, failure, "a rejected request must produce an error, never an empty successful stream")

	var ue *domain.UpstreamError
	require.ErrorAs(t, failure, &ue, "the failure must be a structured upstream error")
	require.NotEmpty(t, ue.Body, "an Anthropic client needs an error envelope it can decode")

	var envelope map[string]any
	require.NoError(t, json.Unmarshal(ue.Body, &envelope))
	assert.Equal(t, "error", envelope["type"], "the envelope names itself an error")
	detail, ok := envelope["error"].(map[string]any)
	require.True(t, ok, "the envelope must nest the detail under `error`")
	assert.Equal(t, "rate_limit_error", detail["type"],
		"a 429 must be named rate_limit_error, the term the Anthropic client retries on")
	assert.NotEmpty(t, detail["message"], "the error must say something actionable")
}

// The non-streaming lane has to assemble a whole Anthropic message envelope.
//
// @scenario "A non-streaming translated response is a complete Anthropic message"
func TestMessagesTranslated_NonStreaming_ReturnsCompleteAnthropicMessage(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/chat/completions", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"chatcmpl-9","object":"chat.completion","created":1,"model":"local-model",` +
			`"choices":[{"index":0,"message":{"role":"assistant","content":"the answer"},"finish_reason":"stop"}],` +
			`"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}`))
	}))
	defer backend.Close()

	router := newTestRouter(t)

	req := messagesRequest(`{"model":"claude-sonnet-4-5","max_tokens":512,"messages":[{"role":"user","content":"hi"}]}`)
	resp, err := router.Dispatch(context.Background(), req, customEndpointCred(backend.URL))
	require.NoError(t, err)
	require.Equal(t, http.StatusOK, resp.StatusCode)

	var msg map[string]any
	require.NoError(t, json.Unmarshal(resp.Body, &msg),
		"the non-streaming body must be decodable Anthropic JSON")

	assert.Equal(t, "message", msg["type"], "an Anthropic message names its type")
	assert.Equal(t, "assistant", msg["role"], "the reply is from the assistant")
	assert.NotEmpty(t, msg["id"], "clients require a message id")
	assert.NotEmpty(t, msg["model"], "clients echo the model back to the user")
	assert.Equal(t, "end_turn", msg["stop_reason"])

	content, ok := msg["content"].([]any)
	require.True(t, ok, "content must be a block array, not a bare string")
	require.Len(t, content, 1)
	block, ok := content[0].(map[string]any)
	require.True(t, ok)
	assert.Equal(t, "text", block["type"])
	assert.Equal(t, "the answer", block["text"])

	usage, ok := msg["usage"].(map[string]any)
	require.True(t, ok, "usage must be reported in Anthropic's own shape")
	assert.EqualValues(t, 7, usage["input_tokens"])
	assert.EqualValues(t, 2, usage["output_tokens"])

	assert.Equal(t, 7, resp.Usage.PromptTokens, "usage must also reach the gateway's billing pipeline")
}

// The other half of the tool loop: a tool_result the client sends back must
// reach the provider attached to the call it answers.
//
// @scenario "Tool results sent back by the client reach the provider"
func TestMessagesTranslated_ToolResultFromClient_ReachesProvider(t *testing.T) {
	var outbound string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		outbound = string(body)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"c1","object":"chat.completion","created":1,"model":"local-model",` +
			`"choices":[{"index":0,"message":{"role":"assistant","content":"done"},"finish_reason":"stop"}],` +
			`"usage":{"prompt_tokens":5,"completion_tokens":1,"total_tokens":6}}`))
	}))
	defer backend.Close()

	router := newTestRouter(t)

	// A realistic second turn: the assistant asked for a tool, the client ran
	// it and is sending the result back.
	body := `{"model":"claude-sonnet-4-5","max_tokens":512,"messages":[
		{"role":"user","content":"read the file"},
		{"role":"assistant","content":[{"type":"tool_use","id":"toolu_42","name":"Read","input":{"path":"/tmp/a"}}]},
		{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_42","content":"file contents here"}]}
	]}`

	_, err := router.Dispatch(context.Background(), messagesRequest(body), customEndpointCred(backend.URL))
	require.NoError(t, err)

	require.NotEmpty(t, outbound, "the provider must have been called")
	assert.Contains(t, outbound, "toolu_42",
		"the tool call id must be preserved so the provider can pair the result with its call")
	assert.Contains(t, outbound, "file contents here",
		"the tool result payload must reach the provider, or the conversation restarts")
	assert.Contains(t, outbound, "Read",
		"the original tool call must remain in the transcript")
}

// Routing is decided by the resolved provider family, and the raw-forward lane
// must stay reachable exactly as before for Anthropic-wire destinations.
//
// @scenario "An Anthropic destination keeps the untouched raw-forward path"
// @scenario "Providers that host Anthropic models but expose a different API are translated"
func TestMessagesFamilyRouting_OnlyAnthropicWireStaysRaw(t *testing.T) {
	assert.True(t, isAnthropicWireProvider(bfschemas.Anthropic),
		"Anthropic speaks the Messages wire format natively and must keep byte-for-byte forwarding")

	// Everything else is translated. Bedrock and Vertex host Anthropic models
	// but expose Converse / their own API, and their Anthropic-native
	// passthrough is what returns unsupported-operation and hangs today.
	for _, provider := range []bfschemas.ModelProvider{
		bfschemas.OpenAI,
		bfschemas.Gemini,
		bfschemas.Bedrock,
		bfschemas.Vertex,
		bfschemas.Azure,
		bfschemas.VLLM,
	} {
		assert.False(t, isAnthropicWireProvider(provider),
			"%s does not expose an Anthropic-shaped HTTP surface and must be translated", provider)
	}

	// The raw lane itself is untouched: a messages request bound for Anthropic
	// still carries the caller's bytes verbatim with no parse in between.
	req := messagesRequest(simpleMessagesBody)
	bfReq, _, err := buildChatRequest(context.Background(), req, bfschemas.Anthropic, "claude-sonnet-4-5")
	require.NoError(t, err)
	assert.Equal(t, req.Body, []byte(bfReq.RawRequestBody),
		"the Anthropic lane must forward the inbound body byte-for-byte; prompt caching depends on it")
	assert.Empty(t, bfReq.Input, "the raw lane must not parse the body into structured input")
}

// Error naming is part of the contract: the client switches on these strings.
//
// @scenario "Error types are named in the client's own vocabulary"
func TestAnthropicErrorType_UsesAnthropicVocabulary(t *testing.T) {
	cases := map[int]string{
		http.StatusBadRequest:            "invalid_request_error",
		http.StatusUnauthorized:          "authentication_error",
		http.StatusForbidden:             "permission_error",
		http.StatusNotFound:              "not_found_error",
		http.StatusRequestEntityTooLarge: "request_too_large",
		http.StatusTooManyRequests:       "rate_limit_error",
		http.StatusServiceUnavailable:    "overloaded_error",
		http.StatusInternalServerError:   "api_error",
		http.StatusBadGateway:            "api_error",
	}
	for status, want := range cases {
		assert.Equal(t, want, anthropicErrorType(status),
			"status %d must be named %q, the term the Anthropic client recognises", status, want)
	}
}

// Stop reasons are how the client decides whether to run a tool, continue a
// truncated turn, or finish.
//
// @scenario "The stop reason survives translation"
func TestMessagesTranslatedStream_StopReasonMapping(t *testing.T) {
	cases := []struct {
		finishReason string
		want         string
	}{
		{"stop", "end_turn"},
		{"tool_calls", "tool_use"},
		{"length", "max_tokens"},
	}

	for _, tc := range cases {
		t.Run("when the provider finishes with "+tc.finishReason, func(t *testing.T) {
			script := chatChunk(`"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]`) +
				chatChunk(`"choices":[{"index":0,"delta":{"content":"x"},"finish_reason":null}]`)
			if tc.finishReason == "tool_calls" {
				script += chatChunk(`"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"T","arguments":"{}"}}]},"finish_reason":null}]`)
			}
			script += chatChunk(`"choices":[{"index":0,"delta":{},"finish_reason":"`+tc.finishReason+`"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}`) +
				"data: [DONE]\n\n"

			backend, _ := chatSSEBackend(t, script)
			router := newTestRouter(t)

			iter, err := router.DispatchStream(context.Background(), messagesRequest(simpleMessagesBody), customEndpointCred(backend.URL))
			require.NoError(t, err)

			events, streamErr := collectAnthropicStream(t, iter)
			require.NoError(t, streamErr)
			assertValidAnthropicSequence(t, events)

			assert.Equal(t, tc.want, terminalStopReason(t, events),
				"%s must translate to %s", tc.finishReason, tc.want)
		})
	}
}

// terminalStopReason pulls the stop_reason off the single message_delta.
func terminalStopReason(t *testing.T, events []sseEvent) string {
	t.Helper()
	for _, e := range events {
		if e.Type != "message_delta" {
			continue
		}
		delta, ok := e.Raw["delta"].(map[string]any)
		require.True(t, ok, "message_delta must carry a delta object")
		reason, _ := delta["stop_reason"].(string)
		return reason
	}
	t.Fatal("no message_delta found; the client never learns why the turn ended")
	return ""
}
