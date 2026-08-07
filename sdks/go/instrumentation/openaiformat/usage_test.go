package openaiformat

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	langwatch "github.com/langwatch/langwatch/sdks/go"
)

// TestToGenAIUsage_ExclusiveCachedSplit pins the subset -> exclusive
// normalisation. OpenAI reports prompt_tokens_details.cached_tokens as a SUBSET
// of prompt_tokens, while LangWatch costs input and cache-read additively, so
// InputTokens must carry the non-cached remainder only. Emitting prompt_tokens
// as-is would bill the cached portion twice.
func TestToGenAIUsage_ExclusiveCachedSplit(t *testing.T) {
	cases := []struct {
		name       string
		prompt     int
		cached     int
		wantInput  *int
		wantCached *int
	}{
		{
			name:       "cached subset is subtracted from prompt",
			prompt:     1000,
			cached:     800,
			wantInput:  langwatch.Int(200),
			wantCached: langwatch.Int(800),
		},
		{
			name:       "no cached tokens leaves prompt untouched",
			prompt:     1000,
			cached:     0,
			wantInput:  langwatch.Int(1000),
			wantCached: nil,
		},
		{
			name:       "fully cached prompt records no non-cached input",
			prompt:     500,
			cached:     500,
			wantInput:  nil,
			wantCached: langwatch.Int(500),
		},
		{
			name:       "cached exceeding prompt clamps instead of going negative",
			prompt:     100,
			cached:     400,
			wantInput:  nil,
			wantCached: langwatch.Int(400),
		},
		{
			name:       "absent usage records nothing",
			prompt:     0,
			cached:     0,
			wantInput:  nil,
			wantCached: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u := &usagePayload{PromptTokens: tc.prompt}
			u.PromptTokensDetails.CachedTokens = tc.cached

			usage := u.toGenAIUsage()

			assert.Equal(t, tc.wantInput, usage.InputTokens)
			assert.Equal(t, tc.wantCached, usage.CachedInputTokens)
		})
	}
}

// TestToGenAIUsage_NilPayload pins the nil guard. A chat response that omits
// `usage` decodes to a nil *usagePayload and is passed straight to recordUsage,
// so this is the live path, not a defensive one.
func TestToGenAIUsage_NilPayload(t *testing.T) {
	var u *usagePayload

	usage := u.toGenAIUsage()

	assert.Nil(t, usage.InputTokens)
	assert.Nil(t, usage.OutputTokens)
	assert.Nil(t, usage.TotalTokens)
	assert.Nil(t, usage.CachedInputTokens)
	assert.Nil(t, usage.ReasoningTokens)
}

// TestMergeUsage_NilPayload confirms the streamed path survives a chunk with no
// usage block and leaves the accumulated usage untouched.
func TestMergeUsage_NilPayload(t *testing.T) {
	dst := langwatch.GenAIUsage{InputTokens: langwatch.Int(7)}

	mergeUsage(&dst, nil)

	require.NotNil(t, dst.InputTokens)
	assert.Equal(t, 7, *dst.InputTokens)
	assert.Nil(t, dst.OutputTokens)
	assert.Nil(t, dst.TotalTokens)
}

// TestToGenAIUsage_TotalTokensUnchanged confirms the normalisation touches only
// the input split: TotalTokens stays the provider's reported total, which
// already accounts for the cached tokens.
func TestToGenAIUsage_TotalTokensUnchanged(t *testing.T) {
	u := &usagePayload{PromptTokens: 1000, CompletionTokens: 50, TotalTokens: 1050}
	u.PromptTokensDetails.CachedTokens = 800

	usage := u.toGenAIUsage()

	require.NotNil(t, usage.TotalTokens)
	assert.Equal(t, 1050, *usage.TotalTokens)
	require.NotNil(t, usage.InputTokens)
	assert.Equal(t, 200, *usage.InputTokens)
}

// TestResponsesToGenAIUsage_ExclusiveCachedSplit pins the same normalisation for
// the Responses API, where input_tokens_details.cached_tokens is likewise a
// subset of input_tokens.
func TestResponsesToGenAIUsage_ExclusiveCachedSplit(t *testing.T) {
	cases := []struct {
		name       string
		input      int
		cached     int
		wantInput  *int
		wantCached *int
	}{
		{
			name:       "cached subset is subtracted from input",
			input:      1000,
			cached:     800,
			wantInput:  langwatch.Int(200),
			wantCached: langwatch.Int(800),
		},
		{
			name:       "no cached tokens leaves input untouched",
			input:      1000,
			cached:     0,
			wantInput:  langwatch.Int(1000),
			wantCached: nil,
		},
		{
			name:       "fully cached input records no non-cached input",
			input:      500,
			cached:     500,
			wantInput:  nil,
			wantCached: langwatch.Int(500),
		},
		{
			name:       "cached exceeding input clamps instead of going negative",
			input:      100,
			cached:     400,
			wantInput:  nil,
			wantCached: langwatch.Int(400),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			u := responsesUsagePayload{InputTokens: tc.input}
			u.InputTokensDetails.CachedTokens = tc.cached

			usage := u.toGenAIUsage()

			assert.Equal(t, tc.wantInput, usage.InputTokens)
			assert.Equal(t, tc.wantCached, usage.CachedInputTokens)
		})
	}
}

// TestMergeUsage_ExclusiveCachedSplit confirms the streamed path inherits the
// normalisation, since mergeUsage folds through toGenAIUsage.
func TestMergeUsage_ExclusiveCachedSplit(t *testing.T) {
	dst := langwatch.GenAIUsage{}
	chunk := &usagePayload{PromptTokens: 1000, CompletionTokens: 20, TotalTokens: 1020}
	chunk.PromptTokensDetails.CachedTokens = 800

	mergeUsage(&dst, chunk)

	require.NotNil(t, dst.InputTokens)
	assert.Equal(t, 200, *dst.InputTokens)
	require.NotNil(t, dst.CachedInputTokens)
	assert.Equal(t, 800, *dst.CachedInputTokens)
	require.NotNil(t, dst.TotalTokens)
	assert.Equal(t, 1020, *dst.TotalTokens)
}
