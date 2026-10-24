package rules

import (
	"fmt"
	"math"
)

// CosineSimilarity is numpy's dot(a, b) / (norm(a) * norm(b)).
func CosineSimilarity(a, b []float64) float64 {
	var dot, normA, normB float64
	for i := range min(len(a), len(b)) {
		dot += a[i] * b[i]
		normA += a[i] * a[i]
		normB += b[i] * b[i]
	}
	return dot / (math.Sqrt(normA) * math.Sqrt(normB))
}

// SimilarityContent is the entry field the settings compare against the value.
func SimilarityContent(settings CustomSimilaritySettings, input, output *string) string {
	if settings.Field == FieldInput {
		return textOf(input)
	}
	return textOf(output)
}

// SimilarityVerdict passes when the similarity is on the rule's side of the
// threshold. The details keep langevals' stray closing quote.
func SimilarityVerdict(settings CustomSimilaritySettings, similarity float64) (passed bool, details string) {
	op := "<"
	passed = similarity < settings.Threshold
	if settings.Rule == "is_similar_to" {
		op = ">"
		passed = similarity > settings.Threshold
	}
	//nolint:gocritic // langevals quotes the value raw; %q would escape it
	details = fmt.Sprintf(`Cosine similarity of %.2f between %s and "%s" (threshold: %s %s)"`,
		similarity, settings.Field, settings.Value, op, pyFloatRepr(settings.Threshold))
	return passed, details
}
