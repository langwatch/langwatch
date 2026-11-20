package ciguard

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// Spec: specs/ci/docs-ffmpeg-cache.feature

const (
	docsEncodersAction = ".github/actions/docs-media-encoders/action.yml"
	ffmpegDebsPath     = "~/.cache/ffmpeg-debs"
	ffmpegKeyOutput    = "${{ steps.ffmpeg-key.outputs.key }}"
	ffmpegKeyStep      = "ffmpeg-key"
	ffmpegRestoreStep  = "ffmpeg-debs"
	ffmpegInstallStep  = "ffmpeg-install"
)

var (
	ffmpegArchivesOption = regexp.MustCompile(`-o Dir::Cache::Archives=\$debs\b`)
	ffmpegTimeout        = regexp.MustCompile(`timeout \d+ bash -c`)
)

// ffmpegKeyParts are what a package cache key must name so a new runner image misses.
var ffmpegKeyParts = []string{"${RUNNER_OS}", "${ImageOS", "${ImageVersion"}

// mediaCacheHitGates are the exact-hit checks that skip every ffmpeg step.
var mediaCacheHitGates = []string{"steps.media-cache.outputs.cache-hit != 'true'", "steps.media-restore.outputs.cache-hit != 'true'"}

// FfmpegCacheProblems checks that the docs-media-encoders action keys its
// ffmpeg package cache per runner image, installs into the cached directory
// under a timeout, and saves only after a restore miss.
func FfmpegCacheProblems(root string) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join(root, docsEncodersAction))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", docsEncodersAction, err)
	}
	var action struct {
		Runs struct {
			Steps []ciscan.Step `yaml:"steps"`
		} `yaml:"runs"`
	}
	if err := yaml.Unmarshal(raw, &action); err != nil {
		return nil, fmt.Errorf("parse %s: %w", docsEncodersAction, err)
	}
	steps := action.Runs.Steps
	find := func(id string) (ciscan.Step, bool) {
		i := slices.IndexFunc(steps, func(s ciscan.Step) bool { return s.ID == id })
		if i == -1 {
			return ciscan.Step{}, false
		}
		return steps[i], true
	}
	var problems []string
	key, okKey := find(ffmpegKeyStep)
	restore, okRestore := find(ffmpegRestoreStep)
	install, okInstall := find(ffmpegInstallStep)
	if !okKey || !okRestore || !okInstall {
		return []string{docsEncodersAction + ": missing the ffmpeg key, restore or install step"}, nil
	}
	problems = append(problems, ffmpegKeyProblems(&key)...)
	problems = append(problems, ffmpegRestoreProblems(&restore)...)
	problems = append(problems, ffmpegInstallProblems(&install)...)
	for _, step := range []*ciscan.Step{&key, &restore, &install} {
		problems = append(problems, mediaGateProblems(step)...)
	}
	return append(problems, ffmpegSaveProblems(steps)...), nil
}

// ffmpegKeyProblems reports the runner-image parts the cache key script fails to name.
func ffmpegKeyProblems(key *ciscan.Step) []string {
	var problems []string
	for _, part := range ffmpegKeyParts {
		if !strings.Contains(key.Run, part) {
			problems = append(problems, fmt.Sprintf("ffmpeg key does not name %s, so a new runner image would restore stale packages", part))
		}
	}
	return problems
}

// ffmpegInstallProblems reports install-step settings that break the cached download or let it stall.
func ffmpegInstallProblems(install *ciscan.Step) []string {
	var problems []string
	if !ffmpegArchivesOption.MatchString(install.Run) {
		problems = append(problems, "ffmpeg install does not download into the cached directory (-o Dir::Cache::Archives=$debs)")
	}
	if !strings.Contains(install.Run, `debs="$HOME/.cache/ffmpeg-debs"`) {
		problems = append(problems, "ffmpeg install's directory is not the one the cache restores, "+ffmpegDebsPath)
	}
	if !ffmpegTimeout.MatchString(install.Run) {
		problems = append(problems, "ffmpeg install has no timeout, so a trickling mirror can stall the job")
	}
	if coe := install.ContinueOnError; coe != nil && fmt.Sprint(coe) != "false" {
		problems = append(problems, "ffmpeg install sets continue-on-error, so a failed install would not stop the job")
	}
	return problems
}

func ffmpegRestoreProblems(restore *ciscan.Step) []string {
	var problems []string
	if got, _ := restore.With["key"].(string); got != ffmpegKeyOutput {
		problems = append(problems, fmt.Sprintf("ffmpeg restore key is %q, want %q", got, ffmpegKeyOutput))
	}
	if got, _ := restore.With["path"].(string); got != ffmpegDebsPath {
		problems = append(problems, fmt.Sprintf("ffmpeg restore path is %q, want %q", got, ffmpegDebsPath))
	}
	return problems
}

func mediaGateProblems(step *ciscan.Step) []string {
	var problems []string
	for _, gate := range mediaCacheHitGates {
		if !strings.Contains(step.If, gate) {
			problems = append(problems, fmt.Sprintf("step %q is not skipped by %q", step.Name, gate))
		}
	}
	return problems
}

func ffmpegSaveProblems(steps []ciscan.Step) []string {
	i := slices.IndexFunc(steps, func(s ciscan.Step) bool { return strings.HasPrefix(s.Uses, "actions/cache/save@") })
	if i == -1 {
		return []string{"no step saves the ffmpeg packages"}
	}
	save := steps[i]
	var problems []string
	if !fullSHAPattern.MatchString(strings.TrimPrefix(save.Uses, "actions/cache/save@")) {
		problems = append(problems, fmt.Sprintf("ffmpeg save %q is not pinned to a full commit SHA", save.Uses))
	}
	if !strings.Contains(save.If, "steps."+ffmpegRestoreStep+".outputs.cache-hit != 'true'") {
		problems = append(problems, "ffmpeg save is not gated on a restore miss, so every run would try to save")
	}
	if got, _ := save.With["key"].(string); got != ffmpegKeyOutput {
		problems = append(problems, fmt.Sprintf("ffmpeg save key is %q, want %q", got, ffmpegKeyOutput))
	}
	if got, _ := save.With["path"].(string); got != ffmpegDebsPath {
		problems = append(problems, fmt.Sprintf("ffmpeg save path is %q, want %q", got, ffmpegDebsPath))
	}
	// A failed install stops the job, so only a save that runs past failure could cache a half download.
	if strings.Contains(save.If, "always()") || strings.Contains(save.If, "failure()") || strings.Contains(save.If, "cancelled()") {
		problems = append(problems, "ffmpeg save runs after a failed install, so a half download could be cached")
	}
	return append(problems, mediaGateProblems(&save)...)
}
