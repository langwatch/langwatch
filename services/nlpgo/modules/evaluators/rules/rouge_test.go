package rules

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// Values from rouge-score 0.1.2 with nltk 3.10's Porter stemmer.
func TestROUGEMatchesRougeScore(t *testing.T) {
	rouge1 := RagasROUGEScoreSettings{RougeType: "rouge1", MeasureType: "fmeasure"}
	assert.InDelta(t, 0.5, ROUGE("the cats running quickly", "a cat runs quick", rouge1), 1e-15)
	assert.InDelta(t, 1.0, ROUGE("İstanbul is big", "i stanbul is big", rouge1), 1e-15)
	rougeL := RagasROUGEScoreSettings{RougeType: "rougeL", MeasureType: "recall"}
	assert.Zero(t, ROUGE("", "", rougeL))
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
