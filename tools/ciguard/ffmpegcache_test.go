package ciguard

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

const goodFfmpegAction = `runs:
  using: composite
  steps:
    - name: Key
      id: ffmpeg-key
      if: steps.media-cache.outputs.cache-hit != 'true' && steps.media-restore.outputs.cache-hit != 'true'
      run: echo "key=ffmpeg-debs-${RUNNER_OS}-${ImageOS:-unknown}-${ImageVersion:-unknown}" >> "$GITHUB_OUTPUT"
    - name: Restore
      id: ffmpeg-debs
      if: steps.media-cache.outputs.cache-hit != 'true' && steps.media-restore.outputs.cache-hit != 'true'
      uses: actions/cache/restore@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
      with:
        path: ~/.cache/ffmpeg-debs
        key: ${{ steps.ffmpeg-key.outputs.key }}
    - name: Install
      id: ffmpeg-install
      if: steps.media-cache.outputs.cache-hit != 'true' && steps.media-restore.outputs.cache-hit != 'true'
      run: |
        debs="$HOME/.cache/ffmpeg-debs"
        timeout 600 bash -c "
          sudo apt-get -o Dir::Cache::Archives=$debs install -y ffmpeg
        "
    - name: Save
      if: steps.media-cache.outputs.cache-hit != 'true' && steps.media-restore.outputs.cache-hit != 'true' && steps.ffmpeg-debs.outputs.cache-hit != 'true'
      uses: actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9 # v6.1.0
      with:
        path: ~/.cache/ffmpeg-debs
        key: ${{ steps.ffmpeg-key.outputs.key }}
`

func ffmpegProblems(t *testing.T, action string) []string {
	t.Helper()
	root := t.TempDir()
	path := filepath.Join(root, docsEncodersAction)
	require.NoError(t, os.MkdirAll(filepath.Dir(path), 0o750))
	require.NoError(t, os.WriteFile(path, []byte(action), 0o600))
	problems, err := FfmpegCacheProblems(root)
	require.NoError(t, err)
	return problems
}

func TestFfmpegCacheHoldsOnThisRepository(t *testing.T) {
	root, err := ciscan.RepoRoot(".")
	require.NoError(t, err)

	problems, err := FfmpegCacheProblems(root)
	require.NoError(t, err)
	assert.Empty(t, problems)
}

// @scenario "A cold run installs ffmpeg and saves the packages it downloaded"
func TestFfmpegColdRunSavesWhatAptDownloaded(t *testing.T) {
	assert.Empty(t, ffmpegProblems(t, goodFfmpegAction))

	noArchives := strings.Replace(goodFfmpegAction, "-o Dir::Cache::Archives=$debs ", "", 1)
	noSave := strings.Replace(goodFfmpegAction, "actions/cache/save@", "actions/other@", 1)
	lastKey := strings.LastIndex(goodFfmpegAction, "key: ${{ steps.ffmpeg-key.outputs.key }}")
	wrongSaveKey := goodFfmpegAction[:lastKey] + "key: fixed\n"
	unpinned := strings.Replace(goodFfmpegAction, "actions/cache/save@55cc8345863c7cc4c66a329aec7e433d2d1c52a9", "actions/cache/save@v4", 1)

	assert.NotEmpty(t, ffmpegProblems(t, noArchives))
	assert.NotEmpty(t, ffmpegProblems(t, noSave))
	assert.NotEmpty(t, ffmpegProblems(t, wrongSaveKey))
	assert.NotEmpty(t, ffmpegProblems(t, unpinned))
}

// @scenario "A warm run installs from the restored packages"
func TestFfmpegWarmRunRestoresWhereAptLooks(t *testing.T) {
	wrongPath := strings.Replace(goodFfmpegAction, "path: ~/.cache/ffmpeg-debs", "path: ~/.cache/elsewhere", 1)
	wrongKey := strings.Replace(goodFfmpegAction, "key: ${{ steps.ffmpeg-key.outputs.key }}", "key: fixed", 1)
	wrongDir := strings.Replace(goodFfmpegAction, `debs="$HOME/.cache/ffmpeg-debs"`, `debs="$HOME/.cache/elsewhere"`, 1)
	savesOnHit := strings.Replace(goodFfmpegAction, " && steps.ffmpeg-debs.outputs.cache-hit != 'true'", "", 1)
	noTimeout := strings.Replace(goodFfmpegAction, "timeout 600 bash -c", "bash -c", 1)

	assert.NotEmpty(t, ffmpegProblems(t, wrongPath))
	assert.NotEmpty(t, ffmpegProblems(t, wrongKey))
	assert.NotEmpty(t, ffmpegProblems(t, wrongDir))
	assert.NotEmpty(t, ffmpegProblems(t, savesOnHit))
	assert.NotEmpty(t, ffmpegProblems(t, noTimeout))
}

// @scenario "A failed install saves nothing"
func TestFfmpegFailedInstallSavesNothing(t *testing.T) {
	afterFailure := strings.Replace(goodFfmpegAction, "      if: steps.media-cache.outputs.cache-hit != 'true' && steps.media-restore.outputs.cache-hit != 'true' && steps.ffmpeg-debs", "      if: always() && steps.ffmpeg-debs", 1)
	tolerated := strings.Replace(goodFfmpegAction, "      id: ffmpeg-install\n", "      id: ffmpeg-install\n      continue-on-error: true\n", 1)
	savePath := strings.LastIndex(goodFfmpegAction, "path: ~/.cache/ffmpeg-debs")
	wrongSavePath := goodFfmpegAction[:savePath] + "path: ~/.cache/elsewhere" + goodFfmpegAction[savePath+len("path: ~/.cache/ffmpeg-debs"):]
	notTolerated := strings.Replace(goodFfmpegAction, "      id: ffmpeg-install\n", "      id: ffmpeg-install\n      continue-on-error: false\n", 1)

	assert.Contains(t, strings.Join(ffmpegProblems(t, wrongSavePath), "\n"), "ffmpeg save path")
	for _, fn := range []string{"failure()", "cancelled()"} {
		gated := strings.Replace(goodFfmpegAction, "&& steps.ffmpeg-debs.outputs.cache-hit != 'true'", "&& steps.ffmpeg-debs.outputs.cache-hit != 'true' && "+fn, 1)
		assert.NotEqual(t, goodFfmpegAction, gated, fn)
		assert.Contains(t, strings.Join(ffmpegProblems(t, gated), "\n"), "failed install", fn)
	}
	assert.Empty(t, ffmpegProblems(t, notTolerated))

	assert.Contains(t, strings.Join(ffmpegProblems(t, afterFailure), "\n"), "failed install")
	assert.Contains(t, strings.Join(ffmpegProblems(t, tolerated), "\n"), "continue-on-error")
}

// @scenario "An exact docs-media cache hit skips the ffmpeg steps"
func TestFfmpegStepsSkipOnADocsMediaHit(t *testing.T) {
	for _, gate := range mediaCacheHitGates {
		// The gate leads some conditions and trails others.
		ungated := strings.ReplaceAll(strings.ReplaceAll(goodFfmpegAction, gate+" && ", ""), " && "+gate, "")
		assert.NotEqual(t, goodFfmpegAction, ungated, gate)
		assert.NotEmpty(t, ffmpegProblems(t, ungated), gate)
	}
}

// @scenario "A new runner image downloads once and saves again"
func TestFfmpegKeyNamesTheRunnerImage(t *testing.T) {
	for name, part := range map[string]string{"OS": "${RUNNER_OS}", "image": "${ImageOS:-unknown}", "image version": "${ImageVersion:-unknown}"} {
		t.Run("a key without the runner "+name+" is refused", func(t *testing.T) {
			assert.NotEmpty(t, ffmpegProblems(t, strings.Replace(goodFfmpegAction, "-"+part, "", 1)))
		})
	}
}
