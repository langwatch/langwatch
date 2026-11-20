package newestimage_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

type step struct {
	ID   string            `yaml:"id"`
	If   string            `yaml:"if"`
	Uses string            `yaml:"uses"`
	Run  string            `yaml:"run"`
	With map[string]string `yaml:"with"`
}

type workflow struct {
	Jobs map[string]struct {
		If    string `yaml:"if"`
		Needs any    `yaml:"needs"`
		Steps []step `yaml:"steps"`
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
		`docker buildx imagetools create -t "${REPO}:latest" "${REPO}@${DIGEST}"`,
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

// stepIndex is the position of the first step that matches, or -1.
func stepIndex(steps []step, match func(step) bool) int {
	for i, s := range steps {
		if match(s) {
			return i
		}
	}

	return -1
}

// @scenario "A re-run keeps the image the release already published"
func TestARerunReusesTheReleasedImage(t *testing.T) {
	wf, _ := readWorkflow(t, "publish-docker-app.yml")
	steps := wf.Jobs["pii-redaction-model"].Steps
	login := stepIndex(steps, func(s step) bool { return strings.HasPrefix(s.Uses, "docker/login-action@") })
	released := stepIndex(steps, func(s step) bool { return s.ID == "released" })
	pick := stepIndex(steps, func(s step) bool { return s.ID == "pick" })
	copyStep := stepIndex(steps, func(s step) bool { return strings.Contains(s.Run, "imagetools create") })
	require.NotEqual(t, -1, released, "no step with id released looks for the version on Docker Hub")
	require.NotEqual(t, -1, pick)
	require.NotEqual(t, -1, copyStep)
	assert.Less(t, login, released, "the Docker Hub login comes before the look-up")
	assert.Less(t, released, pick, "the look-up comes before the pick")
	assert.Contains(t, steps[pick].Run, `-released "${RELEASED}"`)
	assert.Contains(t, steps[pick].Run, "-platforms linux/amd64,linux/arm64")
	assert.Contains(t, steps[copyStep].Run, `if [ "${REUSED}" != "true" ]; then`,
		"a re-run never copies over the version tag")
}

// runReleasedStep runs the released step with docker replaced by a shell
// function that answers as Docker Hub would: found, missing or broken.
func runReleasedStep(t *testing.T, script, hub string) (string, string, error) {
	t.Helper()
	dir := t.TempDir()
	fake := `docker() {
  case "$HUB" in
    found) echo "sha256:1111111111111111111111111111111111111111111111111111111111111111" ;;
    missing) echo "ERROR: docker.io/langwatch/pii-redaction-model:3.1.0: not found" >&2; return 1 ;;
    *) echo "ERROR: failed to authorize: 401 Unauthorized" >&2; return 1 ;;
  esac
}
`
	root, err := os.OpenRoot(dir)
	require.NoError(t, err)
	defer root.Close()
	require.NoError(t, root.WriteFile("released.sh", []byte(fake+script), 0o600))
	cmd := exec.Command("bash", "released.sh")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "HUB="+hub, "REPO=langwatch/pii-redaction-model", "VERSION=3.1.0", "GITHUB_OUTPUT="+filepath.Join(dir, "output"))
	log, runErr := cmd.CombinedOutput()
	written, _ := root.ReadFile("output")

	return string(written), string(log), runErr
}

// @scenario "A re-run keeps the image the release already published"
func TestTheReleasedStepTellsFoundMissingAndBrokenApart(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash is not installed")
	}
	wf, _ := readWorkflow(t, "publish-docker-app.yml")
	steps := wf.Jobs["pii-redaction-model"].Steps
	i := stepIndex(steps, func(s step) bool { return s.ID == "released" })
	require.NotEqual(t, -1, i, "no step with id released")
	script := steps[i].Run

	out, log, err := runReleasedStep(t, script, "found")
	require.NoError(t, err, log)
	assert.Equal(t, "digest=sha256:1111111111111111111111111111111111111111111111111111111111111111\n", out)

	out, log, err = runReleasedStep(t, script, "missing")
	require.NoError(t, err, log)
	assert.Equal(t, "digest=\n", out)

	_, log, err = runReleasedStep(t, script, "broken")
	require.Error(t, err, "an answer that is neither found nor not found must fail the job")
	assert.Contains(t, log, "401")
}
