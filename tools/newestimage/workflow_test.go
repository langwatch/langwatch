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

type concurrency struct {
	Group            string `yaml:"group"`
	CancelInProgress *bool  `yaml:"cancel-in-progress"`
}

type workflow struct {
	Jobs map[string]struct {
		If          string      `yaml:"if"`
		Needs       any         `yaml:"needs"`
		Concurrency concurrency `yaml:"concurrency"`
		Steps       []step      `yaml:"steps"`
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
    denied) echo "ERROR: pull access denied, repository does not exist or may require authorization: server message: insufficient_scope" >&2; return 1 ;;
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

	_, log, err = runReleasedStep(t, script, "denied")
	require.Error(t, err, "a repository Docker Hub denies is not a first run")
	assert.Contains(t, log, "insufficient_scope")

	_, log, err = runReleasedStep(t, script, "broken")
	require.Error(t, err, "an answer that is neither found nor not found must fail the job")
	assert.Contains(t, log, "401")
}

// runNewestStep runs the newest step with gh replaced by a shell function
// that lists tags (space-separated) as the published releases, or fails.
func runNewestStep(t *testing.T, script, tags string) (string, string, error) {
	t.Helper()
	dir := t.TempDir()
	fake := `gh() {
  if [ "$TAGS" = "broken" ]; then echo "HTTP 502: Bad Gateway" >&2; return 1; fi
  printf '%s\n' $TAGS
}
`
	root, err := os.OpenRoot(dir)
	require.NoError(t, err)
	defer root.Close()
	require.NoError(t, root.WriteFile("newest.sh", []byte(fake+script), 0o600))
	cmd := exec.Command("bash", "newest.sh")
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "TAGS="+tags, "RELEASE_TAG=langwatch@v3.1.0", "GITHUB_REPOSITORY=langwatch/langwatch", "GITHUB_OUTPUT="+filepath.Join(dir, "output"))
	log, runErr := cmd.CombinedOutput()
	written, _ := root.ReadFile("output")

	return string(written), string(log), runErr
}

// @scenario "latest moves only for the newest release"
func TestLatestMovesOnlyForTheNewestRelease(t *testing.T) {
	if _, err := exec.LookPath("bash"); err != nil {
		t.Skip("bash is not installed")
	}
	wf, _ := readWorkflow(t, "publish-docker-app.yml")
	steps := wf.Jobs["pii-redaction-model"].Steps
	i := stepIndex(steps, func(s step) bool { return s.ID == "newest" })
	require.NotEqual(t, -1, i, "no step with id newest decides whether latest moves")
	assert.Contains(t, steps[i].Run, "select(.draft == false and .prerelease == false)")
	assert.Contains(t, steps[i].Run, "sort -V")
	for _, s := range steps {
		if strings.Contains(s.Run, `"${REPO}:latest"`) || strings.Contains(s.Run, "sign-image.sh") {
			assert.Contains(t, s.Run, `"${NEWEST}" = "true"`, "latest follows the newest step, not the version's shape")
			assert.NotContains(t, s.Run, "grep -qE", "the version regex no longer decides latest")
		}
	}

	// Another package's newer release, and a lower version that sorts after
	// 3.1.0 as text, must not count.
	out, log, err := runNewestStep(t, steps[i].Run, "python-sdk@v9.9.9 langwatch@v3.1.0 langwatch@v3.0.10 langwatch@v2.9.0")
	require.NoError(t, err, log)
	assert.Equal(t, "latest=true\n", out)

	out, log, err = runNewestStep(t, steps[i].Run, "langwatch@v3.10.0 langwatch@v3.1.0 python-sdk@v1.0.0")
	require.NoError(t, err, log)
	assert.Equal(t, "latest=false\n", out, "a re-run of an older release leaves latest alone")

	_, _, err = runNewestStep(t, steps[i].Run, "broken")
	require.Error(t, err, "when GitHub cannot say which release is latest, the job fails")
}

// @scenario "latest moves only for the newest release"
func TestReleaseRunsTakeTurnsOnLatest(t *testing.T) {
	wf, _ := readWorkflow(t, "publish-docker-app.yml")
	got := wf.Jobs["pii-redaction-model"].Concurrency
	require.NotEmpty(t, got.Group,
		"the job deciding and writing latest needs a concurrency group, or an older release run can move latest back")
	assert.NotContains(t, got.Group, "${{",
		"one fixed group for every release run, not one per ref")
	require.NotNil(t, got.CancelInProgress, "cancel-in-progress must be set")
	assert.False(t, *got.CancelInProgress,
		"a cancel between the copy and cosign sign leaves an unsigned image")
}
