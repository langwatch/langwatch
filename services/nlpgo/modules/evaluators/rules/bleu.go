package rules

import (
	"math"
	"regexp"
	"strings"
)

// BLEU is ragas' BleuScore: sacrebleu 2.6.0 corpus_bleu with its defaults
// (13a tokens, exp smoothing, 4-grams) over the ". "-split sentences. Only the
// first response sentence is scored, against every reference sentence as an
// alternative reference: sacrebleu transposes the streams ragas builds.
// Reference: dev/docs/plans/langevals-go/ragas-0.4.3-reference.md §4.5.
func BLEU(response, reference string) float64 {
	hypothesis := strings.Split(response, ". ")[0]
	refs := strings.Split(reference, ". ")
	refCounts := map[string]int{}
	refLens := make([]int, 0, len(refs))
	for _, ref := range refs {
		counts, length := wordNgrams(tokenize13a(ref))
		refLens = append(refLens, length)
		for gram, count := range counts {
			refCounts[gram] = max(refCounts[gram], count)
		}
	}
	hypCounts, hypLen := wordNgrams(tokenize13a(hypothesis))
	var stats bleuStats
	for gram, count := range hypCounts {
		order := strings.Count(gram, " ")
		stats.total[order] += count
		stats.correct[order] += min(count, refCounts[gram])
	}
	stats.sysLen, stats.refLen = hypLen, closestRefLen(hypLen, refLens)
	return stats.score() / 100
}

const bleuMaxOrder = 4

type bleuStats struct {
	correct, total [bleuMaxOrder]int
	sysLen, refLen int
}

// score is sacrebleu's compute_bleu with smooth_method "exp" and
// effective_order off.
func (s bleuStats) score() float64 {
	if s.correct == [bleuMaxOrder]int{} {
		return 0
	}
	var precisions [bleuMaxOrder]float64
	smooth := 1.0
	for n := 0; n < bleuMaxOrder && s.total[n] != 0; n++ {
		if s.correct[n] == 0 {
			smooth *= 2
			precisions[n] = 100 / (smooth * float64(s.total[n]))
		} else {
			precisions[n] = 100 * float64(s.correct[n]) / float64(s.total[n])
		}
	}
	sum := 0.0
	for _, p := range precisions {
		sum += flooredLog(p)
	}
	return s.brevityPenalty() * math.Exp(sum/bleuMaxOrder)
}

func (s bleuStats) brevityPenalty() float64 {
	switch {
	case s.sysLen >= s.refLen:
		return 1
	case s.sysLen == 0:
		return 0
	}
	return math.Exp(1 - float64(s.refLen)/float64(s.sysLen))
}

// flooredLog is sacrebleu's my_log.
func flooredLog(x float64) float64 {
	if x == 0 {
		return -9999999999
	}
	return math.Log(x)
}

// closestRefLen picks the reference length nearest the hypothesis', the
// shorter on a tie.
func closestRefLen(hypLen int, refLens []int) int {
	closestDiff, closestLen := -1, -1
	for _, refLen := range refLens {
		diff := hypLen - refLen
		if diff < 0 {
			diff = -diff
		}
		if closestDiff == -1 || diff < closestDiff || (diff == closestDiff && refLen < closestLen) {
			closestDiff, closestLen = diff, refLen
		}
	}
	return closestLen
}

// wordNgrams counts the 1- to 4-grams of the tokens, each keyed by its
// space-joined words (tokens hold no spaces), and answers the token count.
func wordNgrams(tokens []string) (map[string]int, int) {
	counts := map[string]int{}
	for n := 1; n <= bleuMaxOrder; n++ {
		for i := 0; i+n <= len(tokens); i++ {
			counts[strings.Join(tokens[i:i+n], " ")]++
		}
	}
	return counts, len(tokens)
}

// The 13a post-tokenizer rules, in order (sacrebleu tokenizer_re.py).
var (
	bleuPunctuation    = regexp.MustCompile(`([\{-\~\[-\x60 -\&\(-\+\:-\@\/])`)
	bleuPeriodAfter    = regexp.MustCompile(`([^0-9])([\.,])`)
	bleuPeriodBefore   = regexp.MustCompile(`([\.,])([^0-9])`)
	bleuDashAfterDigit = regexp.MustCompile(`([0-9])(-)`)
)

// tokenize13a is sacrebleu's _preprocess_segment with the 13a tokenizer,
// answering the tokens its final split yields.
func tokenize13a(line string) []string {
	line = strings.TrimRightFunc(line, pyIsSpace)
	line = strings.ReplaceAll(line, "<skipped>", "")
	line = strings.ReplaceAll(line, "-\n", "")
	line = strings.ReplaceAll(line, "\n", " ")
	for _, entity := range [][2]string{{"&quot;", `"`}, {"&amp;", "&"}, {"&lt;", "<"}, {"&gt;", ">"}} {
		line = strings.ReplaceAll(line, entity[0], entity[1])
	}
	line = bleuPunctuation.ReplaceAllString(" "+line+" ", " ${1} ")
	line = bleuPeriodAfter.ReplaceAllString(line, "${1} ${2} ")
	line = bleuPeriodBefore.ReplaceAllString(line, " ${1} ${2}")
	line = bleuDashAfterDigit.ReplaceAllString(line, "${1} ${2} ")
	return strings.FieldsFunc(line, pyIsSpace)
}
