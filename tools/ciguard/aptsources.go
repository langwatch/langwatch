package ciguard

import (
	"encoding/json"
	"fmt"
	"io/fs"
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

// aptDirect reaches apt itself; run-package-suites.ts runs every package's test:browser lane,
// which installs Playwright with --with-deps.
const aptDirect = `\bapt-get\b[^\n]*\b(update|install)\b|playwright install --with-deps|run-package-suites\.ts`

// aptSkippedDirs hold no package.json a workflow runs.
var aptSkippedDirs = map[string]bool{"node_modules": true, ".git": true, ".worktrees": true, ".claude": true, "dist": true, ".nx": true}

// aptMatcher tells whether a step that reaches apt, directly or through a package script.
type aptMatcher struct{ run *regexp.Regexp }

// AptUbuntuSourcesProblems checks that the shared action exists and that every workflow job
// and local action runs it before its first apt-get call or Playwright system install.
func AptUbuntuSourcesProblems(root string) ([]string, error) {
	if _, err := loadAptSourcesStep(root); err != nil {
		return nil, err
	}
	scripts, err := playwrightDepsScripts(root)
	if err != nil {
		return nil, err
	}
	m := newAptMatcher(scripts)
	jobs, err := aptJobsProblems(root, m)
	if err != nil {
		return nil, err
	}
	actions, err := aptLocalActionsProblems(root, m)
	if err != nil {
		return nil, err
	}
	return append(jobs, actions...), nil
}

func newAptMatcher(scripts []string) aptMatcher {
	pattern := aptDirect
	if len(scripts) > 0 {
		quoted := make([]string, len(scripts))
		for i, s := range scripts {
			quoted[i] = regexp.QuoteMeta(s)
		}
		pattern += `|\bpnpm\b[^\n]*[\s'"](` + strings.Join(quoted, "|") + `)(\s|$|['"])`
	}
	return aptMatcher{run: regexp.MustCompile(pattern)}
}

// playwrightDepsScripts names the package.json scripts that install Playwright with its system packages.
func playwrightDepsScripts(root string) ([]string, error) {
	seen := map[string]bool{}
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		switch {
		case err != nil:
			return err
		case d.IsDir() && aptSkippedDirs[d.Name()]:
			return filepath.SkipDir
		case d.Name() == "package.json":
			return addPlaywrightDepsScripts(path, seen)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(seen))
	for name := range seen {
		names = append(names, name)
	}
	slices.Sort(names)
	return names, nil
}

func addPlaywrightDepsScripts(path string, seen map[string]bool) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read %s: %w", path, err)
	}
	var pkg struct {
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return fmt.Errorf("parse %s: %w", path, err)
	}
	for name, command := range pkg.Scripts {
		if strings.Contains(command, "playwright install --with-deps") {
			seen[name] = true
		}
	}
	return nil
}

func aptJobsProblems(root string, m aptMatcher) ([]string, error) {
	workflows, err := ciscan.LoadAll(root)
	if err != nil {
		return nil, err
	}
	var problems []string
	for _, w := range workflows {
		for _, name := range w.JobNames() {
			problems = append(problems, m.stepsProblems(fmt.Sprintf("%s job %q", w.Path, name), w.Jobs[name].Steps)...)
		}
	}
	return problems, nil
}

func aptLocalActionsProblems(root string, m aptMatcher) ([]string, error) {
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
		problems = append(problems, m.stepsProblems(rel, steps)...)
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

// stepsProblems reports the first step that reaches apt before the shared action has run.
func (m aptMatcher) stepsProblems(where string, steps []ciscan.Step) []string {
	for i := range steps {
		if strings.HasSuffix(steps[i].Uses, aptSourcesUse) {
			return nil
		}
		if m.needsApt(&steps[i]) {
			label := steps[i].Name
			if label == "" {
				label = steps[i].Uses
			}
			return []string{fmt.Sprintf("%s: step %q reaches apt before ./%s has disabled the third-party sources", where, label, aptSourcesUse)}
		}
	}
	return nil
}

// needsApt is a step that runs apt-get or a script that installs Playwright's system packages,
// or caches the Playwright browser for a job whose scripts then install them.
func (m aptMatcher) needsApt(s *ciscan.Step) bool {
	if m.run.MatchString(s.Run) {
		return true
	}
	return strings.HasPrefix(s.Uses, "actions/cache") && strings.Contains(fmt.Sprint(s.With["path"]), "ms-playwright")
}
