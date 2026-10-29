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

const dispatchImages = `name: publish-docker-ecr
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      image_tag:
        type: string
jobs:
  meta:
    runs-on: ubuntu-latest
    steps:
      - id: meta
        env:
          INPUT_IMAGE_TAG: ${{ inputs.image_tag }}
        run: |
          IMAGE_TAG="git-${SHORT_HASH}"
          if [ -n "${INPUT_IMAGE_TAG}" ]; then
            IMAGE_TAG="${INPUT_IMAGE_TAG}"
          fi
  create-manifest:
    runs-on: ubuntu-latest
    steps:
      - name: Publish
        env:
          IMAGE_TAG: ${{ needs.meta.outputs.image_tag }}
        run: |
          publish() {
            exists=$(go run ./cmd/ecrtag published -repository "${image}" -tag "${IMAGE_TAG}" \
              -source annotation -revision "${GITHUB_SHA}" -custom="${CUSTOM_TAG}")
            if [ "${exists}" = "true" ]; then return 0; fi
            docker buildx imagetools create -t "${repo}:${IMAGE_TAG}" "${sources[@]}"
          }
`

func dispatchProblems(t *testing.T, images string) []string {
	t.Helper()
	root := t.TempDir()
	require.NoError(t, os.MkdirAll(filepath.Join(root, ".github", "workflows"), 0o750))
	require.NoError(t, os.WriteFile(filepath.Join(root, ciguard.ImagesWorkflow), []byte(images), 0o600))
	problems, err := ciguard.ECRDispatchTags(root)
	require.NoError(t, err)

	return problems
}

func TestECRDispatchTagsHoldOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.ECRDispatchTags(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A dispatch with a new custom tag over a published commit writes that tag"
func TestADispatchedCustomTagIsTheTagCheckedAndWritten(t *testing.T) {
	t.Run("the dispatch input checked and written as itself passes", func(t *testing.T) {
		assert.Empty(t, dispatchProblems(t, dispatchImages))
	})

	for name, breakIt := range map[string]func(string) string{
		"image_tag not becoming the run's tag": func(s string) string {
			return strings.Replace(s, `IMAGE_TAG="${INPUT_IMAGE_TAG}"`, `echo ignored`, 1)
		},
		"publish() returning early on the commit's git-<sha>": func(s string) string {
			return strings.Replace(s, `-tag "${IMAGE_TAG}" \`, `-tag "git-${SHORT_HASH}" \`, 1)
		},
		"publish() writing another tag than it checked": func(s string) string {
			return strings.Replace(s, `-t "${repo}:${IMAGE_TAG}"`, `-t "${repo}:git-${SHORT_HASH}"`, 1)
		},
		"create-manifest reading another tag": func(s string) string {
			return strings.Replace(s, "IMAGE_TAG: ${{ needs.meta.outputs.image_tag }}", "IMAGE_TAG: git-latest", 1)
		},
	} {
		t.Run(name+" is refused", func(t *testing.T) {
			assert.Len(t, dispatchProblems(t, breakIt(dispatchImages)), 1)
		})
	}
}

// @scenario "A release publishes nothing to the artifacts registry"
func TestImagesRunOnlyOnAPushToMainAndADispatch(t *testing.T) {
	for name, on := range map[string]string{
		"a release trigger":        "on:\n  push:\n    branches: [main]\n  release:\n    types: [published]\n  workflow_dispatch:\n",
		"a tag push":               "on:\n  push:\n    branches: [main]\n    tags: ['langwatch@v*']\n  workflow_dispatch:\n",
		"a push to another branch": "on:\n  push:\n    branches: [main, release]\n  workflow_dispatch:\n",
		"a list of events":         "on: [push, workflow_dispatch, release]\n",
	} {
		t.Run(name+" is refused", func(t *testing.T) {
			start := strings.Index(dispatchImages, "on:\n")
			end := strings.Index(dispatchImages, "jobs:\n")
			images := dispatchImages[:start] + on + dispatchImages[end:]
			assert.NotEmpty(t, dispatchProblems(t, images), images)
		})
	}
}
