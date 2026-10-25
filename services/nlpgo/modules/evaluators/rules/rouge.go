package rules

import (
	"context"
	"strings"
	"unicode"
)

// ROUGE is ragas' RougeScore: rouge-score 0.1.2's RougeScorer with the Porter
// stemmer, target the reference and prediction the response.
// Reference: dev/docs/plans/langevals-go/ragas-0.4.3-reference.md §4.6.
// rougeL compares token pairs and is refused past MaxComparisonCells.
func ROUGE(ctx context.Context, texts ROUGETexts, settings RagasROUGEScoreSettings) (float64, error) {
	target, prediction := rougeTokens(texts.Reference), rougeTokens(texts.Response)
	overlap, err := rougeOverlap(ctx, settings.RougeType, rougeTokenPair{target: target, prediction: prediction})
	if err != nil || overlap == 0 {
		return 0, err
	}
	precision := float64(overlap) / float64(max(len(prediction), 1))
	recall := float64(overlap) / float64(max(len(target), 1))
	switch settings.MeasureType {
	case "precision":
		return precision, nil
	case "recall":
		return recall, nil
	}
	return 2 * precision * recall / (precision + recall), nil
}

// rougeTokens is rouge_score's tokenize with a stemmer: lowercase, every run
// outside [a-z0-9] a separator, tokens longer than 3 stemmed.
func rougeTokens(text string) []string {
	tokens := strings.FieldsFunc(pyLower(text), func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	})
	for i, token := range tokens {
		if len(token) > 3 {
			tokens[i] = porterStem(token)
		}
	}
	return tokens
}

// pyLower is str.lower() where it matters here: only runes lowering to ASCII
// survive tokenizing, and U+0130 lowers to "i" plus a combining dot.
func pyLower(text string) string {
	return strings.Map(unicode.ToLower, strings.ReplaceAll(text, "İ", "i̇"))
}

// ROUGETexts are what ROUGE compares: the reference and the response.
type ROUGETexts struct {
	Reference, Response string
}

type rougeTokenPair struct {
	target, prediction []string
}

// rougeOverlap is the matched token count rouge1 or rougeL scores over.
func rougeOverlap(ctx context.Context, rougeType string, tokens rougeTokenPair) (int, error) {
	target, prediction := tokens.target, tokens.prediction
	if rougeType != "rougeL" {
		return unigramOverlap(target, prediction), nil
	}
	if len(target) == 0 || len(prediction) == 0 {
		return 0, nil
	}
	if comparisonCells(len(target), len(prediction)) > MaxComparisonCells {
		return 0, ErrComparisonTooLarge
	}
	return longestCommonSubsequence(ctx, target, prediction)
}

func unigramOverlap(target, prediction []string) int {
	predicted := map[string]int{}
	for _, token := range prediction {
		predicted[token]++
	}
	overlap := 0
	for _, token := range target {
		if predicted[token] > 0 {
			predicted[token]--
			overlap++
		}
	}
	return overlap
}

func longestCommonSubsequence(ctx context.Context, a, b []string) (int, error) {
	prev := make([]int, len(b)+1)
	cur := make([]int, len(b)+1)
	for i := range a {
		if err := ctx.Err(); err != nil {
			return 0, err
		}
		for j := range b {
			if a[i] == b[j] {
				cur[j+1] = prev[j] + 1
			} else {
				cur[j+1] = max(prev[j+1], cur[j])
			}
		}
		prev, cur = cur, prev
	}
	return prev[len(b)], nil
}
