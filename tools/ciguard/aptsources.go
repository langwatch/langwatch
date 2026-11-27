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

// Spec: specs/ci/apt-ubuntu-sources.feature

const (
	aptSourcesAction = ".github/actions/apt-ubuntu-sources/action.yml"
	aptSourcesUse    = ".github/actions/apt-ubuntu-sources"
	aptSourcesStep   = "apt-ubuntu-sources"
)

var aptRun = regexp.MustCompile(`\bapt-get\b[^\n]*\b(update|install)\b|playwright install --with-deps`)

// AptUbuntuSourcesProblems checks that the shared action exists and that every workflow job
// and local action runs it before its first apt-get call or Playwright system install.
func AptUbuntuSourcesProblems(root string) ([]string, error) {
	if _, err := loadAptSourcesStep(root); err != nil {
		return nil, err
	}
	jobs, err := aptJobsProblems(root)
	if err != nil {
		return nil, err
	}
	actions, err := aptLocalActionsProblems(root)
	if err != nil {
		return nil, err
	}
	return append(jobs, actions...), nil
}

func aptJobsProblems(root string) ([]string, error) {
	workflows, err := ciscan.LoadAll(root)
	if err != nil {
		return nil, err
	}
	var problems []string
	for _, w := range workflows {
		for _, name := range w.JobNames() {
			problems = append(problems, aptStepsProblems(fmt.Sprintf("%s job %q", w.Path, name), w.Jobs[name].Steps)...)
		}
	}
	return problems, nil
}

func aptLocalActionsProblems(root string) ([]string, error) {
	actions, err := filepath.Glob(filepath.Join(root, ".github", "actions", "*", "action.yml"))
	if err != nil {
		return nil, err
	}
	var problems []string
	for _, path := range actions {
		rel, _ := filepath.Rel(root, path)
		if rel == aptSourcesAction {
			continue
		}
		steps, err := loadActionSteps(path)
		if err != nil {
			return nil, err
		}
		problems = append(problems, aptStepsProblems(rel, steps)...)
	}
	return problems, nil
}

// loadAptSourcesStep returns the shared action's step that disables the third-party sources.
func loadAptSourcesStep(root string) (*ciscan.Step, error) {
	steps, err := loadActionSteps(filepath.Join(root, aptSourcesAction))
	if err != nil {
		return nil, err
	}
	i := slices.IndexFunc(steps, func(s ciscan.Step) bool { return s.ID == aptSourcesStep })
	if i == -1 {
		return nil, fmt.Errorf("%s: missing the %s step", aptSourcesAction, aptSourcesStep)
	}
	return &steps[i], nil
}

func loadActionSteps(path string) ([]ciscan.Step, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	var action struct {
		Runs struct {
			Steps []ciscan.Step `yaml:"steps"`
		} `yaml:"runs"`
	}
	if err := yaml.Unmarshal(raw, &action); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return action.Runs.Steps, nil
}

// aptStepsProblems reports the first step that reaches apt before the shared action has run.
func aptStepsProblems(where string, steps []ciscan.Step) []string {
	for i := range steps {
		if strings.HasSuffix(steps[i].Uses, aptSourcesUse) {
			return nil
		}
		if needsApt(&steps[i]) {
			label := steps[i].Name
			if label == "" {
				label = steps[i].Uses
			}
			return []string{fmt.Sprintf("%s: step %q reaches apt before ./%s has disabled the third-party sources", where, label, aptSourcesUse)}
		}
	}
	return nil
}

// needsApt is a step that runs apt-get, installs Playwright's system packages, or caches the
// Playwright browser for a job whose scripts then run playwright install --with-deps.
func needsApt(s *ciscan.Step) bool {
	if aptRun.MatchString(s.Run) {
		return true
	}
	return strings.HasPrefix(s.Uses, "actions/cache") && strings.Contains(fmt.Sprint(s.With["path"]), "ms-playwright")
}
