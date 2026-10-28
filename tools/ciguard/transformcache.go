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

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// Spec: specs/ci/package-suites-transform-cache.feature

const (
	appCIWorkflow       = ".github/workflows/langwatch-app-ci.yml"
	packageSuitesJob    = "package-suites"
	transformCachePath  = "node_modules/.vitest-cache"
	transformInputsStep = "transform-inputs"
	commitSuffix        = "${{ github.sha }}"
)

// transformInputs is what the hash a transform cache is restored by must cover:
// what decides a transform's output besides the module's own source.
// packages/vitest-config is there because every config imports it as a package, so vitest
// does not count its source, which sets the plugins and their options, as a config file.
var transformInputs = []string{"pnpm-lock.yaml", "package.json", "tsconfig", "packages/vitest-config"}

// TransformCacheProblems checks that the package-suites job restores vitest's
// transformed modules only when nothing a transform depends on besides its
// source has changed, per shard, and trims them before saving.
func TransformCacheProblems(root string) ([]string, error) {
	workflow, err := ciscan.Load(root, appCIWorkflow)
	if err != nil {
		return nil, err
	}
	job, ok := workflow.Jobs[packageSuitesJob]
	if !ok {
		return []string{appCIWorkflow + ": no package-suites job"}, nil
	}
	problems := inputsHashProblems(job.Steps)
	caches := 0
	for i := range job.Steps {
		if path, _ := job.Steps[i].With["path"].(string); path == transformCachePath {
			caches++
			problems = append(problems, transformKeyProblems(job.Steps[i])...)
		}
	}
	if caches == 0 {
		problems = append(problems, "package-suites restores no "+transformCachePath)
	}
	return append(problems, trimProblems(job.Steps)...), nil
}

func inputsHashProblems(steps []ciscan.Step) []string {
	i := slices.IndexFunc(steps, func(s ciscan.Step) bool { return s.ID == transformInputsStep })
	if i == -1 {
		return []string{"package-suites has no step with id " + transformInputsStep}
	}
	var problems []string
	for _, input := range transformInputs {
		if !strings.Contains(steps[i].Run, input) {
			problems = append(problems, fmt.Sprintf("step %q does not hash %s", steps[i].Name, input))
		}
	}
	return problems
}

func transformKeyProblems(step ciscan.Step) []string {
	key, _ := step.With["key"].(string)
	restore, _ := step.With["restore-keys"].(string)
	var problems []string
	for _, part := range []string{"${{ matrix.shard }}", "${{ steps." + transformInputsStep + ".outputs.hash }}"} {
		if !strings.Contains(key, part) {
			problems = append(problems, fmt.Sprintf("step %q: key does not name %s", step.Name, part))
		}
	}
	if !strings.HasSuffix(key, "-"+commitSuffix) {
		problems = append(problems, fmt.Sprintf("step %q: key does not end in the commit", step.Name))
	}
	if strings.TrimSpace(restore) != strings.TrimSuffix(key, commitSuffix) {
		problems = append(problems, fmt.Sprintf("step %q: restore-keys may restore a cache built from other inputs; it must be the key without the commit", step.Name))
	}
	return problems
}

// trimCommand drops the whole cache past a size, never single entries by age: a restored
// entry keeps the time it was first written, so an age purge drops the hottest first.
var trimCommand = regexp.MustCompile(`du -sm ` + regexp.QuoteMeta(transformCachePath) + `.*-gt \d+ \]; then rm -rf ` + regexp.QuoteMeta(transformCachePath))

var agePurge = regexp.MustCompile(`find ` + regexp.QuoteMeta(transformCachePath) + `.*-[acm](time|min) `)

func trimProblems(steps []ciscan.Step) []string {
	var problems []string
	if slices.ContainsFunc(steps, func(s ciscan.Step) bool { return agePurge.MatchString(s.Run) }) {
		problems = append(problems, "package-suites purges transforms by age, which drops the entries every run reads")
	}
	if !slices.ContainsFunc(steps, func(s ciscan.Step) bool { return trimCommand.MatchString(s.Run) }) {
		problems = append(problems, "package-suites never bounds the transform cache, so the saved cache only grows")
	}
	return problems
}

// vitestRun is a package script that runs vitest; configFlag one that names its config.
var (
	vitestRun  = regexp.MustCompile(`\bvitest run\b`)
	configFlag = regexp.MustCompile(`(--config|(^|\s)-c)[\s=]`)
)

// UncachedVitestScripts lists the package suite scripts that run vitest with no
// config file, and so with vitest's own default of not persisting transforms,
// without asking for it on the command line.
func UncachedVitestScripts(root string) ([]string, error) {
	var found []string
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return skipDir(root, path, entry.Name())
		}
		if entry.Name() != "package.json" {
			return nil
		}
		missing, err := uncachedScriptsIn(filepath.Dir(path))
		rel, _ := filepath.Rel(root, path)
		for _, script := range missing {
			found = append(found, rel+" "+script)
		}
		return err
	})
	return found, err
}

// skipDir leaves out installed packages, build output, fixtures and dot directories.
func skipDir(root, path, name string) error {
	if path != root && (strings.HasPrefix(name, ".") || name == "node_modules" || name == "dist" || name == "__fixtures__") {
		return filepath.SkipDir
	}
	return nil
}

func uncachedScriptsIn(dir string) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join(dir, "package.json"))
	if err != nil {
		return nil, err
	}
	var manifest struct {
		Scripts map[string]string `json:"scripts"`
	}
	// A manifest that is not JSON is a fixture, not a package that runs suites.
	if unmarshalErr := json.Unmarshal(raw, &manifest); unmarshalErr != nil || hasVitestConfig(dir) {
		return nil, nil //nolint:nilerr // see above
	}
	var missing []string
	for _, name := range []string{"test", "test:unit", "test:integration"} {
		body := manifest.Scripts[name]
		if vitestRun.MatchString(body) && !configFlag.MatchString(body) && !strings.Contains(body, "--fsModuleCache") {
			missing = append(missing, name)
		}
	}
	return missing, nil
}

func hasVitestConfig(dir string) bool {
	for _, ext := range []string{"ts", "mts", "js", "mjs"} {
		if _, err := os.Stat(filepath.Join(dir, "vitest.config."+ext)); err == nil {
			return true
		}
	}
	return false
}
