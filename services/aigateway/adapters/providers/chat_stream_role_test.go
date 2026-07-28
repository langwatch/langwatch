package providers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// These tests drive the real dispatch path: NewBifrostRouter, DispatchStream,
// and a local upstream replaying the exact SSE shape api.openai.com sends,
// opening role chunk included. Bifrost's stream handler forwards a chunk only
// when its delta carries content, reasoning, audio or tool calls, so the
// opening `"delta":{"role":"assistant","content":""}` chunk is consumed before
// it ever reaches the gateway's iterator. That consumption is the bug's
// mechanism, and running the real pipeline is what makes these tests observe
// it instead of assuming it.
//
// Spec: specs/ai-gateway/streaming.feature

// chatChunkJSON is one parsed `data:` payload from the gateway's stream.
type chatChunkJSON struct {
	raw     map[string]any
	choices []map[string]any
}

func (c chatChunkJSON) delta(i int) map[string]any {
	for _, ch := range c.choices {
		if idx, ok := ch["index"].(float64); ok && int(idx) == i {
			if d, ok := ch["delta"].(map[string]any); ok {
				return d
			}
		}
	}
	return nil
}

// collectChatStream drains the iterator and parses each emitted chunk.
func collectChatStream(t *testing.T, iter domain.StreamIterator) []chatChunkJSON {
	t.Helper()
	var chunks []chatChunkJSON
	for iter.Next(context.Background()) {
		var raw map[string]any
		require.NoError(t, json.Unmarshal(iter.Chunk(), &raw),
			"every emitted chunk must be valid JSON")
		c := chatChunkJSON{raw: raw}
		if arr, ok := raw["choices"].([]any); ok {
			for _, e := range arr {
				if m, ok := e.(map[string]any); ok {
					c.choices = append(c.choices, m)
				}
			}
		}
		chunks = append(chunks, c)
	}
	require.NoError(t, iter.Err())
	return chunks
}

// deltasForChoice returns every delta emitted for the given choice index, in
// stream order.
func deltasForChoice(chunks []chatChunkJSON, idx int) []map[string]any {
	var out []map[string]any
	for _, c := range chunks {
		if d := c.delta(idx); d != nil {
			out = append(out, d)
		}
	}
	return out
}

func openAISSEBackend(t *testing.T, script string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/v1/chat/completions", r.URL.Path)
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(script))
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}
	}))
	t.Cleanup(srv.Close)
	return srv
}

func openAIRouter(t *testing.T, backendURL string) *BifrostRouter {
	t.Helper()
	router, err := NewBifrostRouter(context.Background(), BifrostOptions{
		Logger:           zap.NewNop(),
		OpenAIBackendURL: backendURL,
	})
	require.NoError(t, err)
	t.Cleanup(router.Close)
	return router
}

func chatStreamRequest() *domain.Request {
	return &domain.Request{
		Type:  domain.RequestTypeChat,
		Model: "openai/gpt-5.6-luna",
		Body:  []byte(`{"model":"gpt-5.6-luna","messages":[{"role":"user","content":"count to 3"}],"stream":true}`),
	}
}

func openAICred() domain.Credential {
	return domain.Credential{ID: "cred-oai", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"}
}

// oaChunk renders one api.openai.com-shaped SSE chunk.
func oaChunk(choices string) string {
	return `data: {"id":"chatcmpl-role1","object":"chat.completion.chunk","created":1730000000,"model":"gpt-5.6-luna","system_fingerprint":"fp_test","choices":[` + choices + `]}` + "\n\n"
}

// openAICaptureScript is the shape api.openai.com actually streams: the
// role-carrying opening chunk, content deltas, a finish chunk, a usage-only
// chunk with empty choices, and the [DONE] sentinel.
const roleOpening = `{"index":0,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}`

func openAICaptureScript() string {
	return oaChunk(roleOpening) +
		oaChunk(`{"index":0,"delta":{"content":"1, "},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{"content":"2, 3"},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}`) +
		`data: {"id":"chatcmpl-role1","object":"chat.completion.chunk","created":1730000000,"model":"gpt-5.6-luna","system_fingerprint":"fp_test","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":5,"total_tokens":17}}` + "\n\n" +
		"data: [DONE]\n\n"
}

// The stream engine consumes OpenAI's opening role chunk, so without the
// repair the gateway's first delta is a bare content delta. The contract is
// OpenAI's: the first delta per choice carries the assistant role.
//
// @scenario "the first emitted delta of a chat completion stream carries the assistant role"
func TestChatStreamRole_OpenAI_FirstDeltaCarriesRole(t *testing.T) {
	backend := openAISSEBackend(t, openAICaptureScript())
	router := openAIRouter(t, backend.URL)

	iter, err := router.DispatchStream(context.Background(), chatStreamRequest(), openAICred())
	require.NoError(t, err)

	chunks := collectChatStream(t, iter)
	require.NotEmpty(t, chunks)

	deltas := deltasForChoice(chunks, 0)
	require.NotEmpty(t, deltas, "the stream must carry deltas for choice 0")

	role, ok := deltas[0]["role"].(string)
	require.True(t, ok,
		"the first delta must carry a role; clients key their message accumulator off it")
	assert.Equal(t, "assistant", role)
	assert.Equal(t, "1, ", deltas[0]["content"],
		"the role rides on the first real delta; no synthetic chunk is invented")

	// The repair is first-chunk-per-choice only: every later delta is
	// emitted without a role, exactly as the upstream sent it.
	for i, d := range deltas[1:] {
		_, hasRole := d["role"]
		assert.False(t, hasRole, "delta %d must not gain a role; only the first may", i+1)
	}

	// The rest of the first chunk is untouched: id, model and fingerprint
	// come through as the upstream sent them.
	first := chunks[0]
	assert.Equal(t, "chatcmpl-role1", first.raw["id"])
	assert.Equal(t, "gpt-5.6-luna", first.raw["model"])
	assert.Equal(t, "fp_test", first.raw["system_fingerprint"])

	// Content survives reassembly.
	var content strings.Builder
	for _, d := range deltas {
		if s, ok := d["content"].(string); ok {
			content.WriteString(s)
		}
	}
	assert.Equal(t, "1, 2, 3", content.String())

	// Usage still reaches billing.
	assert.Equal(t, 12, iter.Usage().PromptTokens)
	assert.Equal(t, 5, iter.Usage().CompletionTokens)
}

// A tool-call-first turn: OpenAI sends the role chunk (consumed), then
// tool_calls deltas with no content. Claude-style agent loops are all
// tool-call-first, so this is the common case, not the exotic one.
//
// @scenario "a turn that opens with a tool call still carries the role"
func TestChatStreamRole_ToolCallFirstTurn_StillGetsRole(t *testing.T) {
	script := oaChunk(roleOpening) +
		oaChunk(`{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"lookup","arguments":""}}]},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\":\"x\"}"}}]},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{},"logprobs":null,"finish_reason":"tool_calls"}`) +
		"data: [DONE]\n\n"

	backend := openAISSEBackend(t, script)
	router := openAIRouter(t, backend.URL)

	iter, err := router.DispatchStream(context.Background(), chatStreamRequest(), openAICred())
	require.NoError(t, err)

	deltas := deltasForChoice(collectChatStream(t, iter), 0)
	require.NotEmpty(t, deltas)

	assert.Equal(t, "assistant", deltas[0]["role"],
		"a tool-call-first delta must still carry the role")
	calls, ok := deltas[0]["tool_calls"].([]any)
	require.True(t, ok, "the tool call must ride the same delta the role was injected into")
	require.NotEmpty(t, calls)

	for i, d := range deltas[1:] {
		_, hasRole := d["role"]
		assert.False(t, hasRole, "delta %d must not gain a role", i+1)
	}
}

// n>1 interleaves choices, and each choice opens independently on the wire,
// so the repair must track per choice index rather than per stream.
//
// @scenario "every choice of a multi-choice stream opens with its own role delta"
func TestChatStreamRole_MultiChoice_RolePerChoiceIndex(t *testing.T) {
	script := oaChunk(roleOpening) +
		oaChunk(`{"index":1,"delta":{"role":"assistant","content":""},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{"content":"alpha"},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":1,"delta":{"content":"bravo"},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{"content":" one"},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":1,"delta":{"content":" two"},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}`) +
		oaChunk(`{"index":1,"delta":{},"logprobs":null,"finish_reason":"stop"}`) +
		"data: [DONE]\n\n"

	backend := openAISSEBackend(t, script)
	router := openAIRouter(t, backend.URL)

	iter, err := router.DispatchStream(context.Background(), chatStreamRequest(), openAICred())
	require.NoError(t, err)

	chunks := collectChatStream(t, iter)
	for _, idx := range []int{0, 1} {
		deltas := deltasForChoice(chunks, idx)
		require.NotEmpty(t, deltas, "choice %d must have deltas", idx)
		assert.Equal(t, "assistant", deltas[0]["role"],
			"choice %d must open with its own role delta", idx)
		for i, d := range deltas[1:] {
			_, hasRole := d["role"]
			assert.False(t, hasRole, "choice %d delta %d must not gain a role", idx, i+1)
		}
	}
}

// Self-hosted OpenAI-compatible servers often stamp the role on their first
// content-carrying chunk, which the stream engine forwards as-is. When the
// role is already there, the stream must pass through untouched: no second
// role, no mutation.
//
// @scenario "a provider that sends its own role delta passes through untouched"
func TestChatStreamRole_ProviderSendsOwnRole_PassesThroughUntouched(t *testing.T) {
	script := oaChunk(`{"index":0,"delta":{"role":"assistant","content":"Hello"},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{"content":" world"},"logprobs":null,"finish_reason":null}`) +
		oaChunk(`{"index":0,"delta":{},"logprobs":null,"finish_reason":"stop"}`) +
		"data: [DONE]\n\n"

	backend := openAISSEBackend(t, script)
	router := openAIRouter(t, "")

	iter, err := router.DispatchStream(context.Background(), chatStreamRequest(), customEndpointCredential(backend.URL))
	require.NoError(t, err)

	deltas := deltasForChoice(collectChatStream(t, iter), 0)
	require.NotEmpty(t, deltas)

	roleCount := 0
	for _, d := range deltas {
		if _, ok := d["role"]; ok {
			roleCount++
		}
	}
	assert.Equal(t, 1, roleCount, "exactly one role in the stream; the provider's own, never a second")
	assert.Equal(t, "assistant", deltas[0]["role"])
	assert.Equal(t, "Hello", deltas[0]["content"],
		"the provider's own first chunk must come through unmodified")
}

// Azure and self-hosted OpenAI-compatible endpoints stream through the same
// shared handler and the same gateway iterator. Confirmed here with a real
// dispatch through the openai-compat provider rather than assumed from
// reading the code.
//
// @scenario "OpenAI-compatible providers inherit the role repair"
func TestChatStreamRole_OpenAICompat_InheritsRepair(t *testing.T) {
	backend := openAISSEBackend(t, openAICaptureScript())
	router := openAIRouter(t, "")

	iter, err := router.DispatchStream(context.Background(), chatStreamRequest(), customEndpointCredential(backend.URL))
	require.NoError(t, err)

	deltas := deltasForChoice(collectChatStream(t, iter), 0)
	require.NotEmpty(t, deltas)
	assert.Equal(t, "assistant", deltas[0]["role"],
		"the openai-compat lane shares the iterator and must inherit the repair")
}

// The wrapper itself, fed the exact chunk sequence Bifrost hands the gateway:
// roleless content deltas, then a usage-only chunk with no choices. Terminal
// chunks must pass through with no choices invented, and the [DONE] sentinel
// the writer appends must stay exactly `data: [DONE]`.
//
// @scenario "terminal chunks are not reshaped by the role repair"
func TestChatStreamRole_TerminalChunks_PassThroughUntouched(t *testing.T) {
	ch := make(chan *bfschemas.BifrostStreamChunk, 3)
	content := "hi"
	ch <- &bfschemas.BifrostStreamChunk{BifrostChatResponse: &bfschemas.BifrostChatResponse{
		ID:     "chatcmpl-t",
		Object: "chat.completion.chunk",
		Model:  "gpt-5.6-luna",
		Choices: []bfschemas.BifrostResponseChoice{{
			Index: 0,
			ChatStreamResponseChoice: &bfschemas.ChatStreamResponseChoice{
				Delta: &bfschemas.ChatStreamResponseChoiceDelta{Content: &content},
			},
		}},
	}}
	// The usage-only terminal chunk as OpenAI sends it: empty choices array.
	ch <- &bfschemas.BifrostStreamChunk{BifrostChatResponse: &bfschemas.BifrostChatResponse{
		ID:      "chatcmpl-t",
		Object:  "chat.completion.chunk",
		Model:   "gpt-5.6-luna",
		Choices: []bfschemas.BifrostResponseChoice{},
		Usage:   &bfschemas.BifrostLLMUsage{PromptTokens: 3, CompletionTokens: 1, TotalTokens: 4},
	}}
	close(ch)

	iter := &bifrostStreamIterator{ch: ch}

	// The writer appends the standard `data: [DONE]` sentinel exactly when the
	// iterator does not claim raw framing; the repair must not change that.
	assert.False(t, iter.RawFraming(),
		"chat streams must stay on the writer's standard framing, [DONE] included")

	var frames []map[string]any
	for iter.Next(context.Background()) {
		var frame map[string]any
		require.NoError(t, json.Unmarshal(iter.Chunk(), &frame))
		frames = append(frames, frame)
	}
	require.NoError(t, iter.Err())
	require.Len(t, frames, 2)

	// First frame: the content delta gained the role.
	choices := frames[0]["choices"].([]any)
	delta := choices[0].(map[string]any)["delta"].(map[string]any)
	assert.Equal(t, "assistant", delta["role"])

	// Usage-only frame: choices stays an empty array, nothing invented.
	usageChoices, ok := frames[1]["choices"].([]any)
	require.True(t, ok, "the usage-only chunk must keep its choices array")
	assert.Empty(t, usageChoices, "no choice may be invented on a usage-only chunk")
	assert.NotNil(t, frames[1]["usage"], "usage must survive untouched")
	deltaRoleCount := 0
	for _, f := range frames {
		if cs, ok := f["choices"].([]any); ok {
			for _, c := range cs {
				if d, ok := c.(map[string]any)["delta"].(map[string]any); ok {
					if _, has := d["role"]; has {
						deltaRoleCount++
					}
				}
			}
		}
	}
	assert.Equal(t, 1, deltaRoleCount, "exactly one role in the whole stream")
}

// A choice whose chunk carries no delta object must not be given one: only
// the delta of the first chunk per choice may gain a field, never the chunk
// itself.
//
// @scenario "a choice with no delta is not given one"
func TestChatStreamRole_ChoiceWithoutDelta_NotGivenOne(t *testing.T) {
	ch := make(chan *bfschemas.BifrostStreamChunk, 1)
	reason := "stop"
	ch <- &bfschemas.BifrostStreamChunk{BifrostChatResponse: &bfschemas.BifrostChatResponse{
		ID:     "chatcmpl-nd",
		Object: "chat.completion.chunk",
		Choices: []bfschemas.BifrostResponseChoice{{
			Index:        0,
			FinishReason: &reason,
		}},
	}}
	close(ch)

	iter := &bifrostStreamIterator{ch: ch}
	require.True(t, iter.Next(context.Background()))

	var chunk map[string]any
	require.NoError(t, json.Unmarshal(iter.Chunk(), &chunk))
	choice := chunk["choices"].([]any)[0].(map[string]any)
	_, hasDelta := choice["delta"]
	assert.False(t, hasDelta, "a delta object must never be invented on a chunk that had none")
}

// customEndpointCredential points a credential at a local OpenAI-compatible
// upstream, the production shape for self-hosted vLLM and LiteLLM servers.
func customEndpointCredential(url string) domain.Credential {
	return domain.Credential{
		ID:         "cred-compat",
		ProviderID: domain.ProviderCustom,
		APIKey:     "sk-test",
		Extra:      map[string]string{"base_url": url},
	}
}
