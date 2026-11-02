package providers

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	bfbedrock "github.com/maximhq/bifrost/core/providers/bedrock"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const bedrockSonnet = "eu.anthropic.claude-sonnet-4-5-20250929-v1:0"

// claudeCodeBody follows a request recorded from Claude Code 2.1: environment
// and deferred-tool notes as role:"system" messages between turns, string form
// once they are history, and a trailing token reminder holding the breakpoint.
const claudeCodeBody = `{
  "model": "claude-sonnet-5-5", "max_tokens": 1024, "stream": true,
  "system": [
    {"type": "text", "text": "You are Claude Code.", "cache_control": {"type": "ephemeral"}}
  ],
  "messages": [
    {"role": "user", "content": [{"type": "text", "text": "run echo hi"}]},
    {"role": "system", "content": "# Environment\nWorking directory: /work"},
    {"role": "assistant", "content": [
      {"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "echo hi"}}
    ]},
    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_1", "content": "hi"}]},
    {"role": "system", "content": "<total_tokens>9000 tokens left</total_tokens>"},
    {"role": "assistant", "content": [{"type": "text", "text": "It said hi."}]},
    {"role": "user", "content": [{"type": "text", "text": "thanks"}]},
    {"role": "system", "content": [{
      "type": "text", "text": "<total_tokens>8000 tokens left</total_tokens>",
      "cache_control": {"type": "ephemeral"}
    }]}
  ]
}`

type converseBlock struct {
	Text       *string         `json:"text"`
	ToolUse    json.RawMessage `json:"toolUse"`
	ToolResult json.RawMessage `json:"toolResult"`
	CachePoint json.RawMessage `json:"cachePoint"`
}

type converseWire struct {
	System   []converseBlock `json:"system"`
	Messages []struct {
		Role    string          `json:"role"`
		Content []converseBlock `json:"content"`
	} `json:"messages"`
}

// converseFor runs an Anthropic body through the same translation the Bifrost
// Bedrock lane sends upstream and decodes the resulting Converse JSON.
func converseFor(t *testing.T, body string) converseWire {
	t.Helper()
	bfCtx := bfschemas.NewBifrostContext(t.Context(), time.Time{})
	bfReq, err := buildMessagesResponsesRequest(bfCtx, messagesRequest(body), bfschemas.Bedrock, bedrockSonnet)
	require.NoError(t, err)
	converse, err := bfbedrock.ToBedrockResponsesRequest(bfCtx, bfReq)
	require.NoError(t, err)
	raw, err := json.Marshal(converse)
	require.NoError(t, err)
	var wire converseWire
	require.NoError(t, json.Unmarshal(raw, &wire))
	return wire
}

func (b converseBlock) kind() string {
	switch {
	case b.Text != nil:
		return "text:" + *b.Text
	case b.ToolUse != nil:
		return "tool_use"
	case b.ToolResult != nil:
		return "tool_result"
	case b.CachePoint != nil:
		return "cache_point"
	}
	return "unknown"
}

func assertBlocks(t *testing.T, got []converseBlock, want ...string) {
	t.Helper()
	kinds := make([]string, len(got))
	for i, block := range got {
		kinds[i] = block.kind()
	}
	assert.Equal(t, want, kinds)
}

func reminder(text string) string {
	return "text:<system-reminder>\n" + text + "\n</system-reminder>\n"
}

func assertClaudeCodeConverse(t *testing.T, wire converseWire) {
	t.Helper()
	assertBlocks(t, wire.System, "text:You are Claude Code.", "cache_point")
	require.Len(t, wire.Messages, 5)
	assertBlocks(t, wire.Messages[0].Content, "text:run echo hi", reminder("# Environment\nWorking directory: /work"))
	assertBlocks(t, wire.Messages[1].Content, "tool_use")
	assertBlocks(t, wire.Messages[2].Content, "tool_result", reminder("<total_tokens>9000 tokens left</total_tokens>"))
	assertBlocks(t, wire.Messages[3].Content, "text:It said hi.")
	assertBlocks(t, wire.Messages[4].Content,
		"text:thanks", reminder("<total_tokens>8000 tokens left</total_tokens>"), "cache_point")
}

// @scenario "A system message between turns on Bedrock stays in place with its cache breakpoint"
func TestBedrockTranslation_ClaudeCodeRequest_KeepsSystemMessagesInPlace(t *testing.T) {
	assertClaudeCodeConverse(t, converseFor(t, claudeCodeBody))
}

// @scenario "A system message between turns on Bedrock stays in place with its cache breakpoint"
func TestBedrockTranslation_PreviousRequestIsAPrefixOfTheNext(t *testing.T) {
	first := converseFor(t, `{"model": "m", "max_tokens": 10, "system": "sys", "messages": [
		{"role": "user", "content": "one"},
		{"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {}}]},
		{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "hi"}]},
		{"role": "system", "content": [{
			"type": "text", "text": "<total_tokens>9 tokens left</total_tokens>",
			"cache_control": {"type": "ephemeral"}
		}]}
	]}`)
	second := converseFor(t, `{"model": "m", "max_tokens": 10, "system": "sys", "messages": [
		{"role": "user", "content": "one"},
		{"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {}}]},
		{"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "hi"}]},
		{"role": "system", "content": "<total_tokens>9 tokens left</total_tokens>"},
		{"role": "assistant", "content": "two"},
		{"role": "user", "content": "three"},
		{"role": "system", "content": [{
			"type": "text", "text": "<total_tokens>8 tokens left</total_tokens>",
			"cache_control": {"type": "ephemeral"}
		}]}
	]}`)

	assert.Equal(t, first.System, second.System)
	require.Len(t, first.Messages, 3)
	require.Len(t, second.Messages, 5)
	assert.Equal(t, first.Messages[:2], second.Messages[:2])
	require.Equal(t, "cache_point", first.Messages[2].Content[2].kind())
	assert.Equal(t, first.Messages[2].Content[:2], second.Messages[2].Content)
}

// @scenario "A system message between turns on Bedrock stays in place with its cache breakpoint"
func TestBedrockTranslation_SystemMessageAfterAssistantTurn(t *testing.T) {
	t.Run("when a user turn follows, it joins that turn behind the tool results", func(t *testing.T) {
		wire := converseFor(t, `{"model": "m", "max_tokens": 10, "messages": [
			{"role": "user", "content": "go"},
			{"role": "assistant", "content": [{"type": "tool_use", "id": "t1", "name": "Bash", "input": {}}]},
			{"role": "system", "content": "note"},
			{"role": "user", "content": [
				{"type": "tool_result", "tool_use_id": "t1", "content": "hi"},
				{"type": "text", "text": "next"}
			]}
		]}`)
		require.Len(t, wire.Messages, 3)
		assertBlocks(t, wire.Messages[2].Content, "tool_result", reminder("note"), "text:next")
	})

	t.Run("when it ends the request, it becomes the final user turn", func(t *testing.T) {
		wire := converseFor(t, `{"model": "m", "max_tokens": 10, "messages": [
			{"role": "user", "content": "go"},
			{"role": "assistant", "content": "done"},
			{"role": "system", "content": [{
				"type": "text", "text": "note", "cache_control": {"type": "ephemeral"}
			}]}
		]}`)
		require.Len(t, wire.Messages, 3)
		assert.Equal(t, "user", wire.Messages[2].Role)
		assertBlocks(t, wire.Messages[2].Content, reminder("note"), "cache_point")
	})
}

// @scenario "System messages ahead of the conversation stay in the Bedrock system prompt"
func TestBedrockTranslation_LeadingSystemMessageIsLifted(t *testing.T) {
	wire := converseFor(t, `{"model": "m", "max_tokens": 10, "system": "first", "messages": [
		{"role": "system", "content": "second"},
		{"role": "user", "content": "hi"}
	]}`)
	assertBlocks(t, wire.System, "text:first", "text:second")
	require.Len(t, wire.Messages, 1)
	assertBlocks(t, wire.Messages[0].Content, "text:hi")
}

// @scenario "A system message between turns on Bedrock stays in place with its cache breakpoint"
func TestBedrockPrivateEndpoint_SystemMessagesStayOutOfTheSystemPrompt(t *testing.T) {
	bfCtx := bfschemasNewCtx()
	cred := vpceBedrockCred("https://vpce.example")
	bfReq, err := buildMessagesResponsesRequest(bfCtx, messagesRequest(claudeCodeBody), mapProvider(cred), bedrockSonnet)
	require.NoError(t, err)
	input, err := converseInputFromResponsesRequest(bfCtx, bfReq, bedrockSonnet, cred)
	require.NoError(t, err)
	assert.Len(t, input.System, 1)
	assert.Len(t, input.Messages, 5)
}

// @scenario "System messages between turns reach other translated providers unchanged"
func TestTranslation_OtherProviders_KeepSystemMessagesAsTheyAre(t *testing.T) {
	for _, provider := range []bfschemas.ModelProvider{bfschemas.Gemini, bfschemas.OpenAI, bfschemas.Vertex, bfschemas.Azure} {
		t.Run(string(provider), func(t *testing.T) {
			bfCtx := bfschemas.NewBifrostContext(context.Background(), time.Time{})
			bfReq, err := buildMessagesResponsesRequest(bfCtx, messagesRequest(claudeCodeBody), provider, "any-model")
			require.NoError(t, err)

			var systemTexts []string
			for _, msg := range bfReq.Input {
				if msg.Role == nil || *msg.Role != bfschemas.ResponsesInputMessageRoleSystem {
					continue
				}
				if msg.Content.ContentStr != nil {
					systemTexts = append(systemTexts, *msg.Content.ContentStr)
					continue
				}
				for _, block := range msg.Content.ContentBlocks {
					systemTexts = append(systemTexts, *block.Text)
				}
			}
			assert.Equal(t, []string{
				"You are Claude Code.",
				"# Environment\nWorking directory: /work",
				"<total_tokens>9000 tokens left</total_tokens>",
				"<total_tokens>8000 tokens left</total_tokens>",
			}, systemTexts)
		})
	}
}
