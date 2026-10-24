package rules

import "fmt"

// SentimentVectors are the embeddings of the input and the two references.
type SentimentVectors struct {
	Input    []float64
	Positive []float64
	Negative []float64
}

// SentimentVerdict places the input between the two references: the
// difference of its similarities to them, over the normalization factor,
// clamped to [-1, 1]. A zero factor divides by 1e-9, as langevals did.
func SentimentVerdict(vectors SentimentVectors, factor float64) (score float64, label, details string) {
	raw := CosineSimilarity(vectors.Input, vectors.Positive) - CosineSimilarity(vectors.Input, vectors.Negative)
	if factor == 0 {
		factor = 1e-9
	}
	score = max(-1.0, min(1.0, raw/factor))
	label = "positive"
	if raw < 0 {
		label = "negative"
	}
	return score, label, fmt.Sprintf("Sentiment: %s (score: %.2f)", label, score)
}
