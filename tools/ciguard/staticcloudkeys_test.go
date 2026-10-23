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
func TestStaticCloudKeysRejectsAKeyInJobEnv(t *testing.T) {
	jobEnv := strings.Replace(oidcOnlyWorkflow, "    runs-on: ubuntu-latest\n",
		"    runs-on: ubuntu-latest\n    env:\n      AWS_SECRET_ACCESS_KEY: ${{ secrets.MATRIX_AWS_SECRET_ACCESS_KEY }}\n", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: jobEnv}))

	require.NoError(t, err)
	assert.NotEmpty(t, problems)
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
		"flow mapping input": "      - uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000\n        with: { aws-region: eu-central-1, aws-access-key-id: \"${{ inputs.key }}\" }\n",
		"quoted input key":   "      - uses: aws-actions/configure-aws-credentials@0000000000000000000000000000000000000000\n        with:\n          'aws-secret-access-key': ${{ inputs.secret }}\n",
		"index into secrets": "      - env:\n          K: ${{ secrets['AWS_ACCESS_KEY_ID'] }}\n        run: aws s3 ls\n",
		"index into vars":    "      - env:\n          K: ${{ vars[\"MATRIX_AWS_SECRET_ACCESS_KEY\"] }}\n        run: aws s3 ls\n",
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
	assert.Contains(t, strings.Join(problems, "\n"), "no separate step in the same job")
}

// @scenario "A stored-key fallback without an OIDC twin fails CI"
func TestStaticCloudKeysRequiresIDTokenWrite(t *testing.T) {
	noToken := strings.Replace(gatedFallbackWorkflow, "      id-token: write\n", "", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: noToken}))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "id-token: write")
}

// @scenario "A fallback gate that can run while the role variable is set fails CI"
func TestStaticCloudKeysRejectsAGateWithAnEscape(t *testing.T) {
	for name, condition := range map[string]string{
		"or true":       "${{ vars.EMBEDS_AWS_ROLE_ARN == '' || true }}",
		"or always":     "${{ always() || vars.EMBEDS_AWS_ROLE_ARN == '' }}",
		"parenthesised": "${{ !(vars.EMBEDS_AWS_ROLE_ARN == '' && false) }}",
	} {
		t.Run(name, func(t *testing.T) {
			escaped := strings.Replace(gatedFallbackWorkflow, "${{ vars.EMBEDS_AWS_ROLE_ARN == '' }}", condition, 1)

			problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: escaped}))

			require.NoError(t, err)
			assert.Contains(t, strings.Join(problems, "\n"), "stored AWS key")
		})
	}
}

// @scenario "A gated stored-key fallback with an OIDC twin passes during the move"
func TestStaticCloudKeysAcceptsAGateInAConjunction(t *testing.T) {
	conjunction := strings.Replace(gatedFallbackWorkflow, "${{ vars.EMBEDS_AWS_ROLE_ARN == '' }}",
		"${{ !inputs.dry_run && vars.EMBEDS_AWS_ROLE_ARN == '' }}", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: conjunction}))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A stored key outside the sanctioned fallback step fails CI"
func TestStaticCloudKeysAttributesKeysToTheirStep(t *testing.T) {
	inline := strings.Replace(gatedFallbackWorkflow,
		"        with:\n          aws-access-key-id: ${{ secrets.EMBEDS_AWS_ACCESS_KEY_ID }}\n          aws-secret-access-key: ${{ secrets.EMBEDS_AWS_SECRET_ACCESS_KEY }}\n",
		"        with: { aws-access-key-id: \"${{ secrets.EMBEDS_AWS_ACCESS_KEY_ID }}\", aws-secret-access-key: \"${{ secrets.EMBEDS_AWS_SECRET_ACCESS_KEY }}\" }\n"+
			"      - run: echo hi\n        env:\n          LEAK: ${{ secrets.OTHER_AWS_SECRET_ACCESS_KEY }}\n", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: inline}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], embedsPath+":21:")
}

// @scenario "A fallback whose job's effective permissions lack id-token write fails CI"
func TestStaticCloudKeysReadsTheEffectivePermissions(t *testing.T) {
	jobOverrides := strings.Replace(
		strings.Replace(gatedFallbackWorkflow, "      id-token: write\n", "", 1),
		"on: workflow_dispatch\n", "on: workflow_dispatch\npermissions:\n  id-token: write\n", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: jobOverrides}))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "effective permissions")
}

// @scenario "A fallback whose job's effective permissions lack id-token write fails CI"
func TestStaticCloudKeysAcceptsWriteAll(t *testing.T) {
	writeAll := strings.Replace(gatedFallbackWorkflow, "    permissions:\n      contents: read\n      id-token: write\n",
		"    permissions: write-all\n", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: writeAll}))

	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A fallback that assumes the role with its own stored key fails CI"
func TestStaticCloudKeysRejectsRoleAssumedWithTheStoredKey(t *testing.T) {
	sameStep := strings.Replace(
		strings.Replace(gatedFallbackWorkflow, "role-to-assume: ${{ vars.EMBEDS_AWS_ROLE_ARN }}", "aws-region: eu-central-1", 1),
		"          aws-secret-access-key: ${{ secrets.EMBEDS_AWS_SECRET_ACCESS_KEY }}\n",
		"          aws-secret-access-key: ${{ secrets.EMBEDS_AWS_SECRET_ACCESS_KEY }}\n          role-to-assume: ${{ vars.EMBEDS_AWS_ROLE_ARN }}\n", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: sameStep}))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "no separate step in the same job")
}

// @scenario "A fallback that assumes the role with its own stored key fails CI"
func TestStaticCloudKeysRejectsATwinThatIsNotComplementary(t *testing.T) {
	alwaysOn := strings.Replace(gatedFallbackWorkflow, "${{ vars.EMBEDS_AWS_ROLE_ARN != '' }}", "${{ always() }}", 1)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: alwaysOn}))

	require.NoError(t, err)
	assert.Contains(t, strings.Join(problems, "\n"), "no separate step in the same job")
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

// @scenario "A listed fallback variable with no fallback step left fails CI"
func TestStaticCloudKeysRefusesAStaleFallbackEntry(t *testing.T) {
	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{embedsPath: oidcOnlyWorkflow}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], "StaticKeyFallbackVars lists EMBEDS_AWS_ROLE_ARN")
}

func TestStaticCloudKeysPassesOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := ciguard.StaticCloudKeys(root)

	require.NoError(t, err)
	assert.Empty(t, problems)
}
