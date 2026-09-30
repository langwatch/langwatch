package rules

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/contract"
)

func findingScores(matches []PIIMatch) []float64 {
	scores := make([]float64, len(matches))
	for i, m := range matches {
		scores[i] = m.Score
	}
	return scores
}

// @scenario "Context words raise a finding's score as Presidio's do"
func TestPIIContextWordsRaiseScores(t *testing.T) {
	p := NewPIIPatterns()
	ip := []contract.EntityType{"IP_ADDRESS"}
	assert.Equal(t, []float64{0.6}, findingScores(p.Analyze("See 10.1.2.3 now", ip)))
	assert.Equal(t, []float64{0.95}, findingScores(p.Analyze("The server ip is 10.1.2.3", ip)), "base plus 0.35")
	license := []contract.EntityType{"US_DRIVER_LICENSE"}
	assert.Equal(t, []float64{0.4}, findingScores(p.Analyze("My driver license number is 12345678 ok", license)), "floored at 0.4")
	phone := []contract.EntityType{"PHONE_NUMBER"}
	assert.Equal(t, []float64{0.4}, findingScores(p.Analyze("phone alpha beta gamma delta epsilon zeta +1 650-253-0000", phone)), "outside the window")
	assert.Equal(t, []float64{0.75}, findingScores(p.Analyze("phone alpha beta gamma delta +1 650-253-0000", phone)), "inside the window, the match token counting as one")
}

// @scenario "A checksum failure is not a finding"
func TestPIIChecksumFailureIsNotAFinding(t *testing.T) {
	p := NewPIIPatterns()
	for _, c := range []struct {
		entity       contract.EntityType
		valid, wrong string
	}{
		{"CREDIT_CARD", "4111 1111 1111 1111", "4111 1111 1111 1112"},
		{"IBAN_CODE", "GB82 WEST 1234 5698 7654 32", "GB83 WEST 1234 5698 7654 32"},
		{"MEDICAL_LICENSE", "AB1234563", "AB1234564"},
		{"UK_NHS", "943 476 5919", "943 476 5918"},
		{"CRYPTO", "1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "1BoatSLRHtKNngkdXEeobR76b53LETtpyA"},
		{"CRYPTO", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdx"},
		{"EMAIL_ADDRESS", "john@example.com", "john@example.invalidtld"},
	} {
		entities := []contract.EntityType{c.entity}
		assert.Equal(t, []float64{1}, findingScores(p.Analyze("value "+c.valid+" end", entities)), c.valid)
		assert.Empty(t, p.Analyze("value "+c.wrong+" end", entities), c.wrong)
	}
}

// @scenario "The anonymised text replaces each finding with its entity type, as Presidio's does"
func TestPIIAnonymizeReplacesFindingsWithTheirType(t *testing.T) {
	text := "mail a@example.com  b@example.com, card 4111"
	findings := []contract.PIIFinding{
		{EntityType: "EMAIL_ADDRESS", Start: 5, End: 18, Score: 1},
		{EntityType: "EMAIL_ADDRESS", Start: 20, End: 33, Score: 1},
		{EntityType: "CREDIT_CARD", Start: 40, End: 44, Score: 0.3},
		{EntityType: "US_BANK_NUMBER", Start: 41, End: 44, Score: 0.9},
	}
	assert.Equal(t, "mail <EMAIL_ADDRESS>, card <CREDIT_CARD>", Anonymize(text, findings), "spaces merge, contained drops")
	overlap := []contract.PIIFinding{{EntityType: "A", Start: 0, End: 6, Score: 1}, {EntityType: "B", Start: 3, End: 9, Score: 1}}
	assert.Equal(t, "<A><B>!", Anonymize("abcdefghi!", overlap))
	json := PIIContent{Text: "a\nb", IsJSON: true}
	assert.Equal(t, `a\n<X>`, json.Escaped(Anonymize(json.Text, []contract.PIIFinding{{EntityType: "X", Start: 2, End: 3, Score: 1}})))
}

func TestPIIContentCountsCharactersNotBytes(t *testing.T) {
	text := strings.Repeat("é", PIIMaxContentChars)
	assert.False(t, PIIContent{Text: text}.TooLong())
	assert.True(t, PIIContent{Text: text + "é"}.TooLong())
}
