package services_test

import "testing"

// @scenario "The ragas text metrics score as langevals scored"
func TestReplayRagasTextMetricsAnswerWhatLangevalsAnswered(t *testing.T) {
	for slug, file := range map[string]string{
		"ragas/bleu_score":        "ragas__bleu_score.json",
		"ragas/rouge_score":       "ragas__rouge_score.json",
		"ragas/context_precision": "ragas__context_precision.json",
		"ragas/context_recall":    "ragas__context_recall.json",
		"ragas/context_f1":        "ragas__context_f1.json",
	} {
		t.Run(slug, func(t *testing.T) {
			replayFixtures(t, slug, file, replayOptions{Tolerance: 1e-9})
		})
	}
}
