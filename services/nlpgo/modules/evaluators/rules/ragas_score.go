package rules

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

// RagasMaxTokensHardLimit is langevals_core's MAX_TOKENS_HARD_LIMIT.
const RagasMaxTokensHardLimit = 1_048_576

// RagasShareNonZero is the share of non-zero verdicts, the Faithfulness and
// LLMContextRecall score; ok is false where Python's is NaN (no verdicts).
func RagasShareNonZero(verdicts []int64) (score float64, ok bool) {
	if len(verdicts) == 0 {
		return 0, false
	}
	hits := 0
	for _, v := range verdicts {
		if v != 0 {
			hits++
		}
	}
	return float64(hits) / float64(len(verdicts)), true
}

// RagasFactualCorrectness is FactualCorrectness' score: supported are the
// response claims the reference supports, covered the reference claims the
// response supports (unused in precision mode); rounded half-even to 0.01.
func RagasFactualCorrectness(mode string, supported, covered []bool) float64 {
	tp, fp, fn := ragasCount(supported, true), ragasCount(supported, false), 0
	if mode != "precision" {
		fn = ragasCount(covered, false)
	}
	var score float64
	switch mode {
	case "precision":
		score = float64(tp) / (float64(tp+fp) + 1e-8)
	case "recall":
		score = float64(tp) / (float64(tp+fn) + 1e-8)
	default:
		score = ragasF1(tp, fp, fn)
	}
	return math.RoundToEven(score*100) / 100
}

func ragasCount(values []bool, want bool) int {
	count := 0
	for _, v := range values {
		if v == want {
			count++
		}
	}
	return count
}

// ragasF1 is ragas' fbeta_score with beta 1.
func ragasF1(tp, fp, fn int) float64 {
	precision, recall := 0.0, 0.0
	if tp+fp != 0 {
		precision = float64(tp) / float64(tp+fp)
	}
	if tp+fn != 0 {
		recall = float64(tp) / float64(tp+fn)
	}
	if precision == 0 && recall == 0 {
		return 0
	}
	return 2 * (precision * recall) / (precision + recall)
}

// RagasAveragePrecision is LLMContextPrecision's rank-aware score, the 1e-10
// in its denominator included: no verdicts or none useful is 0.
func RagasAveragePrecision(verdicts []int64) float64 {
	hits := make([]int, len(verdicts))
	total := 0
	for i, v := range verdicts {
		if v != 0 {
			hits[i] = 1
		}
		total += hits[i]
	}
	numerator, seen := 0.0, 0
	for i, hit := range hits {
		seen += hit
		numerator += float64(seen) / float64(i+1) * float64(hit)
	}
	return numerator / (float64(total) + 1e-10)
}

// RagasCosineSimilarities is ResponseRelevancy's calculate_similarity: each
// generated question's cosine to the original, unclamped.
func RagasCosineSimilarities(question []float64, generated [][]float64) []float64 {
	questionNorm := numpyNorm(question)
	out := make([]float64, len(generated))
	for i, vector := range generated {
		dot := 0.0
		for j := range vector {
			dot += vector[j] * question[j]
		}
		out[i] = dot / (numpyNorm(vector) * questionNorm)
	}
	return out
}

// RagasMean is numpy's mean of a short vector.
func RagasMean(values []float64) float64 {
	return numpyPairwiseSum(values) / float64(len(values))
}

func numpyNorm(v []float64) float64 {
	squares := make([]float64, len(v))
	for i, x := range v {
		squares[i] = x * x
	}
	return math.Sqrt(numpyPairwiseSum(squares))
}

// numpyPairwiseSum is numpy's pairwise_sum: a plain loop under 8, eight
// accumulators up to 128, halves above.
func numpyPairwiseSum(a []float64) float64 {
	n := len(a)
	switch {
	case n < 8:
		sum := 0.0
		for _, x := range a {
			sum += x
		}
		return sum
	case n <= 128:
		return numpyBlockSum(a)
	default:
		half := n / 2
		half -= half % 8
		return numpyPairwiseSum(a[:half]) + numpyPairwiseSum(a[half:])
	}
}

// numpyBlockSum is pairwise_sum's eight accumulators over 8 to 128 values.
func numpyBlockSum(a []float64) float64 {
	var r [8]float64
	copy(r[:], a[:8])
	i := 8
	for ; i+8 <= len(a); i += 8 {
		for j := range r {
			r[j] += a[i+j]
		}
	}
	sum := ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]))
	for _, x := range a[i:] {
		sum += x
	}
	return sum
}

// RagasNumpyArrayString is str() of a 1-d float64 numpy array: at most 8
// fractional digits, integer parts right-aligned and fractions left-aligned.
// ponytail: positional form only; numpy's exponent form (values under 1e-4
// or spanning over 1000x) is not ported.
func RagasNumpyArrayString(values []float64) string {
	ints, fracs := make([]string, len(values)), make([]string, len(values))
	padLeft, padRight := 0, 0
	for i, v := range values {
		text := strconv.FormatFloat(v, 'f', -1, 64)
		if head, tail, _ := strings.Cut(text, "."); len(tail) > 8 {
			text = strings.TrimRight(strconv.FormatFloat(v, 'f', 8, 64), "0")
		} else if tail == "" {
			text = head + "."
		}
		ints[i], fracs[i], _ = strings.Cut(text, ".")
		padLeft, padRight = max(padLeft, len(ints[i])), max(padRight, len(fracs[i]))
	}
	parts := make([]string, len(values))
	for i := range values {
		parts[i] = strings.Repeat(" ", padLeft-len(ints[i])) + ints[i] + "." + fracs[i] + strings.Repeat(" ", padRight-len(fracs[i]))
	}
	return "[" + strings.Join(parts, " ") + "]"
}

// RagasSummarizationScores are SummarizationScore's QA score (answers that
// are "1", case-insensitive) and conciseness (in characters, 1e-10 guarded).
// ok is false for no answers, where Python divides by zero.
func RagasSummarizationScores(answers []string, text, summary string) (qa, conciseness float64, ok bool) {
	if len(answers) == 0 {
		return 0, 0, false
	}
	correct := 0
	for _, a := range answers {
		if strings.EqualFold(a, "1") {
			correct++
		}
	}
	textLen, summaryLen := utf8.RuneCountInString(text), utf8.RuneCountInString(summary)
	return float64(correct) / float64(len(answers)), 1 - float64(min(summaryLen, textLen))/(float64(textLen)+1e-10), true
}
