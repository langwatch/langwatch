package providers

import (
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/tidwall/gjson"
)

// hourCacheBody follows Claude Code's markers: hour-long on tools and system,
// with a shorter one ahead only in history.
const hourCacheBody = `{
  "model": "claude-sonnet-5-5", "max_tokens": 10,
  "tools": [{
    "name": "Bash", "description": "Run.", "input_schema": {"type": "object", "properties": {"z": {}, "a": {}}},
    "cache_control": {"type": "ephemeral", "ttl": "1h"}
  }],
  "system": [{"type": "text", "text": "sys", "cache_control": {"type": "ephemeral", "ttl": "1h"}}],
  "messages": [
    {"role": "user", "content": [{"type": "text", "text": "one", "cache_control": {"type": "ephemeral", "ttl": "1h"}}]},
    {"role": "assistant", "content": "two"},
    {"role": "user", "content": [{"type": "text", "text": "three", "cache_control": {"type": "ephemeral"}}]}
  ]
}`

func translatedRequest(t *testing.T, provider bfschemas.ModelProvider, body string) (*bfschemas.BifrostContext, *bfschemas.BifrostResponsesRequest) {
	t.Helper()
	bfCtx := bfschemasNewCtx()
	bfReq, err := buildMessagesResponsesRequest(bfCtx, messagesRequest(body), provider, bedrockSonnet)
	require.NoError(t, err)
	require.NoError(t, carryBedrockCacheTTL(bfCtx, bfReq, []byte(body)))
	return bfCtx, bfReq
}

func usesRawBody(bfCtx *bfschemas.BifrostContext) bool {
	raw, _ := bfCtx.Value(bfschemas.BifrostContextKeyUseRawRequestBody).(bool)
	return raw
}

// @scenario "An hour-long cache breakpoint keeps its lifetime on Bedrock"
func TestCarryBedrockCacheTTL_SetsHourOnTheMatchingCachePoints(t *testing.T) {
	bfCtx, bfReq := translatedRequest(t, bfschemas.Bedrock, hourCacheBody)
	require.True(t, usesRawBody(bfCtx))
	body := gjson.ParseBytes(bfReq.RawRequestBody)

	assert.Equal(t, "1h", body.Get("toolConfig.tools.1.cachePoint.ttl").String())
	assert.Equal(t, "1h", body.Get("system.1.cachePoint.ttl").String())
	assert.Equal(t, "1h", body.Get("messages.0.content.1.cachePoint.ttl").String())
	require.True(t, body.Get("messages.2.content.1.cachePoint").Exists())
	assert.False(t, body.Get("messages.2.content.1.cachePoint.ttl").Exists())
	assert.Equal(t, "default", body.Get("system.1.cachePoint.type").String())
}

// @scenario "An hour-long cache breakpoint keeps its lifetime on Bedrock"
func TestCarryBedrockCacheTTL_KeepsMidConversationSystemBreakpoint(t *testing.T) {
	_, bfReq := translatedRequest(t, bfschemas.Bedrock, `{"model": "m", "max_tokens": 10, "messages": [
		{"role": "user", "content": "one"},
		{"role": "system", "content": [{
			"type": "text", "text": "note", "cache_control": {"type": "ephemeral", "ttl": "1h"}
		}]}
	]}`)
	body := gjson.ParseBytes(bfReq.RawRequestBody)
	assert.False(t, body.Get("system").Exists())
	assert.Equal(t, "1h", body.Get("messages.0.content.2.cachePoint.ttl").String())
}

// @scenario "An hour-long cache breakpoint keeps its lifetime on Bedrock"
func TestCarryBedrockCacheTTL_BodyIsStableAcrossRuns(t *testing.T) {
	_, first := translatedRequest(t, bfschemas.Bedrock, hourCacheBody)
	for range 20 {
		_, next := translatedRequest(t, bfschemas.Bedrock, hourCacheBody)
		require.Equal(t, string(first.RawRequestBody), string(next.RawRequestBody))
	}
}

// @scenario "Requests without an hour-long breakpoint keep the vendored Converse conversion"
func TestCarryBedrockCacheTTL_LeavesOtherRequestsAlone(t *testing.T) {
	t.Run("when Bedrock gets only default breakpoints", func(t *testing.T) {
		bfCtx, bfReq := translatedRequest(t, bfschemas.Bedrock, claudeCodeBody)
		assert.False(t, usesRawBody(bfCtx))
		assert.Empty(t, bfReq.RawRequestBody)
	})

	/** @scenario "A Bedrock model that refuses the hour-long lifetime keeps the default one" */
	t.Run("when a Bedrock model that refuses the lifetime gets an hour-long breakpoint", func(t *testing.T) {
		bfCtx := bfschemasNewCtx()
		bfReq, err := buildMessagesResponsesRequest(bfCtx, messagesRequest(hourCacheBody), bfschemas.Bedrock, "eu.amazon.nova-lite-v1:0")
		require.NoError(t, err)
		require.NoError(t, carryBedrockCacheTTL(bfCtx, bfReq, []byte(hourCacheBody)))
		assert.False(t, usesRawBody(bfCtx))
	})

	t.Run("when another provider gets an hour-long breakpoint", func(t *testing.T) {
		bfCtx, bfReq := translatedRequest(t, bfschemas.Gemini, hourCacheBody)
		assert.False(t, usesRawBody(bfCtx))
		assert.Empty(t, bfReq.RawRequestBody)
	})
}

// @scenario "Hour-long cache writes on the translated lane are counted apart"
func TestExtractResponsesUsage_CountsHourLongWrites(t *testing.T) {
	usage := extractResponsesUsage(&bfschemas.BifrostResponsesResponse{Usage: &bfschemas.ResponsesResponseUsage{
		InputTokens: 900,
		InputTokensDetails: &bfschemas.ResponsesResponseInputTokens{
			CachedWriteTokens: 800,
			CachedWriteTokenDetails: &bfschemas.ChatCachedWriteTokenDetails{
				CachedWriteTokens5m: 200, CachedWriteTokens1h: 600,
			},
		},
	}})
	assert.Equal(t, 800, usage.CacheCreationTokens)
	assert.Equal(t, 600, usage.CacheCreation1hTokens)
}

// @scenario "A Bedrock model that refuses the hour-long lifetime keeps the default one"
func TestBedrockModelTakesHourCache(t *testing.T) {
	for model, want := range map[string]bool{
		"eu.anthropic.claude-sonnet-5-5":                                   true,
		"eu.anthropic.claude-opus-5-5":                                     true,
		"eu.anthropic.claude-haiku-5-5":                                    true,
		"eu.anthropic.claude-opus-5":                                       true,
		"eu.anthropic.claude-haiku-4-5-20251001-v1:0":                      true,
		"eu.anthropic.claude-sonnet-4-5-20250929-v1:0":                     true,
		"anthropic.claude-opus-4-8":                                        true,
		"anthropic.claude-opus-4-1-20250805-v1:0":                          false,
		"eu.anthropic.claude-sonnet-4-20250514-v1:0":                       false,
		"eu.anthropic.claude-3-7-sonnet-20250219-v1:0":                     false,
		"anthropic.claude-3-5-haiku-20241022-v1:0":                         false,
		"eu.amazon.nova-lite-v1:0":                                         false,
		"arn:aws:bedrock:eu-central-1:1:application-inference-profile/abc": false,
	} {
		assert.Equal(t, want, bedrockModelTakesHourCache(model), model)
	}
}

// @scenario "Hour-long cache writes on the translated lane are counted apart"
func TestTranslatedStream_CountsHourLongWrites(t *testing.T) {
	iter := &anthropicTranslatedStreamIterator{framer: newAnthropicStreamFramer("", "m")}
	iter.consume(&bfschemas.BifrostResponsesStreamResponse{Response: &bfschemas.BifrostResponsesResponse{
		Usage: &bfschemas.ResponsesResponseUsage{
			InputTokens: 900,
			InputTokensDetails: &bfschemas.ResponsesResponseInputTokens{
				CachedWriteTokens:       800,
				CachedWriteTokenDetails: &bfschemas.ChatCachedWriteTokenDetails{CachedWriteTokens1h: 600},
			},
		},
	}})
	assert.Equal(t, 800, iter.Usage().CacheCreationTokens)
	assert.Equal(t, 600, iter.Usage().CacheCreation1hTokens)
}
