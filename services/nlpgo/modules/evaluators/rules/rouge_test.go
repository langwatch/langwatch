package rules

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
)

// Values from rouge-score 0.1.2 with nltk 3.10's Porter stemmer.
func TestROUGEMatchesRougeScore(t *testing.T) {
	rouge := func(reference, response string, settings RagasROUGEScoreSettings) float64 {
		score, err := ROUGE(context.Background(), ROUGETexts{Reference: reference, Response: response}, settings)
		assert.NoError(t, err)
		return score
	}
	rouge1 := RagasROUGEScoreSettings{RougeType: "rouge1", MeasureType: "fmeasure"}
	assert.InDelta(t, 0.5, rouge("the cats running quickly", "a cat runs quick", rouge1), 1e-15)
	assert.InDelta(t, 1.0, rouge("İstanbul is big", "i stanbul is big", rouge1), 1e-15)
	rougeL := RagasROUGEScoreSettings{RougeType: "rougeL", MeasureType: "recall"}
	assert.Zero(t, rouge("", "", rougeL))
}

func TestRougeTokensMatchRougeScore(t *testing.T) {
	assert.Equal(t, []string{"i", "stanbul", "g", "n", "ralis", "run"}, rougeTokens("İstanbul Généralisation running"))
}

func TestPorterStemMatchesNLTK(t *testing.T) {
	for word, want := range map[string]string{
		"skies": "sky", "dying": "die", "innings": "inning", "news": "news",
		"ties": "tie", "spied": "spi", "died": "die", "hopping": "hop", "sized": "size",
		"generalization": "gener", "radically": "radic", "phraseology": "phraseolog",
		"happy": "happi", "controll": "control", "yyyy": "yyyi", "agreed": "agre", //nolint:misspell // a stemmer input
	} {
		assert.Equal(t, want, porterStem(word), word)
	}
}
