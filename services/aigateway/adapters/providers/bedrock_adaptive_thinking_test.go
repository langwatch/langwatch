package providers

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/bytedance/sonic"

	bfbedrock "github.com/maximhq/bifrost/core/providers/bedrock"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

const (
	bedrockOpus55   = "global.anthropic.claude-opus-5-5"
	bedrockSonnet55 = "global.anthropic.claude-sonnet-5-5"
	bedrockOpus47   = "global.anthropic.claude-opus-4-7"
	bedrockHaiku45  = "global.anthropic.claude-haiku-4-5-20251001-v1:0"
)

// claudeCodeFixture reads a /v1/messages body as Claude Code sends it.
func claudeCodeFixture(t *testing.T, name string) string {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("testdata", name))
	require.NoError(t, err)
	return string(body)
}

// publicBedrockConverse translates a fixture for the public Bedrock lane and
// returns the Converse body Bifrost would send: the raw body when the gateway
// set one, else Bifrost's own conversion.
func publicBedrockConverse(t *testing.T, body, model string) (gjson.Result, bool) {
	t.Helper()
	bfCtx := bfschemasNewCtx()
	bfReq, err := buildMessagesResponsesRequest(bfCtx, messagesRequest(body), bfschemas.Bedrock, model)
	require.NoError(t, err)
	require.NoError(t, prepareBedrockConverseBody(bfCtx, bfReq, []byte(body)))
	if usesRawBody(bfCtx) {
		return gjson.ParseBytes(bfReq.RawRequestBody), true
	}
	converse, err := bfbedrock.ToBedrockResponsesRequest(bfCtx, bfReq)
	require.NoError(t, err)
	encoded, err := sonic.Marshal(converse)
	require.NoError(t, err)
	return gjson.ParseBytes(encoded), false
}

// @scenario "Adaptive thinking stays adaptive for Claude 5 models on Bedrock"
func TestBedrockAdaptiveThinking_Claude5KeepsAdaptiveOnThePublicLane(t *testing.T) {
	cases := []struct {
		fixture string
		model   string
		effort  string
	}{
		{"claude_code_adaptive_opus_5_5.json", bedrockOpus55, "high"},
		{"claude_code_adaptive_sonnet_5_5.json", bedrockSonnet55, "medium"},
	}
	for _, tc := range cases {
		t.Run(tc.model, func(t *testing.T) {
			converse, raw := publicBedrockConverse(t, claudeCodeFixture(t, tc.fixture), tc.model)
			require.True(t, raw, "the gateway must send its own conversion for %s", tc.model)
			fields := converse.Get("additionalModelRequestFields")
			assert.Equal(t, "adaptive", fields.Get("thinking.type").String(), "%s", fields.Raw)
			assert.Equal(t, "summarized", fields.Get("thinking.display").String())
			assert.False(t, fields.Get("thinking.budget_tokens").Exists(), "%s", fields.Raw)
			assert.Equal(t, tc.effort, fields.Get("output_config.effort").String())
			assert.Equal(t, int64(32000), converse.Get("inferenceConfig.maxTokens").Int())
			assert.Equal(t, "Bash", converse.Get("toolConfig.tools.0.toolSpec.name").String())
			assert.True(t, converse.Get("messages.0.content.0.text").Exists())
		})
	}
}

// @scenario "A thinking budget for a Claude 5 model on Bedrock becomes adaptive thinking"
func TestBedrockAdaptiveThinking_BudgetRequestBecomesAdaptiveOnClaude5(t *testing.T) {
	converse, raw := publicBedrockConverse(t, claudeCodeFixture(t, "claude_code_budget_thinking.json"), bedrockOpus55)
	require.True(t, raw)
	fields := converse.Get("additionalModelRequestFields")
	assert.Equal(t, "adaptive", fields.Get("thinking.type").String(), "%s", fields.Raw)
	assert.False(t, fields.Get("thinking.budget_tokens").Exists())
	assert.NotEmpty(t, fields.Get("output_config.effort").String())
}

// @scenario "Claude models Bifrost already maps keep the vendored thinking conversion"
func TestBedrockAdaptiveThinking_ModelsBifrostKnowsKeepItsConversion(t *testing.T) {
	t.Run("opus 4.7 stays adaptive without a raw body", func(t *testing.T) {
		converse, raw := publicBedrockConverse(t, claudeCodeFixture(t, "claude_code_adaptive_opus_4_7.json"), bedrockOpus47)
		assert.False(t, raw)
		fields := converse.Get("additionalModelRequestFields")
		assert.Equal(t, "adaptive", fields.Get("thinking.type").String(), "%s", fields.Raw)
		assert.Equal(t, "high", fields.Get("output_config.effort").String())
	})
	t.Run("haiku 4.5 keeps budget thinking", func(t *testing.T) {
		converse, raw := publicBedrockConverse(t, claudeCodeFixture(t, "claude_code_budget_thinking.json"), bedrockHaiku45)
		assert.False(t, raw)
		fields := converse.Get("additionalModelRequestFields")
		assert.Equal(t, "enabled", fields.Get("thinking.type").String(), "%s", fields.Raw)
		assert.Positive(t, fields.Get("thinking.budget_tokens").Int())
	})
}

// @scenario "Adaptive thinking stays adaptive for Claude 5 models on Bedrock"
func TestBedrockAdaptiveThinking_Claude5KeepsAdaptiveOnThePrivateEndpoint(t *testing.T) {
	for _, model := range []string{bedrockOpus55, bedrockSonnet55, bedrockOpus47} {
		t.Run(model, func(t *testing.T) {
			body := claudeCodeFixture(t, "claude_code_adaptive_opus_5_5.json")
			bfCtx := bfschemasNewCtx()
			cred := vpceBedrockCred("https://vpce-0000.bedrock-runtime.us-east-1.vpce.amazonaws.com")
			bfReq, err := buildMessagesResponsesRequest(bfCtx, messagesRequest(body), bfschemas.Bedrock, model)
			require.NoError(t, err)
			input, err := converseInputFromResponsesRequest(bfCtx, bfReq, model, cred)
			require.NoError(t, err)
			require.NotNil(t, input.AdditionalModelRequestFields)
			fields := gjson.ParseBytes(docJSON(t, input.AdditionalModelRequestFields))
			assert.Equal(t, "adaptive", fields.Get("thinking.type").String(), "%s", fields.Raw)
			assert.Equal(t, "summarized", fields.Get("thinking.display").String())
			assert.False(t, fields.Get("thinking.budget_tokens").Exists())
			assert.Equal(t, "high", fields.Get("output_config.effort").String())
		})
	}
}

// publicBedrockChatConverse builds a chat completion for public Bedrock and
// returns the raw Converse body the gateway pinned, if any.
func publicBedrockChatConverse(t *testing.T, body, model string) (gjson.Result, bool) {
	t.Helper()
	req := &domain.Request{Type: domain.RequestTypeChat, Model: model, Body: []byte(body)}
	bfReq, dispatchCtx, err := buildChatRequest(context.Background(), req, bfschemas.Bedrock, model)
	require.NoError(t, err)
	bfCtx := bfschemas.NewBifrostContext(dispatchCtx, time.Time{})
	require.NoError(t, pinBedrockAdaptiveThinkingChat(bfCtx, bfReq))
	if !usesRawBody(bfCtx) {
		return gjson.Result{}, false
	}
	return gjson.ParseBytes(bfReq.RawRequestBody), true
}

// @scenario "reasoning toward a Claude 5 model on Bedrock is sent as adaptive thinking"
func TestBedrockAdaptiveThinking_ChatOnThePublicLane(t *testing.T) {
	t.Run("reasoning_effort on opus 5.5", func(t *testing.T) {
		converse, raw := publicBedrockChatConverse(t,
			`{"model":"m","max_tokens":8000,"reasoning_effort":"high","messages":[{"role":"user","content":"think"}]}`, bedrockOpus55)
		require.True(t, raw)
		fields := converse.Get("additionalModelRequestFields")
		assert.Equal(t, "adaptive", fields.Get("thinking.type").String(), "%s", fields.Raw)
		assert.False(t, fields.Get("thinking.budget_tokens").Exists())
		assert.Equal(t, "high", fields.Get("output_config.effort").String())
		assert.Equal(t, "think", converse.Get("messages.0.content.0.text").String())
	})
	t.Run("opus 4.7 stays on the vendored conversion", func(t *testing.T) {
		_, raw := publicBedrockChatConverse(t,
			`{"model":"m","max_tokens":8000,"reasoning_effort":"high","messages":[{"role":"user","content":"think"}]}`, bedrockOpus47)
		assert.False(t, raw)
	})
	t.Run("no reasoning means no raw body", func(t *testing.T) {
		_, raw := publicBedrockChatConverse(t,
			`{"model":"m","max_tokens":8000,"messages":[{"role":"user","content":"hi"}]}`, bedrockOpus55)
		assert.False(t, raw)
	})
}

// @scenario "reasoning toward a Claude 5 model on Bedrock is sent as adaptive thinking"
func TestBedrockAdaptiveThinking_ChatOnThePrivateEndpoint(t *testing.T) {
	t.Run("reasoning_effort on sonnet 5.5", func(t *testing.T) {
		params := vpceParams(t, `{"model":"m","messages":[],"reasoning_effort":"medium"}`)
		doc, err := mapBedrockAdditionalFields(context.Background(), params, bedrockSonnet55)
		require.NoError(t, err)
		fields := gjson.ParseBytes(docJSON(t, doc))
		assert.Equal(t, "adaptive", fields.Get("thinking.type").String(), "%s", fields.Raw)
		assert.Equal(t, "summarized", fields.Get("thinking.display").String())
		assert.Equal(t, "medium", fields.Get("output_config.effort").String())
	})
	t.Run("an explicit budget on opus 5.5", func(t *testing.T) {
		params := vpceParams(t, `{"model":"m","messages":[],"max_tokens":32000,"reasoning":{"max_tokens":31999}}`)
		require.NotNil(t, params.Reasoning)
		require.NotNil(t, params.Reasoning.MaxTokens)
		doc, err := mapBedrockAdditionalFields(context.Background(), params, bedrockOpus55)
		require.NoError(t, err)
		fields := gjson.ParseBytes(docJSON(t, doc))
		assert.Equal(t, "adaptive", fields.Get("thinking.type").String(), "%s", fields.Raw)
		assert.False(t, fields.Get("thinking.budget_tokens").Exists())
		assert.Equal(t, "high", fields.Get("output_config.effort").String())
	})
}

func TestClaudeTakesAdaptiveThinking(t *testing.T) {
	cases := map[string]bool{
		bedrockOpus55:                  true,
		bedrockSonnet55:                true,
		"claude-opus-5-5":              true,
		"us.anthropic.claude-opus-6-0": true,
		"claude-fable-5-2":             true,
		bedrockOpus47:                  true,
		"claude-sonnet-4-6":            true,
		bedrockHaiku45:                 false,
		"anthropic.claude-3-5-sonnet-20240620-v1:0": false,
		"claude-sonnet-4-20250514":                  false,
		"amazon.nova-pro-v1:0":                      false,
	}
	for model, want := range cases {
		assert.Equal(t, want, claudeTakesAdaptiveThinking(model), model)
	}
}
