package ciguard_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ciguard"
)

// The pr.yml filter for the codeql call is generated from codeql.yml's own
// detect-changes paths, so reading it covers both.
// @scenario "CodeQL on a pull request runs only for workflow, auth and billing changes"
func TestCodeQLRunsOnPullRequestsOnlyForWorkflowAuthAndBillingPaths(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	raw, err := os.ReadFile(filepath.Join(root, ciguard.PRFiltersFile))
	require.NoError(t, err)
	var filters map[string][]string
	require.NoError(t, yaml.Unmarshal(raw, &filters))

	codeql := filters["codeql"]
	for _, wide := range []string{"apps/**", "packages/**", "modules/**", "enterprise/**", "docs/**", "specs/**", "sdks/python/**"} {
		assert.NotContains(t, codeql, wide)
	}
	for _, kept := range []string{".github/**", "modules/auth/**", "modules/authz/**", "enterprise/modules/billing/**", "enterprise/modules/sso/**"} {
		assert.Contains(t, codeql, kept)
	}

	workflow, err := ciscan.Load(root, ".github/workflows/codeql.yml")
	require.NoError(t, err)
	complete, ok := workflow.Jobs["codeql-complete"]
	require.True(t, ok, "codeql.yml has no codeql-complete aggregator")
	assert.Contains(t, complete.If, "always()")
}
