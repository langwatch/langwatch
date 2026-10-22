package ciguard_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ciguard"
)

const oidcOnlyWorkflow = `name: publish
on: workflow_dispatch
permissions:
  contents: read
jobs:
  upload:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000 # v6
        with:
          aws-region: eu-central-1
          role-to-assume: ${{ vars.EMBEDS_AWS_ROLE_ARN }}
      # aws-access-key-id: ${{ secrets.OLD_AWS_ACCESS_KEY_ID }} in a comment is fine
      - run: aws s3 ls "$AWS_ACCESS_KEY_ID"
`

const gatedFallbackWorkflow = `name: publish
on: workflow_dispatch
jobs:
  upload:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - name: oidc
        if: ${{ vars.EMBEDS_AWS_ROLE_ARN != '' }}
        uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000 # v6
        with:
          role-to-assume: ${{ vars.EMBEDS_AWS_ROLE_ARN }}
      - name: stored key
        if: ${{ vars.EMBEDS_AWS_ROLE_ARN == '' }}
        uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000 # v6
        with:
          aws-access-key-id: ${{ secrets.EMBEDS_AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.EMBEDS_AWS_SECRET_ACCESS_KEY }}
`

func writeRepo(t *testing.T, files map[string]string) string {
	t.Helper()
	root := t.TempDir()
	for rel, content := range files {
		path := filepath.Join(root, rel)
		require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
		require.NoError(t, os.WriteFile(path, []byte(content), 0o600))
	}

	return root
}

const embedsPath = ".github/workflows/embedded-binaries-publish.yml"

func TestStaticCloudKeysAcceptsOIDCOnly(t *testing.T) {
	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: oidcOnlyWorkflow}))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A workflow that reads a stored AWS key fails CI"
func TestStaticCloudKeysRejectsAStoredKey(t *testing.T) {
	ungated := strings.Replace(gatedFallbackWorkflow, "if: ${{ vars.EMBEDS_AWS_ROLE_ARN == '' }}", "if: always()", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: ungated}))

	require.NoError(t, err)
	require.Len(t, problems, 2)
	assert.Contains(t, problems[0], "stored AWS key")
}

// @scenario "A workflow that reads a stored AWS key fails CI"
func TestStaticCloudKeysRejectsAKeyInJobEnv(t *testing.T) {
	jobEnv := strings.Replace(oidcOnlyWorkflow, "    runs-on: ubuntu-latest\n",
		"    runs-on: ubuntu-latest\n    env:\n      AWS_SECRET_ACCESS_KEY: ${{ secrets.MATRIX_AWS_SECRET_ACCESS_KEY }}\n", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: jobEnv}))

	require.NoError(t, err)
	assert.NotEmpty(t, problems)
}

// @scenario "A composite action that reads a stored AWS key fails CI"
func TestStaticCloudKeysScansCompositeActions(t *testing.T) {
	action := "runs:\n  using: composite\n  steps:\n    - uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000\n      with:\n        aws-access-key-id: ${{ inputs.key }}\n"

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/actions/aws/action.yml": action}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], ".github/actions/aws/action.yml:6")
}

// @scenario "A gated stored-key fallback with an OIDC twin passes during the move"
func TestStaticCloudKeysAcceptsTheGatedFallback(t *testing.T) {
	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: gatedFallbackWorkflow}))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A fallback gated on an unlisted variable fails CI"
func TestStaticCloudKeysRejectsAnUnlistedGate(t *testing.T) {
	invented := strings.ReplaceAll(gatedFallbackWorkflow, "EMBEDS_AWS_ROLE_ARN", "MY_NEW_ROLE_ARN")

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: invented}))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "not a sanctioned OIDC fallback")
}

// @scenario "A fallback gated on an unlisted variable fails CI"
func TestStaticCloudKeysRejectsAGateBorrowedByAnotherWorkflow(t *testing.T) {
	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/workflows/other.yml": gatedFallbackWorkflow}))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "not a sanctioned OIDC fallback")
}

// @scenario "A stored-key fallback without an OIDC twin fails CI"
func TestStaticCloudKeysRejectsAFallbackWithoutTwin(t *testing.T) {
	noTwin := strings.Replace(gatedFallbackWorkflow, "role-to-assume: ${{ vars.EMBEDS_AWS_ROLE_ARN }}", "aws-region: eu-central-1", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: noTwin}))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "no step assuming a role by OIDC")
}

// @scenario "A stored-key fallback without an OIDC twin fails CI"
func TestStaticCloudKeysRequiresIDTokenWrite(t *testing.T) {
	noToken := strings.Replace(gatedFallbackWorkflow, "      id-token: write\n", "", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: noToken}))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "id-token: write")
}

func TestStaticCloudKeysPassesOnThisRepository(t *testing.T) {
	problems, err := ciguard.StaticCloudKeys(filepath.Join("..", ".."))

	require.NoError(t, err)
	assert.Empty(t, problems)
}
