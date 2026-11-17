package newestimage_test

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

type workflow struct {
	Jobs map[string]struct {
		If    string `yaml:"if"`
		Needs any    `yaml:"needs"`
		Steps []struct {
			Uses string            `yaml:"uses"`
			Run  string            `yaml:"run"`
			With map[string]string `yaml:"with"`
		} `yaml:"steps"`
	} `yaml:"jobs"`
}

func readWorkflow(t *testing.T, name string) (workflow, string) {
	t.Helper()
	src, err := os.ReadFile("../../.github/workflows/" + name)
	require.NoError(t, err)
	var wf workflow
	require.NoError(t, yaml.Unmarshal(src, &wf))

	return wf, string(src)
}

// @scenario "The release copies, signs and attests the model image"
func TestTheReleaseCopiesSignsAndAttestsTheModelImage(t *testing.T) {
	wf, _ := readWorkflow(t, "publish-docker-app.yml")
	job, ok := wf.Jobs["pii-redaction-model"]
	require.True(t, ok, "publish-docker-app.yml has no pii-redaction-model job")
	assert.Contains(t, job.If, "is_release == 'true'")

	var runs []string
	role := ""
	for _, s := range job.Steps {
		runs = append(runs, s.Run)
		if strings.HasPrefix(s.Uses, "aws-actions/configure-aws-credentials@") {
			role = s.With["role-to-assume"]
			assert.Empty(t, s.With["aws-access-key-id"], "OIDC only, no stored key")
		}
	}
	all := strings.Join(runs, "\n")
	assert.Equal(t, "${{ steps.account.outputs.role }}", role)
	assert.Contains(t, all, ":role/langwatch-oss-pii-model-reader")
	for _, want := range []string{
		"go run ./cmd/newestimage -prefix http-git-",
		`docker buildx imagetools create -t "${REPO}:${VERSION}" "${SOURCE}"`,
		`docker buildx imagetools create -t "${REPO}:latest" "${SOURCE}"`,
		"bash .github/scripts/sign-image.sh",
		"gh release upload",
	} {
		assert.Contains(t, all, want)
	}
	assert.Less(t, strings.Index(all, "imagetools create"), strings.Index(all, "sign-image.sh"))

	sign, err := os.ReadFile("../../.github/scripts/sign-image.sh")
	require.NoError(t, err)
	assert.Contains(t, string(sign), "cosign verify", "sign-image.sh verifies every signature it makes")

	assert.Contains(t, wf.Jobs["notify"].Needs, "pii-redaction-model",
		"the release is announced only once the model image is out")
	_, chart := readWorkflow(t, "release-langwatch-chart.yml")
	assert.Contains(t, chart, `workflows: ["publish-docker-app"]`)
	assert.Contains(t, chart, "github.event.workflow_run.conclusion == 'success'",
		"the chart release runs only when the model image was published")
}
