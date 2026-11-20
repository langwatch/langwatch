package ciguard_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// goCIChangesFilters returns the path filters of go-ci's `changes` job, by filter name.
func goCIChangesFilters(t *testing.T) map[string][]string {
	t.Helper()
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	workflow, err := ciscan.Load(root, ".github/workflows/go-ci.yaml")
	require.NoError(t, err)

	var filters map[string][]string
	steps := workflow.Jobs["changes"].Steps
	for i := range steps {
		if text, ok := steps[i].StringWith("filters"); ok {
			require.NoError(t, yaml.Unmarshal([]byte(text), &filters))
		}
	}

	return filters
}
