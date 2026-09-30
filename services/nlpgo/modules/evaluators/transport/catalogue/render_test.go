package catalogue_test

import (
	"bytes"
	"os"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/transport/catalogue"
)

const committedCatalogue = "../../../../../../modules/evaluator/contract/src/evaluators.generated.ts"

// @scenario "The generated catalogue matches the one langevals generated"
func TestRenderMatchesTheCommittedCatalogue(t *testing.T) {
	committed, err := os.ReadFile(committedCatalogue)
	require.NoError(t, err)

	rendered := catalogue.Render(rules.Definitions())

	if !bytes.Equal(rendered, committed) {
		t.Fatalf("rendered catalogue differs from %s; run go generate and diff", committedCatalogue)
	}
}

// @scenario "Every evaluator in the catalogue has a Go definition"
func TestEveryCatalogueSlugHasADefinition(t *testing.T) {
	committed, err := os.ReadFile(committedCatalogue)
	require.NoError(t, err)
	slugs := regexp.MustCompile(`(?m)^  "([a-z_]+/[a-z0-9_]+)": \{$`).FindAllStringSubmatch(string(committed), -1)
	require.NotEmpty(t, slugs)

	defined := map[string]rules.Definition{}
	for _, definition := range rules.Definitions() {
		defined[definition.Slug] = definition
	}
	for _, slug := range slugs {
		definition, ok := defined[slug[1]]
		if assert.True(t, ok, "no Go definition for %s", slug[1]) {
			assert.NotNil(t, definition.DefaultSettings, "%s has no settings", slug[1])
		}
	}
	assert.Len(t, defined, len(slugs))
}
