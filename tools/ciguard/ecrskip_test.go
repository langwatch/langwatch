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

const gatedImages = `name: publish-docker-ecr
on:
  push:
    branches: [main]
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Check
        id: exists
        run: EXISTS=$(go run ./cmd/ecrtag published -repository r -tag t -source label -revision s -custom="${C}")
      - name: Build
        if: steps.exists.outputs.exists != 'true'
        uses: docker/build-push-action@0000000000000000000000000000000000000000 # v7
        with:
          push: true
      - name: Export
        uses: docker/build-push-action@0000000000000000000000000000000000000000 # v7
        with:
          push: false
  build-and-push-lambda:
    runs-on: ubuntu-latest
    steps:
      - name: Check
        id: exists
        run: EXISTS=$(go run ./cmd/ecrtag published -repository r -tag t -source label -revision s -custom="${C}" -accept-retag)
      - name: Build
        if: steps.exists.outputs.exists != 'true'
        uses: docker/build-push-action@0000000000000000000000000000000000000000 # v7
        with:
          push: true
  create-manifest:
    runs-on: ubuntu-latest
    steps:
      - name: Publish
        run: |
          exists=$(go run ./cmd/ecrtag published -repository r -tag t \
            -source annotation -revision s -custom="${C}")
          go run ./cmd/ecrtag lambda -repository r -tag t -revision s -custom="${C}"
`

const gatedPrivate = `name: publish-docker-private
on:
  workflow_dispatch:
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Check
        id: exists
        run: EXISTS=$(go run ./cmd/ecrtag published -repository r -tag t -source label -revision s -custom="${C}")
      - name: Build
        if: steps.exists.outputs.exists != 'true'
        uses: docker/build-push-action@0000000000000000000000000000000000000000 # v7
        with:
          push: true
`

func skipRepo(t *testing.T, images, private string) []string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".github", "workflows"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.ImagesWorkflow), []byte(images), 0o600))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.PrivateImagesWorkflow), []byte(private), 0o600))
	problems, err := ciguard.ECRSkipGates(root)
	require.NoError(t, err)

	return problems
}

func TestECRSkipGatesHoldOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.ECRSkipGates(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A re-run publishes nothing that is already there"
// @scenario "A private build never reuses a custom tag"
func TestEveryECRPushAsksEcrtagFirst(t *testing.T) {
	t.Run("gated workflows pass", func(t *testing.T) {
		assert.Empty(t, skipRepo(t, gatedImages, gatedPrivate))
	})

	for name, breakIt := range map[string]func(string) string{
		"a push with no gate": func(s string) string {
			return strings.Replace(s, "        if: steps.exists.outputs.exists != 'true'\n", "", 1)
		},
		"a push with no existence check": func(s string) string {
			return strings.Replace(s, "        id: exists\n", "        id: lookup\n", 1)
		},
		"a check that does not say whether the tag is custom": func(s string) string {
			return strings.Replace(s, ` -custom="${C}")`, ")", 1)
		},
	} {
		t.Run(name+" in the private workflow is refused", func(t *testing.T) {
			assert.Len(t, skipRepo(t, gatedImages, breakIt(gatedPrivate)), 1)
		})
		t.Run(name+" in the images workflow is refused", func(t *testing.T) {
			assert.NotEmpty(t, skipRepo(t, breakIt(gatedImages), gatedPrivate))
		})
	}

	t.Run("a Lambda check that refuses a re-tag is refused", func(t *testing.T) {
		problems := skipRepo(t, strings.Replace(gatedImages, " -accept-retag", "", 1), gatedPrivate)
		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], "-accept-retag")
	})
	t.Run("an index tag written without asking ecrtag is refused", func(t *testing.T) {
		problems := skipRepo(t, strings.Replace(gatedImages, "-source annotation", "-source label", 1), gatedPrivate)
		require.Len(t, problems, 1)
		assert.Contains(t, problems[0], "create-manifest")
	})
}
