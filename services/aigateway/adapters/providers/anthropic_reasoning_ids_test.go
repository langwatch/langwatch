package providers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The full translated round trip on the codex lane (Responses dialect): turn
// two must send reasoning back under the item id OpenAI issued it with.
//
// Spec: specs/ai-gateway/messages-translation.feature

const (
	reasoningItemID = "rs_0e10fe1109ef8c67016ad0a575499c87d1b08fdb6545251911"
	reasoningCipher = "gAAAAABq0KV1mR1ErATlkl_2uZVTgTgx1ZbHFOIg4KNIVwZ5KKkWl-xTcAiAspAdoleBL4OwFbvF=="
	// OpenAI sends a provisional encrypted_content on output_item.added that
	// differs from the completed item's; only the completed one is replayed.
	reasoningCipherAdded = "gAAAAABq0KV1provisional=="
	reasoningToolUser    = `{"role":"user","content":"What is the weather in Paris? Use the tool."}`
	reasoningTools       = `[{"name":"get_weather","description":"get weather","input_schema":{"type":"object","properties":{"city":{"type":"string"}},"required":["city"]}}]`
)

// The stream OpenAI sends for a reasoning turn that ends in a tool call: the
// reasoning item carries its encrypted content and no summary.
const reasoningToolCallScript = "event: response.created\n" +
	`data: {"type":"response.created","response":{"id":"resp_1"}}` + "\n\n" +
	"event: response.output_item.added\n" +
	`data: {"type":"response.output_item.added","output_index":0,"item":{"id":"` + reasoningItemID + `","type":"reasoning","summary":[],"content":[],"encrypted_content":"` + reasoningCipherAdded + `"}}` + "\n\n" +
	"event: response.output_item.done\n" +
	`data: {"type":"response.output_item.done","output_index":0,"item":{"id":"` + reasoningItemID + `","type":"reasoning","summary":[],"content":[],"encrypted_content":"` + reasoningCipher + `"}}` + "\n\n" +
	"event: response.output_item.added\n" +
	`data: {"type":"response.output_item.added","output_index":1,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"get_weather","arguments":""}}` + "\n\n" +
	"event: response.function_call_arguments.delta\n" +
	`data: {"type":"response.function_call_arguments.delta","output_index":1,"item_id":"fc_1","delta":"{\"city\":\"Paris\"}"}` + "\n\n" +
	"event: response.output_item.done\n" +
	`data: {"type":"response.output_item.done","output_index":1,"item":{"id":"fc_1","type":"function_call","call_id":"call_1","name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}` + "\n\n" +
	"event: response.completed\n" +
	`data: {"type":"response.completed","response":{"id":"resp_1","model":"gpt-5.6-terra","output":[` +
	`{"id":"` + reasoningItemID + `","type":"reasoning","summary":[],"content":[],"encrypted_content":"` + reasoningCipher + `"},` +
	`{"id":"fc_1","type":"function_call","call_id":"call_1","name":"get_weather","arguments":"{\"city\":\"Paris\"}"}],` +
	`"usage":{"input_tokens":50,"output_tokens":42}}}` + "\n\n"

func reasoningMessagesRequest(stream bool, messages string) *domain.Request {
	body := `{"model":"claude-sonnet-4-5","max_tokens":4000,"thinking":{"type":"adaptive"},` +
		`"tools":` + reasoningTools + `,"messages":[` + messages + `]`
	if stream {
		body += `,"stream":true`
	}
	req := codexMessagesRequest(stream)
	req.Body = []byte(body + "}")
	return req
}

// assistantBlocksFromStream rebuilds the assistant content blocks a client
// accumulates from the stream: block starts, plus the tool arguments.
func assistantBlocksFromStream(t *testing.T, events []sseEvent) []map[string]any {
	t.Helper()
	var blocks []map[string]any
	args := map[int]string{}
	for _, e := range events {
		switch e.Type {
		case "content_block_start":
			block, ok := e.Raw["content_block"].(map[string]any)
			require.True(t, ok)
			blocks = append(blocks, block)
		case "content_block_delta":
			delta, _ := e.Raw["delta"].(map[string]any)
			if s, ok := delta["partial_json"].(string); ok {
				args[len(blocks)-1] += s
			}
		}
	}
	for i, s := range args {
		blocks[i]["input"] = json.RawMessage(s)
	}
	return blocks
}

func secondTurnMessages(t *testing.T, assistant []map[string]any) string {
	t.Helper()
	asst, err := json.Marshal(map[string]any{"role": "assistant", "content": assistant})
	require.NoError(t, err)
	return reasoningToolUser + "," + string(asst) +
		`,{"role":"user","content":[{"type":"tool_result","tool_use_id":"call_1","content":"Sunny, 21C"}]}`
}

// assertReasoningReturnedUnderItsID checks the reasoning item turn two sent to
// the provider.
func assertReasoningReturnedUnderItsID(t *testing.T, outbound []byte) {
	t.Helper()
	reasoning := gjson.GetBytes(outbound, `input.#(type=="reasoning")`)
	require.True(t, reasoning.Exists(), "the reasoning item must reach the provider: %s", outbound)
	assert.Equal(t, reasoningItemID, reasoning.Get("id").String(),
		"the reasoning item must keep the id the provider issued, or OpenAI rejects its encrypted content")
	assert.Equal(t, reasoningCipher, reasoning.Get("encrypted_content").String(),
		"the completed item's encrypted content must arrive unchanged")
}

// @scenario "Reasoning from a previous turn returns to the provider under its own item id"
func TestMessagesTranslatedStream_ReasoningReturnsUnderItsItemID(t *testing.T) {
	backend, bodies := codexResponsesBackend(t, reasoningToolCallScript)
	router := codexTestRouter(backend.URL, nil)

	iter, err := router.DispatchStream(context.Background(), reasoningMessagesRequest(true, reasoningToolUser), codexCredential())
	require.NoError(t, err)
	events, streamErr := collectAnthropicStream(t, context.Background(), iter)
	require.NoError(t, streamErr)
	assertValidAnthropicSequence(t, events)

	assistant := assistantBlocksFromStream(t, events)
	require.NotEmpty(t, assistant)
	assert.Equal(t, "redacted_thinking", assistant[0]["type"], "encrypted reasoning reaches the client as redacted_thinking")

	iter2, err := router.DispatchStream(context.Background(), reasoningMessagesRequest(true, secondTurnMessages(t, assistant)), codexCredential())
	require.NoError(t, err)
	_, streamErr = collectAnthropicStream(t, context.Background(), iter2)
	require.NoError(t, streamErr)

	sent := bodies()
	require.Len(t, sent, 2)
	assertReasoningReturnedUnderItsID(t, sent[1])
}

// @scenario "Reasoning from a previous turn returns to the provider under its own item id"
// @scenario "A non-streaming reply keeps the encrypted reasoning"
func TestMessagesTranslated_NonStreamingReasoningReturnsUnderItsItemID(t *testing.T) {
	backend, bodies := codexResponsesBackend(t, reasoningToolCallScript)
	router := codexTestRouter(backend.URL, nil)

	resp, err := router.Dispatch(context.Background(), reasoningMessagesRequest(false, reasoningToolUser), codexCredential())
	require.NoError(t, err)
	require.Equal(t, 200, resp.StatusCode)

	var reply struct {
		Content []map[string]any `json:"content"`
	}
	require.NoError(t, json.Unmarshal(resp.Body, &reply))
	require.NotEmpty(t, reply.Content)
	assert.Equal(t, "redacted_thinking", reply.Content[0]["type"],
		"encrypted reasoning without a summary must still reach the client: %s", resp.Body)

	resp2, err := router.Dispatch(context.Background(), reasoningMessagesRequest(false, secondTurnMessages(t, reply.Content)), codexCredential())
	require.NoError(t, err)
	require.Equal(t, 200, resp2.StatusCode)

	sent := bodies()
	require.Len(t, sent, 2)
	assertReasoningReturnedUnderItsID(t, sent[1])
}

// @scenario "Redacted thinking the gateway did not mint passes through unchanged"
func TestBuildMessagesResponsesRequest_ForeignRedactedThinkingIsUntouched(t *testing.T) {
	const foreign = "EqQBCkgIARABGAIiQL+/ZmF0aGVyLW9mLWFsbC10aGUtdGhpbmdz=="
	body := `{"model":"claude-sonnet-4-5","max_tokens":100,"messages":[` + reasoningToolUser +
		`,{"role":"assistant","content":[{"type":"redacted_thinking","data":"` + foreign + `"},{"type":"text","text":"ok"}]}` +
		`,{"role":"user","content":"thanks"}]}`
	bfCtx := bfschemas.NewBifrostContext(context.Background(), time.Time{})

	bfReq, err := buildMessagesResponsesRequest(bfCtx, &domain.Request{Body: []byte(body)}, bfschemas.OpenAI, "gpt-5.6-terra")
	require.NoError(t, err)

	var found bool
	for _, item := range bfReq.Input {
		if item.Type == nil || *item.Type != bfschemas.ResponsesMessageTypeReasoning {
			continue
		}
		found = true
		reasoning := item.ResponsesReasoning
		require.NotNil(t, reasoning)
		require.NotNil(t, reasoning.EncryptedContent)
		assert.Equal(t, foreign, *reasoning.EncryptedContent)
	}
	assert.True(t, found, "the redacted_thinking block must still become a reasoning item")
}
