package rules

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Expected values are the reference's, computed by ragas 0.4.3 (§3).
func TestRagasScoresMatchRagasArithmetic(t *testing.T) {
	assert.InDelta(t, 0.8333333332916666, RagasAveragePrecision([]int64{1, 0, 1}), 1e-16)
	assert.InDelta(t, 0.5833333333041666, RagasAveragePrecision([]int64{0, 1, 1}), 1e-16)
	assert.InDelta(t, 0.9999999999, RagasAveragePrecision([]int64{1}), 1e-16)
	assert.Zero(t, RagasAveragePrecision(nil))

	qa, conciseness, ok := RagasSummarizationScores([]string{"1", "0"}, "long text here", "short")
	assert.True(t, ok)
	assert.InDelta(t, 0.5714285714298469, qa*0.5+conciseness*0.5, 1e-16)
	_, _, ok = RagasSummarizationScores(nil, "text", "summary")
	assert.False(t, ok)

	assert.InDelta(t, 0.67, RagasFactualCorrectness("f1", []bool{true, false}, []bool{true}), 1e-12)
	assert.InDelta(t, 0.5, RagasFactualCorrectness("precision", []bool{true, false}, nil), 1e-12)
	assert.Zero(t, RagasFactualCorrectness("f1", []bool{false}, []bool{false}))

	_, ok = RagasShareNonZero(nil)
	assert.False(t, ok)
}

func TestRagasNumpyArrayStringPrintsAsNumpy(t *testing.T) {
	assert.Equal(t, "[ 0.2260137  -0.05337068  0.57098413]", RagasNumpyArrayString([]float64{0.22601370424117628, -0.05337068123, 0.570984131}))
	assert.Equal(t, "[0.2260137]", RagasNumpyArrayString([]float64{0.22601370424117628}))
	assert.Equal(t, "[1.  0.5]", RagasNumpyArrayString([]float64{1, 0.5}))
}
