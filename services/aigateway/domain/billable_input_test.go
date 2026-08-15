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

// Audio tokens leave the prompt total before the cache tokens do, and both
// splits have to hold at once: a call that reports audio input AND a cache
// read must not charge either bucket at the input rate as well.
func TestBillableInputTokensAfterTheAudioSplit(t *testing.T) {
	usage := Usage{PromptTokens: 1000, CacheReadTokens: 150}.
		SplitAudioTokens(AudioTokenSplit{InputAudio: 800, InputText: 200})

	assert.Equal(t, 200, usage.PromptTokens, "audio comes out of the prompt total first")
	assert.Equal(t, 50, usage.BillableInputTokens(),
		"the cache read then comes out of what audio left behind")
}
