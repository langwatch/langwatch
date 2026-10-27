package blocktimeout_test

import (
	"math"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/app/engine/blocks/blocktimeout"
)

func TestClamp(t *testing.T) {
	const ceiling = 12 * time.Minute

	for name, tc := range map[string]struct {
		askedMS int
		want    time.Duration
	}{
		"shorter wins":            {askedMS: 5_000, want: 5 * time.Second},
		"longer loses":            {askedMS: 30 * 60 * 1000, want: ceiling},
		"equal to ceiling":        {askedMS: 12 * 60 * 1000, want: ceiling},
		"missing":                 {askedMS: 0, want: ceiling},
		"negative":                {askedMS: -5_000, want: ceiling},
		"overflows int64 nanos":   {askedMS: math.MaxInt64, want: ceiling},
		"just past the overflow":  {askedMS: 9_223_372_036_855, want: ceiling},
		"just under the overflow": {askedMS: 9_223_372_036_854, want: ceiling},
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, tc.want, blocktimeout.Clamp(ceiling, tc.askedMS))
		})
	}
}

func TestFromMillis(t *testing.T) {
	for name, tc := range map[string]struct {
		ms   int
		want time.Duration
	}{
		"positive":              {ms: 5_000, want: 5 * time.Second},
		"missing":               {ms: 0, want: 0},
		"negative":              {ms: -5_000, want: 0},
		"overflows int64 nanos": {ms: math.MaxInt64, want: 0},
		"largest safe value":    {ms: 9_223_372_036_854, want: time.Duration(9_223_372_036_854) * time.Millisecond},
	} {
		t.Run(name, func(t *testing.T) {
			got := blocktimeout.FromMillis(tc.ms)
			assert.Equal(t, tc.want, got)
			assert.GreaterOrEqual(t, got, time.Duration(0), "never a negative budget")
		})
	}
}
