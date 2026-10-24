package rules

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Worked values of dev/docs/plans/langevals-go/ragas-0.4.3-reference.md §4.1,
// computed with rapidfuzz 3.14.5.
func TestStringSimilarityMatchesRapidfuzz(t *testing.T) {
	cases := []struct {
		a, b                                    string
		levenshtein, hamming, jaro, jaroWinkler float64
	}{
		{"abc", "abd", 0.666667, 0.666667, 0.777778, 0.822222},
		{"The Eiffel Tower is in Paris.", "The Eiffel Tower is located in Paris.", 0.783784, 0.540541, 0.904939, 0.942964},
		{"", "", 1, 1, 1, 1},
		{"a", "", 0, 0, 0, 0},
	}
	for _, tc := range cases {
		a, b := []rune(tc.a), []rune(tc.b)
		assert.InDelta(t, tc.levenshtein, similarityFunc("levenshtein")(a, b), 1e-6, "levenshtein %q", tc.a)
		assert.InDelta(t, tc.hamming, similarityFunc("hamming")(a, b), 1e-6, "hamming %q", tc.a)
		assert.InDelta(t, tc.jaro, similarityFunc("jaro")(a, b), 1e-6, "jaro %q", tc.a)
		assert.InDelta(t, tc.jaroWinkler, similarityFunc("jaro_winkler")(a, b), 1e-6, "jaro_winkler %q", tc.a)
	}
}

// "ab" against "ax" is exactly 0.5 by Levenshtein: precision keeps it (>=),
// recall does not (>).
func TestContextThresholdsDifferAtExactlyOneHalf(t *testing.T) {
	precision, _ := ContextPrecision([]string{"ab"}, []string{"ax"}, "levenshtein")
	recall, _ := ContextRecall([]string{"ab"}, []string{"ax"}, "levenshtein")
	assert.InDelta(t, 0.9999999999, precision, 1e-16)
	assert.Zero(t, recall)
}

func TestContextPrecisionIsRankAwareWithTheEpsilon(t *testing.T) {
	precision, details := ContextPrecision([]string{"same", "zzzzzzzz", "other"}, []string{"same", "other"}, "levenshtein")
	assert.InDelta(t, 0.8333333332916666, precision, 1e-16)
	assert.Empty(t, details)
}

func TestContextF1DetailsUsePythonFloatRepr(t *testing.T) {
	score, details := ContextF1([]string{"same", "zzzzzzzz", "other"}, []string{"same", "other", "missing!!"}, "levenshtein")
	assert.InDelta(t, 0.7407407407242798, score, 1e-15)
	assert.Equal(t, "Precision: 0.8333333332916666, Recall: 0.6666666666666666", details)
	_, details = ContextF1(nil, []string{"x"}, "jaro")
	assert.Equal(t, "Precision: 0.0, Recall: 0.0", details)
}

func TestPyFloatRepr(t *testing.T) {
	for value, want := range map[float64]string{
		1: "1.0", 0: "0.0", 0.5: "0.5", 1e-05: "1e-05", 0.0001: "0.0001",
		1e16: "1e+16", 123456789012345.0: "123456789012345.0", 0.9999999999: "0.9999999999",
	} {
		assert.Equal(t, want, pyFloatRepr(value))
	}
}
