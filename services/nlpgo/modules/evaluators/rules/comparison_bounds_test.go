package rules

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type contextMetricFunc func(ctx context.Context, retrieved, expected []string, measure string) (float64, string, error)

var contextMetrics = map[string]contextMetricFunc{
	"context_precision": ContextPrecision,
	"context_recall":    ContextRecall,
	"context_f1":        ContextF1,
}

// @scenario "A context or ROUGE comparison too large to finish is refused as an entry error"
func TestAComparisonOverTheCapIsRefusedBeforeItRuns(t *testing.T) {
	// 20k runes a side is 4e8 cells, past the cap.
	side := strings.Repeat("a", 20_000)
	for name, metric := range contextMetrics {
		started := time.Now()
		_, _, err := metric(context.Background(), []string{side}, []string{side}, "levenshtein")
		require.ErrorIs(t, err, ErrComparisonTooLarge, name)
		assert.Less(t, time.Since(started), 100*time.Millisecond, name)
	}
	words := strings.Repeat("word ", 20_000)
	_, err := ROUGE(context.Background(), ROUGETexts{Reference: words, Response: words}, RagasROUGEScoreSettings{RougeType: "rougeL", MeasureType: "fmeasure"})
	require.ErrorIs(t, err, ErrComparisonTooLarge)
}

// The cap sums every pair: many short contexts cost what one long one does.
func TestTheComparisonCapCountsEveryPair(t *testing.T) {
	many := make([]string, 400)
	for i := range many {
		many[i] = strings.Repeat("b", 500)
	}
	// 400 contexts of 500 runes a side is 4e10 cells.
	_, _, err := ContextRecall(context.Background(), many, many, "jaro")
	require.ErrorIs(t, err, ErrComparisonTooLarge)
	_, _, err = ContextRecall(context.Background(), many[:10], many[:10], "jaro")
	require.NoError(t, err)
}

// @scenario "A context or ROUGE comparison stops at the evaluation deadline"
func TestAComparisonStopsWhenItsContextEnds(t *testing.T) {
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	side := strings.Repeat("ab", 2_500) // under the cap
	for name, metric := range contextMetrics {
		for _, measure := range []string{"levenshtein", "jaro", "jaro_winkler"} {
			_, _, err := metric(ctx, []string{side}, []string{side + "c"}, measure)
			require.ErrorIs(t, err, context.DeadlineExceeded, "%s %s", name, measure)
		}
	}
	words := strings.Repeat("word ", 2_500)
	_, err := ROUGE(ctx, ROUGETexts{Reference: words, Response: words + "other"}, RagasROUGEScoreSettings{RougeType: "rougeL", MeasureType: "fmeasure"})
	require.ErrorIs(t, err, context.DeadlineExceeded)
}
