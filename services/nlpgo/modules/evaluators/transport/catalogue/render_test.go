package catalogue_test

import (
	"bytes"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/transport/catalogue"
)

const (
	contractSource     = "../../../../../../modules/evaluator/contract/src"
	committedCatalogue = contractSource + "/evaluators.generated.ts"
	oxfmt              = "../../../../../../node_modules/.bin/oxfmt"
)

// @scenario "The generated catalogue matches the one langevals generated"
func TestRenderMatchesTheCommittedCatalogue(t *testing.T) {
	if _, err := os.Stat(oxfmt); err != nil {
		t.Skipf("oxfmt is not installed at %s (pnpm install); go-ci's generated job checks the catalogue", oxfmt)
	}
	committed, err := os.ReadFile(committedCatalogue)
	require.NoError(t, err)

	binary, err := filepath.Abs(oxfmt)
	require.NoError(t, err)
	format := exec.Command(binary, "--stdin-filepath=evaluators.ts")
	format.Dir = contractSource
	format.Stdin = bytes.NewReader(catalogue.Render(rules.Definitions()))
	formatted, err := format.Output()
	require.NoError(t, err)

	if !bytes.Equal(formatted, committed) {
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
