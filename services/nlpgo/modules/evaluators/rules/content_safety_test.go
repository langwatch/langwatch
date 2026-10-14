package rules_test

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
)

// The contexts spread over the prompt's 10000-character pieces as
// langevals_azure's slicing spread them, empty shares included.
func TestPromptShieldBatchesSpreadContextsAsLangevals(t *testing.T) {
	prompt := strings.Repeat("a", 25000)
	cases := []struct {
		name     string
		contexts []string
		want     [][]string
	}{
		{"five over three", []string{"1", "2", "3", "4", "5"}, [][]string{{"1", "2"}, {"3", "4"}, {"5"}}},
		{"one over three", []string{"1"}, [][]string{{"1"}, {}, {}}},
		{"none", nil, [][]string{{}, {}, {}}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			batches := rules.PromptShieldBatches(prompt, c.contexts)
			assert.Len(t, batches, 3)
			for i, batch := range batches {
				assert.Len(t, batch.Documents, len(c.want[i]))
				if len(c.want[i]) > 0 {
					assert.Equal(t, c.want[i], batch.Documents)
				}
			}
			assert.Len(t, batches[2].UserPrompt, 5000)
		})
	}
	short := rules.PromptShieldBatches("hi", []string{"1", "2"})
	assert.Equal(t, []rules.PromptShieldBatch{{UserPrompt: "hi", Documents: []string{"1", "2"}}}, short)
}
