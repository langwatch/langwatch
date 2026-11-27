package ecrtag_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

const buildWorkflow = `on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: docker/build-push-action@abc # v7
        with:
          push: true
          platforms: linux/arm64
          build-args: |
            VERSION=${{ needs.meta.outputs.image_tag }}
      - name: Export assets
        uses: docker/build-push-action@abc # v7
        with:
          outputs: type=local,dest=out
`

func buildSteps(t *testing.T, workflow string) string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "w.yml"), []byte(workflow), 0o600))
	steps, err := ecrtag.BuildSteps(root, "w.yml")
	require.NoError(t, err)
	return steps
}

// @scenario "A change to how the workflow builds rebuilds every image"
func TestABuildStepChangeRebuilds(t *testing.T) {
	ctx := context.Background()
	hash := func(workflow string) string {
		in := inputsOf(goTree(), goDockerfile)
		in.Build = buildSteps(t, workflow)
		h, err := in.Hash(ctx, gateway[0])
		require.NoError(t, err)
		return h
	}
	base := hash(buildWorkflow)

	assert.NotEqual(t, base, hash(strings.Replace(buildWorkflow, "VERSION=", "VERSION=x\n            EXTRA=", 1)), "a new build argument")
	assert.NotEqual(t, base, hash(strings.Replace(buildWorkflow, "platforms: linux/arm64", "platforms: linux/arm64/v8", 1)), "the platform")
	assert.Equal(t, base, hash(strings.Replace(buildWorkflow, "dest=out", "dest=elsewhere", 1)), "a step that pushes nothing")
	assert.Equal(t, base, hash(strings.Replace(buildWorkflow, "on: push", "# a comment\non: push", 1)), "anything outside the build steps")
}

func TestAWorkflowWithNoPushingBuildFails(t *testing.T) {
	root := t.TempDir()
	require.NoError(t, os.WriteFile(filepath.Join(root, "w.yml"), []byte("on: push\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: true\n"), 0o600))
	_, err := ecrtag.BuildSteps(root, "w.yml")
	assert.Error(t, err)
}
