package rules

import (
	"context"
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// The non-LLM ragas context metrics (ragas 0.4.3 NonLLMContextPrecisionWithReference
// and NonLLMContextRecall over rapidfuzz 3.14.5 distances), with the
// langevals wrappers' empty-list rules. Reference:
// dev/docs/plans/langevals-go/ragas-0.4.3-reference.md §4.1-4.4.

// MaxComparisonCells caps the character (or token) pairs one entry may
// compare: about a third of a second of one core; larger inputs are refused.
const MaxComparisonCells = 100_000_000

// ErrComparisonTooLarge refuses an entry whose texts would compare more than
// MaxComparisonCells pairs.
var ErrComparisonTooLarge = errors.New("the texts are too long to compare: shorten the contexts or the expected contexts")

// ContextPrecision is ragas/context_precision: its score and its details, ""
// when the Python returns none.
func ContextPrecision(ctx context.Context, retrieved, expected []string, measure string) (score float64, details string, err error) {
	switch {
	case len(expected) == 0 && len(retrieved) == 0:
		return 1, "No contexts retrieved, but also no contexts expected, so that's a perfect precision of 1", nil
	case len(expected) == 0:
		return 0, "No contexts expected, yet some were retrieved, precision is 0", nil
	case len(retrieved) == 0:
		return 0, "No contexts retrieved, precision is 0", nil
	}
	if err := checkComparisonSize(retrieved, expected); err != nil {
		return 0, "", err
	}
	score, err = averagePrecision(ctx, retrieved, expected, measure)
	return score, "", err
}

// ContextRecall is ragas/context_recall: its score and its details, "" when
// the Python returns none.
func ContextRecall(ctx context.Context, retrieved, expected []string, measure string) (score float64, details string, err error) {
	switch {
	case len(expected) == 0 && len(retrieved) == 0:
		return 1, "No contexts retrieved, but also no contexts expected, so that's a perfect recall of 1", nil
	case len(expected) == 0:
		return 1, "No contexts expected, meaning nothing was missing, so that's a perfect recall of 1", nil
	case len(retrieved) == 0:
		return 0, "No contexts retrieved, recall is 0", nil
	}
	if err := checkComparisonSize(retrieved, expected); err != nil {
		return 0, "", err
	}
	score, err = recallHits(ctx, retrieved, expected, measure)
	return score, "", err
}

// ContextF1 is ragas/context_f1: the harmonic mean of the wrapper's own
// precision and recall, with its "Precision: p, Recall: r" details.
func ContextF1(ctx context.Context, retrieved, expected []string, measure string) (score float64, details string, err error) {
	precision, recall := 0.0, 0.0
	switch {
	case len(expected) == 0 && len(retrieved) == 0:
		precision, recall = 1, 1
	case len(expected) == 0:
		recall = 1
	case len(retrieved) > 0:
		if err := checkComparisonSize(retrieved, expected); err != nil {
			return 0, "", err
		}
		if precision, err = averagePrecision(ctx, retrieved, expected, measure); err != nil {
			return 0, "", err
		}
		if recall, err = recallHits(ctx, retrieved, expected, measure); err != nil {
			return 0, "", err
		}
	}
	if precision+recall != 0 {
		score = 2 * (precision * recall) / (precision + recall)
	}
	return score, "Precision: " + pyFloatRepr(precision) + ", Recall: " + pyFloatRepr(recall), nil
}

// checkComparisonSize refuses lists whose all-pairs comparison, the sum of
// |a|*|b| over every pair, exceeds MaxComparisonCells.
func checkComparisonSize(retrieved, expected []string) error {
	if comparisonCells(runeTotal(retrieved), runeTotal(expected)) > MaxComparisonCells {
		return ErrComparisonTooLarge
	}
	return nil
}

func runeTotal(texts []string) int {
	total := 0
	for _, text := range texts {
		total += utf8.RuneCountInString(text)
	}
	return total
}

// comparisonCells is a*b, saturating instead of overflowing.
func comparisonCells(a, b int) int {
	if a != 0 && b > math.MaxInt/a {
		return math.MaxInt
	}
	return a * b
}

// averagePrecision keeps a retrieved context when its best similarity is >= 0.5
// and averages precision over the kept ranks, with ragas' 1e-10 epsilon.
func averagePrecision(ctx context.Context, retrieved, expected []string, measure string) (float64, error) {
	similarity := similarityFunc(measure)
	kept, numerator := 0, 0.0
	for i, text := range retrieved {
		best, err := bestSimilarity(ctx, similarity, text, expected)
		if err != nil {
			return 0, err
		}
		if best >= 0.5 {
			kept++
			numerator += float64(kept) / float64(i+1)
		}
	}
	return numerator / (float64(kept) + 1e-10), nil
}

// recallHits is the share of expected contexts whose best similarity over the
// retrieved ones is strictly above 0.5.
func recallHits(ctx context.Context, retrieved, expected []string, measure string) (float64, error) {
	similarity := similarityFunc(measure)
	hits := 0
	for _, want := range expected {
		best, err := bestSimilarity(ctx, similarity, want, retrieved)
		if err != nil {
			return 0, err
		}
		if best > 0.5 {
			hits++
		}
	}
	return float64(hits) / float64(len(expected)), nil
}

func bestSimilarity(ctx context.Context, similarity similarityMeasure, one string, others []string) (float64, error) {
	a := []rune(one)
	best := 0.0
	for i, other := range others {
		s, err := similarity(ctx, a, []rune(other))
		if err != nil {
			return 0, err
		}
		if i == 0 || s > best {
			best = s
		}
	}
	return best, nil
}

// similarityMeasure is 1 - a normalized distance. It answers ctx's error
// when ctx ends mid-comparison.
type similarityMeasure func(ctx context.Context, a, b []rune) (float64, error)

// similarityFunc maps a distance_measure to 1 - rapidfuzz's normalized
// distance; the settings enum admits only these four.
func similarityFunc(measure string) similarityMeasure {
	switch measure {
	case "hamming":
		return hammingSimilarity
	case "jaro":
		return jaroSimilarity
	case "jaro_winkler":
		return jaroWinklerSimilarity
	default:
		return levenshteinSimilarity
	}
}

func levenshteinSimilarity(ctx context.Context, a, b []rune) (float64, error) {
	longest := max(len(a), len(b))
	if longest == 0 {
		return 1, nil
	}
	distance, err := levenshtein(ctx, a, b)
	if err != nil {
		return 0, err
	}
	return 1 - float64(distance)/float64(longest), nil
}

func levenshtein(ctx context.Context, a, b []rune) (int, error) {
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i, ca := range a {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		cur[0] = i + 1
		for j, cb := range b {
			substitute := prev[j]
			if ca != cb {
				substitute++
			}
			cur[j+1] = min(prev[j+1]+1, cur[j]+1, substitute)
		}
		prev, cur = cur, prev
	}
	return prev[len(b)], nil
}

// hammingSimilarity pads the shorter side: the length gap counts as mismatches.
func hammingSimilarity(_ context.Context, a, b []rune) (float64, error) {
	longest := max(len(a), len(b))
	if longest == 0 {
		return 1, nil
	}
	mismatches := longest - min(len(a), len(b))
	for i := range min(len(a), len(b)) {
		if a[i] != b[i] {
			mismatches++
		}
	}
	return 1 - float64(mismatches)/float64(longest), nil
}

func jaroSimilarity(ctx context.Context, a, b []rune) (float64, error) {
	if len(a) == 0 && len(b) == 0 {
		return 1, nil
	}
	if len(a) == 0 || len(b) == 0 {
		return 0, nil
	}
	if len(a) > len(b) {
		a, b = b, a
	}
	aSeq, bSeq, err := jaroMatches(ctx, a, b)
	if err != nil || len(aSeq) == 0 {
		return 0, err
	}
	transpositions := 0
	for i := range aSeq {
		if aSeq[i] != bSeq[i] {
			transpositions++
		}
	}
	m := float64(len(aSeq))
	return (m/float64(len(a)) + m/float64(len(b)) + (m-float64(transpositions/2))/m) / 3, nil
}

// jaroMatches matches each rune of the shorter a greedily, left to right, to
// the first unmatched equal rune of b inside the window, and answers both
// sides' matched runes in their own order.
func jaroMatches(ctx context.Context, a, b []rune) (aSeq, bSeq []rune, err error) {
	bound := max(len(b)/2-1, 0)
	bMatched := make([]bool, len(b))
	for i, ca := range a {
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}
		for j := max(0, i-bound); j < min(len(b), i+bound+1); j++ {
			if !bMatched[j] && b[j] == ca {
				bMatched[j] = true
				aSeq = append(aSeq, ca)
				break
			}
		}
	}
	for j, matched := range bMatched {
		if matched {
			bSeq = append(bSeq, b[j])
		}
	}
	return aSeq, bSeq, nil
}

// jaroWinklerSimilarity boosts a Jaro above 0.7 by the common prefix, capped
// at 4, with rapidfuzz's prefix weight 0.1.
func jaroWinklerSimilarity(ctx context.Context, a, b []rune) (float64, error) {
	s, err := jaroSimilarity(ctx, a, b)
	if err != nil || s <= 0.7 {
		return s, err
	}
	prefix := 0
	for prefix < min(len(a), len(b), 4) && a[prefix] == b[prefix] {
		prefix++
	}
	return s + float64(prefix)*0.1*(1-s), nil
}

// pyFloatRepr is Python's repr of a finite float: shortest round trip, ".0"
// on whole numbers, exponent form outside [1e-4, 1e16).
func pyFloatRepr(f float64) string {
	if f != 0 && (math.Abs(f) < 1e-4 || math.Abs(f) >= 1e16) {
		return strconv.FormatFloat(f, 'e', -1, 64)
	}
	fixed := strconv.FormatFloat(f, 'f', -1, 64)
	if strings.Contains(fixed, ".") {
		return fixed
	}
	return fixed + ".0"
}
