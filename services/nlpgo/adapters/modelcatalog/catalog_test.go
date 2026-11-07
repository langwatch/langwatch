package modelcatalog

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeCatalog(t *testing.T, dir, name, models string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(dir, name), []byte(`{"models":`+models+`}`), 0o600))
}

// @scenario "The engine reads the catalog the image ships with"
func TestLoad_OverlayEntryWinsOverBaseEntry(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, baseFile, `{
		"openai/gpt-6-astra": {"outputTokensParameter": "max_completion_tokens"},
		"openai/gpt-4.1": {}
	}`)
	writeCatalog(t, dir, overlayFile, `{
		"openai/gpt-4.1": {"outputTokensParameter": "max_completion_tokens"}
	}`)

	catalog, err := Load(dir)
	require.NoError(t, err)

	param, known := catalog.OutputTokensParameter("openai/gpt-4.1")
	assert.True(t, known)
	assert.Equal(t, "max_completion_tokens", param)
}

// @scenario "The engine reads the catalog the image ships with"
func TestLoad_OverlayIsOptional(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, baseFile, `{"openai/gpt-4.1": {}}`)

	catalog, err := Load(dir)
	require.NoError(t, err)

	param, known := catalog.OutputTokensParameter("openai/gpt-4.1")
	assert.True(t, known)
	assert.Equal(t, "max_tokens", param)
}

func TestLoad_RefusesADirectoryWithoutTheCatalog(t *testing.T) {
	_, err := Load(t.TempDir())
	assert.Error(t, err)
}

func TestOutputTokensParameter(t *testing.T) {
	dir := t.TempDir()
	writeCatalog(t, dir, baseFile, `{
		"openai/gpt-6-astra": {"outputTokensParameter": "max_completion_tokens"},
		"openai/gpt-4o": {}
	}`)
	catalog, err := Load(dir)
	require.NoError(t, err)

	tests := []struct {
		name      string
		modelID   string
		wantParam string
		wantKnown bool
	}{
		{"a marked model", "openai/gpt-6-astra", "max_completion_tokens", true},
		{"an unmarked model", "openai/gpt-4o", "max_tokens", true},
		{"an Azure deployment of a marked model", "azure/gpt-6-astra", "max_completion_tokens", true},
		{"an Azure deployment of an unmarked model", "azure/gpt-4o", "max_tokens", true},
		{"a model the catalog does not carry", "openai/ft:gpt-4o:acme", "", false},
		{"a bare id", "gpt-6-astra", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			param, known := catalog.OutputTokensParameter(tt.modelID)
			assert.Equal(t, tt.wantKnown, known)
			assert.Equal(t, tt.wantParam, param)
		})
	}
}

func TestOutputTokensParameter_NilCatalogKnowsNothing(t *testing.T) {
	var catalog *Catalog
	_, known := catalog.OutputTokensParameter("openai/gpt-6-astra")
	assert.False(t, known)
}

// The checkout's committed catalog is what a development run reads.
func TestFindDir_LocatesTheCheckoutCatalog(t *testing.T) {
	wd, err := os.Getwd()
	require.NoError(t, err)

	dir, ok := FindDir(wd)
	require.True(t, ok)

	catalog, err := Load(dir)
	require.NoError(t, err)
	param, known := catalog.OutputTokensParameter("openai/gpt-6-astra")
	assert.True(t, known)
	assert.Equal(t, "max_completion_tokens", param)
}
