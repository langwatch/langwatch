package domain

// The input a request is charged the plain input rate for. Providers report a
// prompt total that already holds the cached tokens, and every pricing path
// adds the cache buckets on top of the input bucket, so the total has to have
// them taken out before anything prices it.

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestBillableInputTokens(t *testing.T) {
	cases := []struct {
		name  string
		usage Usage
		want  int
	}{
		{
			name:  "no cache activity keeps the whole prompt",
			usage: Usage{PromptTokens: 4814},
			want:  4814,
		},
		{
			name: "a cache read comes out of the prompt total",
			usage: Usage{
				PromptTokens:    4814,
				CacheReadTokens: 4736,
			},
			want: 78,
		},
		{
			name: "a cache write comes out too",
			usage: Usage{
				PromptTokens:        37651,
				CacheReadTokens:     37127,
				CacheCreationTokens: 14,
			},
			want: 510,
		},
		{
			name: "the hour-long share is part of the write total, not extra",
			usage: Usage{
				PromptTokens:          36299,
				CacheReadTokens:       18443,
				CacheCreationTokens:   17854,
				CacheCreation1hTokens: 12000,
			},
			want: 2,
		},
		{
			name: "counts that do not add up keep the full prompt",
			usage: Usage{
				PromptTokens:    100,
				CacheReadTokens: 400,
			},
			want: 100,
		},
		{
			name:  "an empty usage charges nothing",
			usage: Usage{},
			want:  0,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.Equal(t, tc.want, tc.usage.BillableInputTokens())
		})
	}
}

// The two subtractions have to compose. Audio leaves the prompt total first,
// the cache buckets leave what is left, and every input token the provider
// counted must end up in exactly one priced bucket: no token subtracted twice,
// none left unattributed.
func TestBillableInputTokensAfterTheAudioSplit(t *testing.T) {
	usage := Usage{PromptTokens: 1000, CacheReadTokens: 150}.
		SplitAudioTokens(AudioTokenSplit{InputAudio: 800, InputText: 200})

	assert.Equal(t, 200, usage.PromptTokens, "audio comes out of the prompt total first")
	assert.Equal(t, 50, usage.BillableInputTokens(),
		"the cache read then comes out of what audio left behind")

	priced := usage.BillableInputTokens() + usage.CacheReadTokens +
		usage.CacheCreationTokens + usage.InputAudioTokens
	assert.Equal(t, 1000, priced,
		"the priced buckets add back up to the input the provider counted")
}

// A provider can report cached tokens that cover part of the audio share, and
// the counts it gives cannot say how much. Subtracting the whole cache read
// from what audio left behind would go below zero, so the guard keeps the
// audio-exclusive total, which is what the span reported before this helper
// existed. The request is then charged for more tokens than it used, at the
// cheaper cache rate for the overlap, rather than for fewer.
//
// Reading the overlap needs the per-modality cached breakdown, which the
// pinned Bifrost release does not report; that is #7048. No request reaches a
// model with cached audio through the gateway today.
func TestBillableInputTokensWhenTheCacheCountCoversTheAudioShare(t *testing.T) {
	usage := Usage{PromptTokens: 1000, CacheReadTokens: 900}.
		SplitAudioTokens(AudioTokenSplit{InputAudio: 800, InputText: 200})

	assert.Equal(t, 200, usage.PromptTokens)
	assert.Equal(t, 200, usage.BillableInputTokens(),
		"the guard keeps the audio-exclusive total rather than a negative count")
}
