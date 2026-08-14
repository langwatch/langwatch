package providers

// Audio-token extraction. OpenAI reports audio tokens inside the prompt and
// completion totals and prices them roughly eight times higher than text, so
// the gateway has to carry the split out of every response shape it reads.

import (
	"context"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestExtractUsage_SplitsAudioOutOfTheChatTotals(t *testing.T) {
	u := extractUsage(&bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{
			PromptTokens:     1000,
			CompletionTokens: 300,
			TotalTokens:      1300,
			PromptTokensDetails: &bfschemas.ChatPromptTokensDetails{
				TextTokens: 200, AudioTokens: 800,
			},
			CompletionTokensDetails: &bfschemas.ChatCompletionTokensDetails{
				TextTokens: 50, AudioTokens: 250, ReasoningTokens: 40,
			},
		},
	})

	assert.Equal(t, 200, u.PromptTokens)
	assert.Equal(t, 800, u.InputAudioTokens)
	assert.Equal(t, 50, u.CompletionTokens)
	assert.Equal(t, 250, u.OutputAudioTokens)
	assert.Equal(t, 40, u.ReasoningTokens)
}

func TestExtractUsage_DerivesTheTextSplitWhenTheProviderOmitsIt(t *testing.T) {
	u := extractUsage(&bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{
			PromptTokens:        1000,
			CompletionTokens:    300,
			PromptTokensDetails: &bfschemas.ChatPromptTokensDetails{AudioTokens: 800},
			CompletionTokensDetails: &bfschemas.ChatCompletionTokensDetails{
				AudioTokens: 250,
			},
		},
	})

	assert.Equal(t, 200, u.PromptTokens)
	assert.Equal(t, 800, u.InputAudioTokens)
	assert.Equal(t, 50, u.CompletionTokens)
	assert.Equal(t, 250, u.OutputAudioTokens)
}

func TestExtractUsage_LeavesATextOnlyResponseUnchanged(t *testing.T) {
	u := extractUsage(&bfschemas.BifrostChatResponse{
		Usage: &bfschemas.BifrostLLMUsage{
			PromptTokens:     869,
			CompletionTokens: 207,
			TotalTokens:      1076,
			PromptTokensDetails: &bfschemas.ChatPromptTokensDetails{
				CachedReadTokens: 11,
			},
		},
	})

	assert.Equal(t, 869, u.PromptTokens)
	assert.Equal(t, 207, u.CompletionTokens)
	assert.Equal(t, 11, u.CacheReadTokens)
	assert.Zero(t, u.InputAudioTokens)
	assert.Zero(t, u.OutputAudioTokens)
}

func TestExtractResponsesUsage_SplitsAudioOutOfTheTotals(t *testing.T) {
	u := extractResponsesUsage(&bfschemas.BifrostResponsesResponse{
		Usage: &bfschemas.ResponsesResponseUsage{
			InputTokens:  1000,
			OutputTokens: 300,
			TotalTokens:  1300,
			InputTokensDetails: &bfschemas.ResponsesResponseInputTokens{
				TextTokens: 200, AudioTokens: 800,
			},
			OutputTokensDetails: &bfschemas.ResponsesResponseOutputTokens{
				TextTokens: 50, AudioTokens: 250, ReasoningTokens: 12,
			},
		},
	})

	assert.Equal(t, 200, u.PromptTokens)
	assert.Equal(t, 800, u.InputAudioTokens)
	assert.Equal(t, 50, u.CompletionTokens)
	assert.Equal(t, 250, u.OutputAudioTokens)
	assert.Equal(t, 12, u.ReasoningTokens)
}

func TestExtractSpeechUsage_SplitsAudioOutOfTheInputTotal(t *testing.T) {
	u := extractSpeechUsage(&bfschemas.BifrostSpeechResponse{
		Usage: &bfschemas.SpeechUsage{
			InputTokens:  120,
			OutputTokens: 0,
			TotalTokens:  120,
			InputChars:   4000,
			InputTokenDetails: &bfschemas.SpeechUsageInputTokenDetails{
				TextTokens: 100, AudioTokens: 20,
			},
		},
	})

	assert.Equal(t, 100, u.PromptTokens)
	assert.Equal(t, 20, u.InputAudioTokens)
	assert.Equal(t, 4000, u.InputChars)
}

func TestStreamIterator_KeepsAudioTokensAcrossChunks(t *testing.T) {
	ch := make(chan *bfschemas.BifrostStreamChunk, 3)
	// A passthrough stream that states the audio split once and then keeps
	// counting output tokens: a chunk-by-chunk replace would drop the split.
	usages := []domain.Usage{
		{PromptTokens: 200, InputAudioTokens: 800},
		{CompletionTokens: 30},
		{CompletionTokens: 50, OutputAudioTokens: 250},
	}
	for range usages {
		ch <- &bfschemas.BifrostStreamChunk{
			BifrostPassthroughResponse: &bfschemas.BifrostPassthroughResponse{
				Body: []byte("{}"),
			},
		}
	}
	close(ch)

	seen := 0
	iter := &bifrostStreamIterator{
		ch: ch,
		parseUsage: func([]byte) (domain.Usage, bool) {
			u := usages[seen]
			seen++
			return u, true
		},
	}
	for iter.Next(context.Background()) {
	}
	require.NoError(t, iter.Err())

	usage := iter.Usage()
	assert.Equal(t, 200, usage.PromptTokens)
	assert.Equal(t, 800, usage.InputAudioTokens)
	assert.Equal(t, 50, usage.CompletionTokens)
	assert.Equal(t, 250, usage.OutputAudioTokens)
}
