package cmd

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func writeCatalogFile(t *testing.T, dir, contents string) {
	t.Helper()
	require.NoError(t, os.WriteFile(filepath.Join(dir, "model-catalog.json"), []byte(contents), 0o600))
}

// @scenario "The engine reads the catalog the image ships with"
func TestLoadModelCatalog_ReadsTheConfiguredDirectory(t *testing.T) {
	dir := t.TempDir()
	writeCatalogFile(t, dir, `{"models":{"openai/acme-reasoner":{"outputTokensParameter":"max_completion_tokens"}}}`)

	catalog := loadModelCatalog(zap.NewNop(), dir)

	require.NotNil(t, catalog)
	param, known := catalog.OutputTokensParameter("openai/acme-reasoner")
	assert.True(t, known)
	assert.Equal(t, "max_completion_tokens", param)
}

func TestLoadModelCatalog_FallsBackToTheCheckout(t *testing.T) {
	catalog := loadModelCatalog(zap.NewNop(), "")

	require.NotNil(t, catalog)
	_, known := catalog.OutputTokensParameter("openai/gpt-6-astra")
	assert.True(t, known)
}

func TestLoadModelCatalog_ADirectoryWithoutTheCatalogLoadsNone(t *testing.T) {
	assert.Nil(t, loadModelCatalog(zap.NewNop(), t.TempDir()))
}

func TestLoadModelCatalog_AnUnreadableCatalogLoadsNone(t *testing.T) {
	dir := t.TempDir()
	writeCatalogFile(t, dir, `{"models":`)

	assert.Nil(t, loadModelCatalog(zap.NewNop(), dir))
}
