package spendemitter

// The cache half of the wire contract. The provider's prompt total holds the
// cached tokens, and the rating seam adds the cache buckets on top of the
// input bucket, so a total shipped whole charges every cached token twice:
// once at the input rate and once at its own.

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// @scenario "The confirm command states the cached tokens apart from the input it charges at the input rate"
func TestConfirmTakesTheCachedTokensOutOfTheInputCount(t *testing.T) {
	usage := confirmUsage(t, domain.Usage{
		PromptTokens:        37651, // the provider total, cache included
		CompletionTokens:    12,
		CacheReadTokens:     37127,
		CacheCreationTokens: 14,
	})

	assert.EqualValues(t, 510, usage["input_tokens"],
		"input_tokens is the non-cached remainder: 37651 - 37127 - 14")
	assert.EqualValues(t, 37127, usage["cache_read_input_tokens"])
	assert.EqualValues(t, 14, usage["cache_creation_input_tokens"])
	assert.EqualValues(t, 12, usage["output_tokens"])
}

// @scenario "The confirm command states the cached tokens apart from the input it charges at the input rate"
func TestConfirmLeavesAnUncachedRequestUntouched(t *testing.T) {
	usage := confirmUsage(t, domain.Usage{
		PromptTokens:     4814,
		CompletionTokens: 10,
	})

	assert.EqualValues(t, 4814, usage["input_tokens"],
		"a request with no cache activity carries the full prompt")
	assert.EqualValues(t, 0, usage["cache_read_input_tokens"])
	assert.EqualValues(t, 0, usage["cache_creation_input_tokens"])
}

// The customer span and the spend record are the two producers of the same
// measurement. They have to state the same input count for the same usage, or
// a trace and its bill disagree, which is the defect this pins shut.
//
// @scenario "The confirm command states the cached tokens apart from the input it charges at the input rate"
func TestConfirmStatesTheSameInputCountTheSpanDoes(t *testing.T) {
	shapes := []domain.Usage{
		{PromptTokens: 4814, CompletionTokens: 10},
		{PromptTokens: 4814, CompletionTokens: 10, CacheReadTokens: 4736},
		{PromptTokens: 37651, CompletionTokens: 12, CacheReadTokens: 37127, CacheCreationTokens: 14},
		{PromptTokens: 36299, CompletionTokens: 210, CacheReadTokens: 18443,
			CacheCreationTokens: 17854, CacheCreation1hTokens: 12000},
		{PromptTokens: 100, CompletionTokens: 5, CacheReadTokens: 400},
	}

	for _, shape := range shapes {
		usage := confirmUsage(t, shape)
		assert.EqualValues(t, shape.BillableInputTokens(), usage["input_tokens"],
			"the wire must carry the same billable input the span reports")
	}
}
