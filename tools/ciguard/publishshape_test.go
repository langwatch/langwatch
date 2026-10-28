package ciguard_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
	"github.com/langwatch/langwatch/tools/ciguard"
)

const goodCharts = `name: prerelease-charts-oci
on:
  push:
    branches: [main]
permissions:
  contents: read
  id-token: write
jobs:
  push:
    runs-on: ubuntu-latest
    steps:
      # never ghcr.io, never cosign: a comment may say so
      - env:
          ECR_CHARTS: beta alpha
        run: |
          registry="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
          go run ./cmd/chartpush -registry "$registry" $ECR_CHARTS
`

const goodImages = `name: publish-docker-ecr
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  meta:
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - run: echo meta
`

// publishRepo writes the two workflows and a Chart.yaml per chart name.
func publishRepo(t *testing.T, charts, images string, chartNames ...string) string {
	t.Helper()
	root := t.TempDir()
	dir := filepath.Join(root, ".github", "workflows")
	require.NoError(t, os.MkdirAll(dir, 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.ChartsWorkflow), []byte(charts), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.ImagesWorkflow), []byte(images), 0o600))
	for _, name := range chartNames {
		chartDir := filepath.Join(root, "charts", name)
		require.NoError(t, os.MkdirAll(chartDir, 0o750))
		require.NoError(t, os.WriteFile(filepath.Join(chartDir, "Chart.yaml"), []byte("apiVersion: v2\nname: "+name+"\n"), 0o600))
	}

	return root
}

func shapeProblems(t *testing.T, root string) []string {
	t.Helper()
	problems, err := ciguard.PublishShape(root)
	require.NoError(t, err)

	return problems
}

func TestPublishShapeHoldsOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	assert.Empty(t, shapeProblems(t, root))
}

// @scenario "No prerelease chart goes to a public registry"
func TestChartsReachOnlyThePrivateECR(t *testing.T) {
	t.Run("the private ECR through chartpush passes", func(t *testing.T) {
		assert.Empty(t, shapeProblems(t, publishRepo(t, goodCharts, goodImages, "alpha", "beta")))
	})

	for name, breakIt := range map[string]func(string) string{
		"a direct helm push to ghcr.io": func(s string) string {
			return s + "          helm push chart.tgz oci://ghcr.io/langwatch/charts\n"
		},
		"a registry other than the private ECR": func(s string) string {
			return strings.Replace(s, `registry="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"`, `registry="docker.io/langwatch"`, 1)
		},
		"chartpush handed another registry": func(s string) string {
			return strings.Replace(s, `-registry "$registry"`, `-registry quay.io/langwatch`, 1)
		},
		"packages: write": func(s string) string {
			return strings.Replace(s, "  id-token: write\n", "  id-token: write\n  packages: write\n", 1)
		},
	} {
		t.Run(name+" is refused", func(t *testing.T) {
			assert.Len(t, shapeProblems(t, publishRepo(t, breakIt(goodCharts), goodImages, "alpha", "beta")), 1)
		})
	}
}

// @scenario "The ECR copy is not signed"
func TestChartsAreNotSigned(t *testing.T) {
	signed := goodCharts + "      - run: cosign sign --yes \"$ref\"\n"

	problems := shapeProblems(t, publishRepo(t, signed, goodImages, "alpha", "beta"))

	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "signs")
}

// @scenario "A release publishes nothing to the artifacts registry"
func TestImagesPublishOnlyFromMain(t *testing.T) {
	t.Run("a release trigger is refused", func(t *testing.T) {
		images := strings.Replace(goodImages, "  workflow_dispatch:\n", "  workflow_dispatch:\n  release:\n    types: [published]\n", 1)

		problems := shapeProblems(t, publishRepo(t, goodCharts, images, "alpha", "beta"))

		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], "release trigger")
	})

	t.Run("a meta job that runs off main is refused", func(t *testing.T) {
		images := strings.Replace(goodImages, "    if: github.ref == 'refs/heads/main'\n", "", 1)

		problems := shapeProblems(t, publishRepo(t, goodCharts, images, "alpha", "beta"))

		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], "meta job")
	})
}

func TestEveryChartIsListedForECR(t *testing.T) {
	problems := shapeProblems(t, publishRepo(t, goodCharts, goodImages, "alpha", "beta", "gamma"))

	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "gamma")
}
