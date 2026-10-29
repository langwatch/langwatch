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
        env:
          IMAGE: ${{ matrix.image }}
          TAG: ${{ needs.meta.outputs.image_tag }}-${{ matrix.arch }}
          CUSTOM_TAG: ${{ needs.meta.outputs.custom_tag }}
        run: EXISTS=$(go run ./cmd/ecrtag published -repository "${IMAGE}" -tag "${TAG}" -source label -revision s -custom="${CUSTOM_TAG}")
      - name: Build
        if: steps.exists.outputs.exists != 'true'
        uses: docker/build-push-action@0000000000000000000000000000000000000000 # v7
        with:
          push: true
          tags: |
            ${{ steps.ecr.outputs.registry }}/${{ matrix.image }}:${{ needs.meta.outputs.image_tag }}-${{ matrix.arch }}
      - name: Export
        uses: docker/build-push-action@0000000000000000000000000000000000000000 # v7
        with:
          push: false
          outputs: type=local,dest=out
  build-and-push-lambda:
    runs-on: ubuntu-latest
    steps:
      - name: Check
        id: exists
        env:
          IMAGE: ${{ matrix.image }}
          TAG: ${{ needs.meta.outputs.image_tag }}
          CUSTOM_TAG: ${{ needs.meta.outputs.custom_tag }}
        run: EXISTS=$(go run ./cmd/ecrtag published -repository "${IMAGE}" -tag "${TAG}" -source label -revision s -custom="${CUSTOM_TAG}" -refuse-retag)
      - name: Build
        if: steps.exists.outputs.exists != 'true'
        uses: docker/build-push-action@0000000000000000000000000000000000000000 # v7
        with:
          push: true
          tags: |
            ${{ steps.ecr.outputs.registry }}/${{ matrix.image }}:${{ needs.meta.outputs.image_tag }}
  create-manifest:
    runs-on: ubuntu-latest
    steps:
      - name: Publish
        env:
          CUSTOM_TAG: ${{ needs.meta.outputs.custom_tag }}
        run: |
          from=()
          if [ "${built}" = true ]; then
            from=(-built-from "${IMAGE_TAG}-arm64")
          fi
          exists=$(go run ./cmd/ecrtag published -repository r -tag "${IMAGE_TAG}" \
            -source annotation -revision s -custom="${CUSTOM_TAG}" "${from[@]}")
          docker buildx imagetools create -t "${repo}:${IMAGE_TAG}" src
          go run ./cmd/ecrtag lambda -repository r -tag t -revision s -custom="${CUSTOM_TAG}"
`

const gatedPrivate = `name: publish-docker-private
on:
  workflow_dispatch:
env:
  IMAGE: langwatch-app
jobs:
  build-and-push:
    runs-on: ubuntu-latest
    steps:
      - name: Check
        id: exists
        env:
          IMAGE_TAG: ${{ steps.meta.outputs.image_tag }}
          CUSTOM_TAG: ${{ steps.meta.outputs.custom_tag }}
        run: EXISTS=$(go run ./cmd/ecrtag published -repository "${IMAGE}" -tag "${IMAGE_TAG}" -source label -revision s -custom="${CUSTOM_TAG}")
      - name: Build
        if: steps.exists.outputs.exists != 'true'
        uses: docker/build-push-action@0000000000000000000000000000000000000000 # v7
        with:
          push: true
          tags: |
            ${{ steps.ecr.outputs.registry }}/${{ env.IMAGE }}:${{ steps.meta.outputs.image_tag }}
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
// @scenario "A private build reuses a tag only for the commit it records"
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
			return strings.Replace(s, ` -custom="${CUSTOM_TAG}")`, ")", 1)
		},
		"a -custom not taken from the meta step": func(s string) string {
			return strings.Replace(s, "          CUSTOM_TAG: ${{ ", "          CUSTOM_TAG: false\n          UNUSED: ${{ ", 1)
		},
		"a check of another tag than the build pushes": func(s string) string {
			return strings.Replace(s, `-tag "${`, `-tag "${OTHER}" -x "${`, 1)
		},
	} {
		t.Run(name+" in the private workflow is refused", func(t *testing.T) {
			assert.Len(t, skipRepo(t, gatedImages, breakIt(gatedPrivate)), 1)
		})
		t.Run(name+" in the images workflow is refused", func(t *testing.T) {
			assert.NotEmpty(t, skipRepo(t, breakIt(gatedImages), gatedPrivate))
		})
	}

	for name, breakIt := range map[string]func(string) string{
		"a gate diluted by ||": func(s string) string {
			return strings.Replace(s, "if: steps.exists.outputs.exists != 'true'", "if: always() || steps.exists.outputs.exists != 'true'", 1)
		},
		"a quoted push: \"true\" with no gate": func(s string) string {
			s = strings.Replace(s, "        if: steps.exists.outputs.exists != 'true'\n", "", 1)
			return strings.Replace(s, "          push: true\n", "          push: \"true\"\n", 1)
		},
		"push: ${{ true }} with no gate": func(s string) string {
			s = strings.Replace(s, "        if: steps.exists.outputs.exists != 'true'\n", "", 1)
			return strings.Replace(s, "          push: true\n", "          push: ${{ true }}\n", 1)
		},
		"a docker push inside a shell function": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Push by hand\n        run: |\n          publish() {\n            docker push \"$1\"\n          }\n          publish r:t\n      - name: Build\n", 1)
		},
		"a build whose outputs go to a registry": func(s string) string {
			s = strings.Replace(s, "        if: steps.exists.outputs.exists != 'true'\n", "", 1)
			return strings.Replace(s, "          push: true\n", "          push: false\n          outputs: type=registry,name=r:t\n", 1)
		},
		"a buildx build -o type=registry in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Buildx\n        run: docker buildx build . -o type=registry,name=r:t\n      - name: Build\n", 1)
		},
		"a crane copy in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Crane\n        run: crane copy a b\n      - name: Build\n", 1)
		},
		"a skopeo copy in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Skopeo\n        run: skopeo copy docker://a docker://b\n      - name: Build\n", 1)
		},
		"an oras push in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Oras\n        run: oras push r:t file\n      - name: Build\n", 1)
		},
		"a build whose outputs push an image": func(s string) string {
			s = strings.Replace(s, "        if: steps.exists.outputs.exists != 'true'\n", "", 1)
			return strings.Replace(s, "          push: true\n", "          push: false\n          outputs: type=image,name=r:t,push=true\n", 1)
		},
		"a buildx build --output=type=image,push=true in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Buildx\n        run: docker buildx build . --output=type=image,name=r:t,push=true\n      - name: Build\n", 1)
		},
		"a docker image push in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Push\n        run: docker image push r:t\n      - name: Build\n", 1)
		},
		"a docker manifest push in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Push\n        run: docker manifest push r:t\n      - name: Build\n", 1)
		},
		"a podman push in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Push\n        run: podman push r:t\n      - name: Build\n", 1)
		},
		"a build that pushes a second tag": func(s string) string {
			return strings.Replace(s, "          tags: |\n            ${{ steps.ecr.outputs.registry }}/", "          tags: |\n            ${{ steps.ecr.outputs.registry }}/x:latest\n            ${{ steps.ecr.outputs.registry }}/", 1)
		},
		"a build that pushes a longer tag than it checked": func(s string) string {
			head, tail, _ := strings.Cut(s, "          tags: |\n")
			line, rest, _ := strings.Cut(tail, "\n")
			return head + "          tags: |\n" + line + "-extra\n" + rest
		},
		"a buildx build --push in a run step": func(s string) string {
			return strings.Replace(s, "      - name: Build\n", "      - name: Buildx\n        run: |\n          docker buildx build . \\\n            --push -t r:t\n      - name: Build\n", 1)
		},
	} {
		t.Run(name+" is refused", func(t *testing.T) {
			assert.NotEmpty(t, skipRepo(t, gatedImages, breakIt(gatedPrivate)), breakIt(gatedPrivate))
			assert.NotEmpty(t, skipRepo(t, breakIt(gatedImages), gatedPrivate))
		})
	}

	for name, push := range map[string]string{
		"a docker push":       "docker push \"${repo}:${IMAGE_TAG}\"",
		"a docker image push": "docker image push \"${repo}:${IMAGE_TAG}\"",
		"a crane copy":        "crane copy src \"${repo}:${IMAGE_TAG}\"",
	} {
		t.Run(name+" inside create-manifest is refused", func(t *testing.T) {
			images := strings.Replace(gatedImages, "          docker buildx imagetools create", "          "+push+"\n          docker buildx imagetools create", 1)
			problems := skipRepo(t, images, gatedPrivate)
			require.Len(t, problems, 1, problems)
			assert.Contains(t, problems[0], "create-manifest")
		})
	}

	t.Run("a build whose outputs push nothing passes", func(t *testing.T) {
		images := strings.Replace(gatedImages, "          outputs: type=local,dest=out\n", "          outputs: type=image,name=r:t,push=false\n", 1)
		assert.Empty(t, skipRepo(t, images, gatedPrivate))
	})

	t.Run("a gated run step that pushes passes", func(t *testing.T) {
		private := strings.Replace(gatedPrivate, "      - name: Build\n", "      - name: Push by hand\n        if: success() && steps.exists.outputs.exists != 'true'\n        run: docker push r:t\n      - name: Build\n", 1)
		assert.Empty(t, skipRepo(t, gatedImages, private))
	})

	for name, c := range map[string]struct{ from, to, want string }{
		"a Lambda check that does not refuse a re-tag":    {" -refuse-retag)", ")", "-refuse-retag"},
		"a Lambda check with -refuse-retag=false":         {" -refuse-retag)", " -refuse-retag=false)", "-refuse-retag"},
		"a Lambda check that turns -refuse-retag off":     {" -refuse-retag)", " -refuse-retag -refuse-retag=false)", "-refuse-retag more than once"},
		"a second -custom on the Lambda check":            {" -refuse-retag)", " -refuse-retag -custom=false)", "-custom more than once"},
		"a second -custom on the index check":             {` "${from[@]}")`, ` "${from[@]}" -custom=false)`, "-custom more than once"},
		"a literal -built-from beside ${from[@]}":         {` "${from[@]}")`, ` "${from[@]}" -built-from x)`, "-built-from more than once"},
		"${from[@]} twice on the index check":             {` "${from[@]}")`, ` "${from[@]}" "${from[@]}")`, "-built-from more than once"},
		"an index check that does not pass ${from[@]}":    {` "${from[@]}")`, `)`, "${from[@]}"},
		"${from[@]} on another line than the index check": {` "${from[@]}")`, ")\n          echo \"${from[@]}\"", "${from[@]}"},
		"a ${from[@]} that never names the build":         {`from=(-built-from "${IMAGE_TAG}-arm64")`, `from=()`, "-built-from"},
	} {
		t.Run(name+" is refused", func(t *testing.T) {
			require.Contains(t, gatedImages, c.from)
			problems := skipRepo(t, strings.Replace(gatedImages, c.from, c.to, 1), gatedPrivate)
			require.Len(t, problems, 1, problems)
			assert.Contains(t, problems[0], c.want)
		})
	}
	t.Run("an index tag written without asking ecrtag is refused", func(t *testing.T) {
		problems := skipRepo(t, strings.Replace(gatedImages, "-source annotation", "-source label", 1), gatedPrivate)
		require.NotEmpty(t, problems)
		assert.Contains(t, problems[0], "create-manifest")
	})
}
