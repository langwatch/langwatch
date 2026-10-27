package ciguard_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
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

// writeRepo writes files into an empty repository.
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
	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/workflows/other.yml": oidcOnlyWorkflow}))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A workflow that reads a stored AWS key fails CI"
func TestStaticCloudKeysRejectsAStoredKey(t *testing.T) {
	ungated := strings.Replace(gatedFallbackWorkflow, "if: ${{ vars.EMBEDS_AWS_ROLE_ARN == '' }}", "if: always()", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: ungated}))

	require.NoError(t, err)
	assert.Contains(t, problems, embedsPath+":19: stored AWS key: a long-lived key in GitHub can be read by any workflow edit; assume a role with GitHub OIDC (role-to-assume) instead")
	assert.Equal(t, 2, strings.Count(strings.Join(problems, "\n"), ": stored AWS key:"))
}

// @scenario "A workflow that reads a stored AWS key fails CI"
func TestStaticCloudKeysAllowsAnOIDCSessionExport(t *testing.T) {
	step := "      - env:\n          AWS_ACCESS_KEY_ID: ${{ steps.creds.outputs.aws-access-key-id }}\n          KEY_ID: ${{ steps.creds.outputs.aws-access-key-id }}\n        run: |\n          aws configure --profile p set aws_access_key_id \"${KEY_ID}\"\n"
	workflow := strings.Replace(oidcOnlyWorkflow, "      - run: aws s3 ls \"$AWS_ACCESS_KEY_ID\"\n", step, 1)
	require.NotEqual(t, oidcOnlyWorkflow, workflow)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/workflows/other.yml": workflow}))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A workflow that reads a stored AWS key fails CI"
func TestStaticCloudKeysRejectsAKeyInJobEnv(t *testing.T) {
	jobEnv := strings.Replace(oidcOnlyWorkflow, "    runs-on: ubuntu-latest\n",
		"    runs-on: ubuntu-latest\n    env:\n      AWS_SECRET_ACCESS_KEY: ${{ secrets.CI_KEY }}\n", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: jobEnv}))

	require.NoError(t, err)
	assert.Contains(t, problems, embedsPath+":9: stored AWS key: a long-lived key in GitHub can be read by any workflow edit; assume a role with GitHub OIDC (role-to-assume) instead")
}

// @scenario "A workflow that reads a stored AWS key fails CI"
func TestStaticCloudKeysIgnoresCase(t *testing.T) {
	lower := strings.Replace(oidcOnlyWorkflow, "      - run: aws s3 ls", "      - env:\n          K: ${{ secrets.matrix_aws_access_key_id }}\n        run: aws s3 ls", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/workflows/other.yml": lower}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], ".github/workflows/other.yml:18:")
}

// @scenario "A workflow that reads a stored AWS key fails CI"
func TestStaticCloudKeysFindsKeysOutsideBlockStyle(t *testing.T) {
	cases := map[string]string{
		"flow mapping input":             "      - uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000\n        with: { aws-region: eu-central-1, aws-access-key-id: \"${{ inputs.key }}\" }\n",
		"quoted input key":               "      - uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000\n        with:\n          'aws-secret-access-key': ${{ inputs.secret }}\n",
		"index into secrets":             "      - env:\n          K: ${{ secrets['AWS_ACCESS_KEY_ID'] }}\n        run: aws s3 ls\n",
		"env key, any secret name":       "      - env:\n          AWS_ACCESS_KEY_ID: ${{ secrets.CI_KEY }}\n        run: aws s3 ls\n",
		"env session token":              "      - env:\n          AWS_SESSION_TOKEN: ${{ vars.CI_TOKEN }}\n        run: aws s3 ls\n",
		"flow style env":                 "      - env: { AWS_SECRET_ACCESS_KEY: '${{ secrets.PUBLISHER_SECRET }}' }\n        run: aws s3 ls\n",
		"aws configure set":              "      - run: aws configure set aws_access_key_id ${{ secrets.PROD_KEY }}\n",
		"aws configure set with profile": "      - run: aws configure --profile p set aws_secret_access_key \"${{ secrets.PROD_SECRET }}\"\n",
		"lowercase secret name":          "      - env:\n          AWS_ACCESS_KEY_ID: ${{ secrets.ci_key }}\n        run: aws s3 ls\n",
		"index into vars":                "      - env:\n          K: ${{ vars[\"MATRIX_AWS_SECRET_ACCESS_KEY\"] }}\n        run: aws s3 ls\n",
	}
	for name, step := range cases {
		t.Run(name, func(t *testing.T) {
			workflow := strings.Replace(oidcOnlyWorkflow, "      - run: aws s3 ls \"$AWS_ACCESS_KEY_ID\"\n", step, 1)
			require.NotEqual(t, oidcOnlyWorkflow, workflow)

			problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/workflows/other.yml": workflow}))

			require.NoError(t, err)
			require.Len(t, problems, 1)
			assert.Contains(t, problems[0], ".github/workflows/other.yml:")
			assert.Contains(t, problems[0], ": stored AWS key:")
		})
	}
}

// @scenario "A composite action that reads a stored AWS key fails CI"
func TestStaticCloudKeysScansCompositeActions(t *testing.T) {
	action := "runs:\n  using: composite\n  steps:\n    - uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000\n      with:\n        aws-access-key-id: ${{ inputs.key }}\n"

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/actions/aws/action.yml": action}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], ".github/actions/aws/action.yml:6")
}

// @scenario "A stored key fails CI whatever condition gates its step"
func TestStaticCloudKeysRejectsTheGatedFallback(t *testing.T) {
	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: gatedFallbackWorkflow}))

	require.NoError(t, err)
	assert.Equal(t, []string{
		embedsPath + ":19: stored AWS key: a long-lived key in GitHub can be read by any workflow edit; assume a role with GitHub OIDC (role-to-assume) instead",
		embedsPath + ":20: stored AWS key: a long-lived key in GitHub can be read by any workflow edit; assume a role with GitHub OIDC (role-to-assume) instead",
	}, problems)
}

// @scenario "A stored key fails CI whatever condition gates its step"
func TestStaticCloudKeysRejectsAStoredKeyUnderAnyCondition(t *testing.T) {
	for name, condition := range map[string]string{
		"a role-variable gate":  "${{ vars.EMBEDS_AWS_ROLE_ARN == '' }}",
		"a never-true gate":     "false",
		"a dispatch-only gate":  "github.event_name == 'workflow_dispatch'",
		"a gate in conjunction": "${{ !inputs.dry_run && vars.MATRIX_AWS_ROLE_ARN == '' }}",
	} {
		t.Run(name, func(t *testing.T) {
			workflow := strings.Replace(gatedFallbackWorkflow, "if: ${{ vars.EMBEDS_AWS_ROLE_ARN == '' }}", "if: "+condition, 1)

			problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/workflows/other.yml": workflow}))

			require.NoError(t, err)
			assert.Len(t, problems, 2)
		})
	}
}

// @scenario "A change to a composite action runs the guard"
func TestStaticCloudKeysRunsOnCompositeActionChanges(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)
	workflow, err := ciscan.Load(root, ".github/workflows/go-ci.yaml")
	require.NoError(t, err)

	var filters map[string][]string
	for _, step := range workflow.Jobs["changes"].Steps {
		if text, ok := step.StringWith("filters"); ok {
			require.NoError(t, yaml.Unmarshal([]byte(text), &filters))
		}
	}

	assert.Contains(t, filters["ciguards"], ".github/actions/**")
}

func TestStaticCloudKeysPassesOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.StaticCloudKeys(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}
