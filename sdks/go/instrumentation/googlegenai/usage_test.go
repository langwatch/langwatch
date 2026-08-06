package googlegenai

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	langwatch "github.com/langwatch/langwatch/sdks/go"
)

// TestToGenAIUsage_ExclusiveCachedSplit pins the subset -> exclusive
// normalisation. Gemini reports cachedContentTokenCount as a SUBSET of
// promptTokenCount, while LangWatch costs input and cache-read additively, so
// InputTokens must carry the non-cached remainder only. Emitting
// promptTokenCount as-is would bill the cached portion twice.
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
			name:       "no cached content leaves prompt untouched",
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
			u := &usageMetadata{
				PromptTokenCount:        tc.prompt,
				CachedContentTokenCount: tc.cached,
			}

			usage := u.toGenAIUsage()

			assert.Equal(t, tc.wantInput, usage.InputTokens)
			assert.Equal(t, tc.wantCached, usage.CachedInputTokens)
		})
	}
}

// TestToGenAIUsage_TotalTokensUnchanged confirms the normalisation touches only
// the input split: TotalTokens stays the provider's reported total, which
// already accounts for the cached tokens.
func TestToGenAIUsage_TotalTokensUnchanged(t *testing.T) {
	u := &usageMetadata{
		PromptTokenCount:        1000,
		CandidatesTokenCount:    50,
		TotalTokenCount:         1050,
		CachedContentTokenCount: 800,
	}

	usage := u.toGenAIUsage()

	require.NotNil(t, usage.TotalTokens)
	assert.Equal(t, 1050, *usage.TotalTokens)
	require.NotNil(t, usage.InputTokens)
	assert.Equal(t, 200, *usage.InputTokens)
}
