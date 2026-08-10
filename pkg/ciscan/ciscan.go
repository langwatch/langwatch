// Package ciscan reads this repository's GitHub Actions workflows into a
// shape the CI guards under tools/ciguard can assert against.
//
// The guards exist because CI has behavior of its own — how it checks out,
// which toolchain it compiles with — and that behavior regresses silently.
// Nothing breaks when a new job forgets the sparse-checkout or pins a Go
// version by hand; CI just gets slower, or builds with a toolchain the module
// never asked for, and nobody notices until somebody measures it again.
package ciscan

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// Step is one entry in a job's `steps:` list. Only the fields the guards read
// are modeled; everything else in a workflow is deliberately ignored.
type Step struct {
	Name string            `yaml:"name"`
	Uses string            `yaml:"uses"`
	With map[string]any    `yaml:"with"`
	Env  map[string]string `yaml:"env"`
}

// Job is one entry under `jobs:`.
type Job struct {
	Name  string `yaml:"name"`
	Steps []Step `yaml:"steps"`
}

// Workflow is a single .yml file under .github/workflows.
type Workflow struct {
	// Path is repo-relative, so guard output is copy-pasteable.
	Path string
	Jobs map[string]Job `yaml:"jobs"`
}

// WorkflowDir is where GitHub requires workflows to live.
const WorkflowDir = ".github/workflows"

// Load reads one workflow file.
func Load(repoRoot, relPath string) (*Workflow, error) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, relPath))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", relPath, err)
	}

	workflow := &Workflow{Path: relPath}
	if err := yaml.Unmarshal(raw, workflow); err != nil {
		return nil, fmt.Errorf("parse %s: %w", relPath, err)
	}

	return workflow, nil
}

// LoadAll reads every workflow in the repository, sorted by path so guard
// output is stable between runs.
func LoadAll(repoRoot string) ([]*Workflow, error) {
	entries, err := os.ReadDir(filepath.Join(repoRoot, WorkflowDir))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", WorkflowDir, err)
	}

	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if ext := filepath.Ext(entry.Name()); ext != ".yml" && ext != ".yaml" {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)

	workflows := make([]*Workflow, 0, len(names))
	for _, name := range names {
		workflow, err := Load(repoRoot, filepath.ToSlash(filepath.Join(WorkflowDir, name)))
		if err != nil {
			return nil, err
		}
		workflows = append(workflows, workflow)
	}

	return workflows, nil
}

// JobNames returns the job keys in sorted order. Ranging a map directly would
// make guard output reorder itself between runs for no reason.
func (w *Workflow) JobNames() []string {
	names := make([]string, 0, len(w.Jobs))
	for name := range w.Jobs {
		names = append(names, name)
	}
	sort.Strings(names)

	return names
}

// CheckoutStep is one actions/checkout invocation, paired with the workflow
// and job it belongs to so a guard can name where a problem is.
type CheckoutStep struct {
	Workflow string
	Job      string
	Step     Step
}

// CheckoutSteps finds every actions/checkout invocation in the workflow.
func (w *Workflow) CheckoutSteps() []CheckoutStep {
	var found []CheckoutStep
	for _, job := range w.JobNames() {
		for _, step := range w.Jobs[job].Steps {
			if strings.HasPrefix(step.Uses, "actions/checkout@") {
				found = append(found, CheckoutStep{Workflow: w.Path, Job: job, Step: step})
			}
		}
	}

	return found
}

// StringWith reads a `with:` value as a string. GitHub accepts unquoted
// scalars, so a value like `false` arrives as a bool and a version like 1.26
// as a float; both are rendered rather than dropped, because a guard that
// silently ignores a mistyped value enforces nothing.
func (s Step) StringWith(key string) (string, bool) {
	value, ok := s.With[key]
	if !ok {
		return "", false
	}

	switch typed := value.(type) {
	case string:
		return typed, true
	case nil:
		return "", true
	default:
		return fmt.Sprint(typed), true
	}
}

// Has reports whether the step declares the key at all, regardless of whether
// the value parses.
func (s Step) Has(key string) bool {
	_, ok := s.With[key]

	return ok
}

// BoolWith reads a `with:` value as a bool, accepting YAML's unquoted form and
// the quoted string form.
//
// `valid` is false for anything that is not recognizably true or false —
// including a typo like `flase`. Returning "present, and false" for a typo is
// how a guard silently passes: `sparse-checkout-cone-mode: flase` would have
// read as an explicit false and satisfied the cone-mode check, in a guard
// whose entire job is catching that class of mistake.
func (s Step) BoolWith(key string) (value bool, valid bool) {
	raw, ok := s.With[key]
	if !ok {
		return false, false
	}

	switch typed := raw.(type) {
	case bool:
		return typed, true
	case string:
		switch {
		case strings.EqualFold(typed, "true"):
			return true, true
		case strings.EqualFold(typed, "false"):
			return false, true
		default:
			return false, false
		}
	default:
		return false, false
	}
}

// SparsePatterns splits a multi-line `sparse-checkout` value into its
// patterns, dropping blank lines.
func (s Step) SparsePatterns() []string {
	raw, ok := s.StringWith("sparse-checkout")
	if !ok {
		return nil
	}

	var patterns []string
	for line := range strings.SplitSeq(raw, "\n") {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			patterns = append(patterns, trimmed)
		}
	}

	return patterns
}

// RepoRoot walks up from dir until it finds the directory holding go.work,
// so a guard can be run from anywhere in the tree.
func RepoRoot(dir string) (string, error) {
	current, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}

	for {
		if _, err := os.Stat(filepath.Join(current, "go.work")); err == nil {
			return current, nil
		}
		parent := filepath.Dir(current)
		if parent == current {
			return "", fmt.Errorf("no go.work found above %s", dir)
		}
		current = parent
	}
}
