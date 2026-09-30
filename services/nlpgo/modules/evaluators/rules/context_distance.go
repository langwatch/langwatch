package rules

import (
	"math"
	"strconv"
	"strings"
)

// The non-LLM ragas context metrics (ragas 0.4.3 NonLLMContextPrecisionWithReference
// and NonLLMContextRecall over rapidfuzz 3.14.5 distances), with the
// langevals wrappers' empty-list rules. Reference:
// dev/docs/plans/langevals-go/ragas-0.4.3-reference.md §4.1-4.4.

// ContextPrecision is ragas/context_precision: its score and its details, ""
// when the Python returns none.
func ContextPrecision(retrieved, expected []string, measure string) (score float64, details string) {
	switch {
	case len(expected) == 0 && len(retrieved) == 0:
		return 1, "No contexts retrieved, but also no contexts expected, so that's a perfect precision of 1"
	case len(expected) == 0:
		return 0, "No contexts expected, yet some were retrieved, precision is 0"
	case len(retrieved) == 0:
		return 0, "No contexts retrieved, precision is 0"
	}
	return averagePrecision(retrieved, expected, measure), ""
}

// ContextRecall is ragas/context_recall: its score and its details, "" when
// the Python returns none.
func ContextRecall(retrieved, expected []string, measure string) (score float64, details string) {
	switch {
	case len(expected) == 0 && len(retrieved) == 0:
		return 1, "No contexts retrieved, but also no contexts expected, so that's a perfect recall of 1"
	case len(expected) == 0:
		return 1, "No contexts expected, meaning nothing was missing, so that's a perfect recall of 1"
	case len(retrieved) == 0:
		return 0, "No contexts retrieved, recall is 0"
	}
	return recallHits(retrieved, expected, measure), ""
}

// ContextF1 is ragas/context_f1: the harmonic mean of the wrapper's own
// precision and recall, with its "Precision: p, Recall: r" details.
func ContextF1(retrieved, expected []string, measure string) (score float64, details string) {
	precision, recall := 0.0, 0.0
	switch {
	case len(expected) == 0 && len(retrieved) == 0:
		precision, recall = 1, 1
	case len(expected) == 0:
		recall = 1
	case len(retrieved) > 0:
		precision = averagePrecision(retrieved, expected, measure)
		recall = recallHits(retrieved, expected, measure)
	}
	if precision+recall != 0 {
		score = 2 * (precision * recall) / (precision + recall)
	}
	return score, "Precision: " + pyFloatRepr(precision) + ", Recall: " + pyFloatRepr(recall)
}

// averagePrecision keeps a retrieved context when its best similarity is >= 0.5
// and averages precision over the kept ranks, with ragas' 1e-10 epsilon.
func averagePrecision(retrieved, expected []string, measure string) float64 {
	similarity := similarityFunc(measure)
	kept, numerator := 0, 0.0
	for i, context := range retrieved {
		if bestSimilarity(similarity, context, expected) >= 0.5 {
			kept++
			numerator += float64(kept) / float64(i+1)
		}
	}
	return numerator / (float64(kept) + 1e-10)
}

// recallHits is the share of expected contexts whose best similarity over the
// retrieved ones is strictly above 0.5.
func recallHits(retrieved, expected []string, measure string) float64 {
	similarity := similarityFunc(measure)
	hits := 0
	for _, want := range expected {
		if bestSimilarity(similarity, want, retrieved) > 0.5 {
			hits++
		}
	}
	return float64(hits) / float64(len(expected))
}

func bestSimilarity(similarity func(a, b []rune) float64, one string, others []string) float64 {
	a := []rune(one)
	best := 0.0
	for i, other := range others {
		if s := similarity(a, []rune(other)); i == 0 || s > best {
			best = s
		}
	}
	return best
}

// similarityFunc maps a distance_measure to 1 - rapidfuzz's normalized
// distance; the settings enum admits only these four.
func similarityFunc(measure string) func(a, b []rune) float64 {
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

func levenshteinSimilarity(a, b []rune) float64 {
	longest := max(len(a), len(b))
	if longest == 0 {
		return 1
	}
	return 1 - float64(levenshtein(a, b))/float64(longest)
}

func levenshtein(a, b []rune) int {
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i, ca := range a {
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
	return prev[len(b)]
}

// hammingSimilarity pads the shorter side: the length gap counts as mismatches.
func hammingSimilarity(a, b []rune) float64 {
	longest := max(len(a), len(b))
	if longest == 0 {
		return 1
	}
	mismatches := longest - min(len(a), len(b))
	for i := range min(len(a), len(b)) {
		if a[i] != b[i] {
			mismatches++
		}
	}
	return 1 - float64(mismatches)/float64(longest)
}

func jaroSimilarity(a, b []rune) float64 {
	if len(a) == 0 && len(b) == 0 {
		return 1
	}
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	if len(a) > len(b) {
		a, b = b, a
	}
	aSeq, bSeq := jaroMatches(a, b)
	if len(aSeq) == 0 {
		return 0
	}
	transpositions := 0
	for i := range aSeq {
		if aSeq[i] != bSeq[i] {
			transpositions++
		}
	}
	m := float64(len(aSeq))
	return (m/float64(len(a)) + m/float64(len(b)) + (m-float64(transpositions/2))/m) / 3
}

// jaroMatches matches each rune of the shorter a greedily, left to right, to
// the first unmatched equal rune of b inside the window, and answers both
// sides' matched runes in their own order.
func jaroMatches(a, b []rune) (aSeq, bSeq []rune) {
	bound := max(len(b)/2-1, 0)
	bMatched := make([]bool, len(b))
	for i, ca := range a {
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
	return aSeq, bSeq
}

// jaroWinklerSimilarity boosts a Jaro above 0.7 by the common prefix, capped
// at 4, with rapidfuzz's prefix weight 0.1.
func jaroWinklerSimilarity(a, b []rune) float64 {
	s := jaroSimilarity(a, b)
	if s <= 0.7 {
		return s
	}
	prefix := 0
	for prefix < min(len(a), len(b), 4) && a[prefix] == b[prefix] {
		prefix++
	}
	return s + float64(prefix)*0.1*(1-s)
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
