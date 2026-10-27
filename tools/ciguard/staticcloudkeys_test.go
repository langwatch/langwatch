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

// @scenario "An AWS key set from anything but an OIDC session fails CI"
func TestIsStoredAWSKeyLineRefusesAKeyFromAnythingButASession(t *testing.T) {
	for name, line := range map[string]string{
		"GITHUB_ENV write":                  `          echo "AWS_SECRET_ACCESS_KEY=${{ secrets.X }}" >> $GITHUB_ENV`,
		"shell export":                      `        run: export AWS_ACCESS_KEY_ID=${{ secrets.X }}`,
		"docker run -e":                     `          docker run -e AWS_SECRET_ACCESS_KEY=${{ secrets.X }} img`,
		"container options -e":              `      options: -e AWS_ACCESS_KEY_ID=${{ secrets.X }}`,
		"format()":                          `          AWS_ACCESS_KEY_ID: ${{ format('{0}', secrets.CI_KEY) }}`,
		"parenthesised":                     `          AWS_ACCESS_KEY_ID: ${{ (secrets.CI_KEY) }}`,
		"prefixed":                          `          AWS_ACCESS_KEY_ID: x${{ secrets.CI_KEY }}`,
		"session or secret fallback":        `          AWS_ACCESS_KEY_ID: ${{ steps.c.outputs.k || secrets.CI_KEY }}`,
		"shell default from a secret":       `          export AWS_ACCESS_KEY_ID="${KEY:-${{ secrets.CI_KEY }}}"`,
		"variable then secret":              `          echo "AWS_ACCESS_KEY_ID=$X${{ secrets.CI_KEY }}" >> "$GITHUB_ENV"`,
		"quoted YAML key":                   `          "AWS_ACCESS_KEY_ID": "${{ secrets.CI_KEY }}"`,
		"mixed case key":                    `          Aws_Secret_Access_Key: ${{ secrets.CI_KEY }}`,
		"key from vars":                     `          AWS_SESSION_TOKEN: ${{ vars.CI_TOKEN }}`,
		"composite action input env":        `        AWS_ACCESS_KEY_ID: ${{ inputs.aws_key }}`,
		"composite action key input":        `        aws-access-key-id: ${{ inputs.key }}`,
		"key input from a secret":           `          aws-secret-access-key: ${{ secrets.CI_KEY }}`,
		"folded block value":                `          AWS_SECRET_ACCESS_KEY: >-`,
		"literal block value":               `          AWS_SECRET_ACCESS_KEY: |`,
		"value on the next line":            `          AWS_SECRET_ACCESS_KEY:`,
		"env from JSON":                     `    env: ${{ fromJSON(secrets.AWS_ENV) }}`,
		"whole secrets context":             `        run: echo '${{ toJSON(secrets) }}' | jq -r .CI_KEY`,
		"credentials file printf":           `          printf '[default]\naws_access_key_id = %s' '${{ secrets.X }}' > creds`,
		"credentials file line":             `            aws_secret_access_key = ${{ secrets.X }}`,
		"credentials file path":             `          cp creds ~/.aws/credentials`,
		"aws configure set":                 `          aws configure set aws_access_key_id ${{ secrets.PROD_KEY }}`,
		"aws configure set default":         `          aws configure set default.aws_secret_access_key "${{ secrets.K }}"`,
		"secret named for a key":            `          K: ${{ secrets.aws_access_key_id }}`,
		"GITHUB_ENV heredoc name":           `          echo "AWS_ACCESS_KEY_ID<<EOF" >> "$GITHUB_ENV"`,
		"GITHUB_ENV grouped heredoc":        `          { echo "AWS_ACCESS_KEY_ID<<X"; echo '${{ secrets.PROD_KEY }}'; echo X; } >> "$GITHUB_ENV"`,
		"append assignment":                 `          AWS_ACCESS_KEY_ID+=${{ secrets.PROD_KEY }}`,
		"quoted configure set name":         `          aws configure set "aws_access_key_id" '${{ secrets.PROD_KEY }}'`,
		"docker -e attached":                `          docker run -eAWS_ACCESS_KEY_ID='${{ secrets.PROD_KEY }}' img`,
		"long flag with equals":             `          sometool --aws-access-key-id='${{ secrets.PROD_KEY }}'`,
		"default-assign expansion":          `          : "${AWS_ACCESS_KEY_ID:=${{ secrets.PROD_KEY }}}"; export AWS_ACCESS_KEY_ID`,
		"process.env assignment":            `          node -e "process.env.AWS_ACCESS_KEY_ID='${{ secrets.PROD_KEY }}'"`,
		"os.environ single quotes":          `          python -c "import os; os.environ['AWS_ACCESS_KEY_ID']='${{ secrets.PROD_KEY }}'"`,
		"os.environ double quotes":          `          os.environ["AWS_SECRET_ACCESS_KEY"] = "${{ secrets.PROD_KEY }}"`,
		"PowerShell SetEnvironmentVariable": `          [Environment]::SetEnvironmentVariable("AWS_ACCESS_KEY_ID", "${{ secrets.PROD_KEY }}")`,
		"PowerShell Set-Item Env":           `          Set-Item -Path Env:AWS_ACCESS_KEY_ID -Value '${{ secrets.PROD_KEY }}'`,
		"secret name with a suffix":         `          access-key: ${{ secrets.AWS_ACCESS_KEY_ID_PROD }}`,
		"fromJSON wrapping format":          `          env: ${{ fromJSON(format('{0}', secrets.CREDS)) }}`,
		"fromJSON wrapping parentheses":     `          env: ${{ fromJSON((secrets.CREDS)) }}`,
		"fromJSON building the key name":    `          env: ${{ fromJSON(format('{{"AWS_{1}":"{0}"}}', secrets.PROD_KEY, 'ACCESS_KEY_ID')) }}`,
		"toJSON of parenthesised secrets":   `          run: echo '${{ toJSON((secrets)) }}' > s.json`,
		"credentials file hex newline":      `          echo -e "[default]\x0aaws_access_key_id=${{ secrets.PROD_KEY }}" > creds`,
		"credentials file octal newline":    `          printf '[default]\012aws_access_key_id=%s\n' '${{ secrets.PROD_KEY }}' > creds`,
	} {
		t.Run(name, func(t *testing.T) {
			assert.True(t, ciguard.IsStoredAWSKeyLine(line), line)
		})
	}
}

// @scenario "Reading or relaying an OIDC session passes"
func TestIsStoredAWSKeyLineAllowsAnOIDCSession(t *testing.T) {
	for _, line := range []string{
		`        KEY_ID: ${{ steps.creds.outputs.aws-access-key-id }}`,
		`        SECRET: ${{ steps.creds.outputs.aws-secret-access-key }}`,
		`        TOKEN: ${{ steps.creds.outputs.aws-session-token }}`,
		`          aws configure --profile "${profile}" set aws_access_key_id "${KEY_ID}"`,
		`          aws configure --profile "${profile}" set aws_secret_access_key "${SECRET}"`,
		`          aws configure --profile "${profile}" set aws_session_token "${TOKEN}"`,
		`          AWS_ACCESS_KEY_ID: ${{ steps.creds.outputs.aws-access-key-id }}`,
		`          aws-access-key-id: ${{ steps.creds.outputs.aws-access-key-id }}`,
		`        with: { aws-secret-access-key: '${{ steps.creds.outputs.aws-secret-access-key }}', aws-region: x }`,
		`        if: env.AWS_ACCESS_KEY_ID != ''`,
		`        run: test -n "${{ env.AWS_ACCESS_KEY_ID }}"`,
		`          echo "AWS_ACCESS_KEY_ID=${KEY_ID}" >> "$GITHUB_ENV"`,
		`          export AWS_SESSION_TOKEN="$TOKEN"; aws sts get-caller-identity`,
		`          docker run -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY img`,
		`          aws s3 ls "${AWS_ACCESS_KEY_ID:-}" "$AWS_SECRET_ACCESS_KEY"`,
		`      # aws-access-key-id: ${{ secrets.OLD_AWS_ACCESS_KEY_ID }}`,
		`          node -e "console.log(process.env.AWS_ACCESS_KEY_ID)"`,
		`          python -c "import os; print(os.environ['AWS_ACCESS_KEY_ID'])"`,
	} {
		assert.False(t, ciguard.IsStoredAWSKeyLine(line), line)
	}
}

// @scenario "An AWS key set from anything but an OIDC session fails CI"
func TestStaticCloudKeysRefusesAMultilineKeyValue(t *testing.T) {
	step := "      - env:\n          AWS_SECRET_ACCESS_KEY: >-\n            ${{ secrets.CI_KEY }}\n        run: aws s3 ls\n"
	workflow := strings.Replace(oidcOnlyWorkflow, "      - run: aws s3 ls \"$AWS_ACCESS_KEY_ID\"\n", step, 1)
	require.NotEqual(t, oidcOnlyWorkflow, workflow)

	problems, err := ciguard.StaticCloudKeys(writeRepo(t, map[string]string{".github/workflows/other.yml": workflow}))

	require.NoError(t, err)
	require.Len(t, problems, 1)
	assert.Contains(t, problems[0], ".github/workflows/other.yml:18:")
}

func TestStaticCloudKeysScansTheKnownWorkflowsAndActions(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	files, err := ciguard.WorkflowAndActionFiles(root)

	require.NoError(t, err)
	assert.Contains(t, files, embedsPath)
	assert.Contains(t, files, ".github/workflows/gateway-matrix.yaml")
	assert.Contains(t, files, ".github/workflows/go-ci.yaml")
	assert.GreaterOrEqual(t, len(files), 50, "the guard found too few workflow and action files; is the repository root right?")
}
