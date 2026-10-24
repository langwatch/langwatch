package rules

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Values from ragas 0.4.3 BleuScore over sacrebleu 2.6.0.
func TestBLEUMatchesRagas(t *testing.T) {
	cases := []struct {
		name, response, reference string
		want                      float64
	}{
		{"one word differs", "a cat is on the mat", "the cat is on the mat", 0.7598356856515927},
		{"only the first response sentence counts", "the cat is on the mat. unrelated words here", "It rains. the cat is on the mat", 1.0000000000000004},
		{"entities decode one after another", "a < b and c", "a &amp;lt; b and c", 1.0000000000000004},
		{"case matters", "hello there", "Hello there", 0},
		{"empty response", "", "the cat", 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			assert.InDelta(t, tc.want, BLEU(tc.response, tc.reference), 1e-12)
		})
	}
}

func TestTokenize13aMatchesSacrebleu(t *testing.T) {
	assert.Equal(t, []string{"x", "<", "y-3", "3", "-", "4", "1,000.5", "end", "."}, tokenize13a("x &amp;lt; y-3 3-4 1,000.5 end.  "))
}
