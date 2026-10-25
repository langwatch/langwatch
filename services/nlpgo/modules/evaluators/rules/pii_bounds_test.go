package rules

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

// PHONE_NUMBER is left out: libphonenumber parses each candidate, linear but
// slow. A quarter of the text must take over a tenth of the time: linear
// work is 4x, the all-pairs dedupe this replaced was 16x (-race safe).
// @scenario "Text at the PII length limit full of numbers is analyzed in seconds"
func TestPIIAnalysisOfALongNumericTextGrowsLinearly(t *testing.T) {
	p := NewPIIPatterns()
	entities := slices.DeleteFunc(p.Covers(), func(e contract.EntityType) bool { return e == "PHONE_NUMBER" })
	elapsed := func(chars int) time.Duration {
		started := time.Now()
		matches, err := p.Analyze(context.Background(), strings.Repeat("123456789 ", chars/10), entities)
		require.NoError(t, err)
		require.NotEmpty(t, matches)
		return time.Since(started)
	}
	quarter, full := elapsed(524_288/4), elapsed(524_288)
	t.Logf("quarter %v, full %v", quarter, full)
	assert.Less(t, full, 10*quarter)
}

// @scenario "Text at the PII length limit full of numbers is analyzed in seconds"
func TestPIIAnalysisStopsWhenItsContextEnds(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := NewPIIPatterns().Analyze(ctx, "mail john@example.com", []contract.EntityType{"EMAIL_ADDRESS"})
	require.ErrorIs(t, err, context.Canceled)
}

// removeDuplicatesByScan is remove_duplicates as Presidio writes it, every
// finding against every kept one: the reference the indexed one must equal.
func removeDuplicatesByScan(results []PIIMatch) []PIIMatch {
	var unique []PIIMatch
	for _, r := range results {
		if !slices.ContainsFunc(unique, func(u PIIMatch) bool { return u.PIIFinding == r.PIIFinding }) {
			unique = append(unique, r)
		}
	}
	slices.SortStableFunc(unique, func(a, b PIIMatch) int {
		switch {
		case rankBefore(a.PIIFinding, b.PIIFinding):
			return -1
		case rankBefore(b.PIIFinding, a.PIIFinding):
			return 1
		}
		return 0
	})
	var kept []PIIMatch
	for _, r := range unique {
		contained := slices.ContainsFunc(kept, func(k PIIMatch) bool {
			return r.Start >= k.Start && r.End <= k.End && r.EntityType == k.EntityType
		})
		if r.Score != 0 && !contained {
			kept = append(kept, r)
		}
	}
	return kept
}

// seededSequence is a fixed xorshift sequence: the same findings every run.
type seededSequence struct{ state uint64 }

func newSeededSequence() *seededSequence { return &seededSequence{state: 0x9e3779b97f4a7c15} }

// IntN answers a value in [0, n).
func (s *seededSequence) IntN(n int) int {
	s.state ^= s.state << 13
	s.state ^= s.state >> 7
	s.state ^= s.state << 17
	return int(s.state % uint64(n))
}

// @scenario "Pattern PII findings match Presidio's, scores included"
func TestRemoveDuplicatesMatchesTheAllPairsScan(t *testing.T) {
	random := newSeededSequence()
	types := []contract.EntityType{"EMAIL_ADDRESS", "PHONE_NUMBER", "US_SSN"}
	scores := []float64{0, 0.3, 0.4, 0.75, 1}
	for range 500 {
		findings := make([]PIIMatch, random.IntN(40))
		for i := range findings {
			start := random.IntN(30)
			findings[i] = PIIMatch{
				PIIFinding: contract.PIIFinding{EntityType: types[random.IntN(len(types))], Start: start, End: start + 1 + random.IntN(10), Score: scores[random.IntN(len(scores))]},
				Recognizer: []string{"first", "second"}[random.IntN(2)],
			}
		}
		require.Equal(t, removeDuplicatesByScan(findings), removeDuplicates(findings))
	}
}
