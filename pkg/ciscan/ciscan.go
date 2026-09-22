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
type Step struct { //nolint:recvcheck // UnmarshalYAML must take a pointer receiver to populate the value; the read-only accessors stay value receivers.
	Name string            `yaml:"name"`
	Uses string            `yaml:"uses"`
	With map[string]any    `yaml:"with"`
	Env  map[string]string `yaml:"env"`

	// UsesComment is the trailing `# <version>` comment on the `uses:` line.
	// yaml keeps it on the node but drops it from Uses, and the pin guard needs
	// it to assert every SHA pin documents the version it points at. Empty when
	// the line carries no comment. Populated by UnmarshalYAML from the decoded
	// node, so — unlike a raw text scan — it is immune to a quoted value and to
	// `uses:` text that appears inside a run: script rather than as a real step.
	UsesComment string `yaml:"-"`
}

// UnmarshalYAML decodes the modeled step fields, then separately recovers the
// trailing comment on the `uses:` line so the pin guard can read it.
func (s *Step) UnmarshalYAML(node *yaml.Node) error {
	type plainStep Step
	var plain plainStep
	if err := node.Decode(&plain); err != nil {
		return err
	}
	*s = Step(plain)
	s.UsesComment = usesLineComment(node)

	return nil
}

// usesLineComment returns the trailing comment on the mapping's `uses:` entry,
// with the leading `#` and surrounding space stripped, or "" when there is
// none. yaml attaches a same-line trailing comment to the value node; some
// shapes leave it on the key, so both are checked.
func usesLineComment(mapping *yaml.Node) string {
	if mapping.Kind != yaml.MappingNode {
		return ""
	}
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		key, value := mapping.Content[i], mapping.Content[i+1]
		if key.Value != "uses" {
			continue
		}
		for _, raw := range []string{value.LineComment, key.LineComment} {
			if comment := strings.TrimSpace(strings.TrimPrefix(raw, "#")); comment != "" {
				return comment
			}
		}
	}

	return ""
}

// Job is one entry under `jobs:`. If is the job-level `if:` condition, read as
// literal text rather than evaluated — a guard's job is to notice a gate
// clause disappearing, not to re-implement GitHub's expression language.
type Job struct {
	Name  string `yaml:"name"`
	If    string `yaml:"if"`
	Steps []Step `yaml:"steps"`
}

// PullRequest is the `on.pull_request` trigger and the event types that fire
// it.
type PullRequest struct {
	Types []string `yaml:"types"`
}

// On models the workflow `on:` triggers the guards read. Only pull_request is
// modeled, because that is the trigger whose event types a guard asserts.
type On struct {
	PullRequest PullRequest `yaml:"pull_request"`
}

// UnmarshalYAML decodes the mapping form of `on:` and tolerates GitHub's
// shorthand forms — `on: [push]` (a sequence) and `on: push` (a scalar) — by
// yielding no trigger data instead of an error. LoadAll parses every workflow
// in the repo, so a single file written in shorthand must not fail the guards
// that only read some other workflow.
func (o *On) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind != yaml.MappingNode {
		return nil
	}
	type plainOn On
	var plain plainOn
	if err := node.Decode(&plain); err != nil {
		return err
	}
	*o = On(plain)

	return nil
}

// Concurrency models the workflow-level `concurrency:` block: the group runs
// share, and whether a superseded run is canceled.
type Concurrency struct { //nolint:recvcheck // UnmarshalYAML must take a pointer receiver to populate the value; CancelsInProgress stays a value receiver.
	Group            string `yaml:"group"`
	CancelInProgress any    `yaml:"cancel-in-progress"`
}

// UnmarshalYAML decodes the mapping form of `concurrency:` and tolerates the
// scalar shorthand — `concurrency: some-group` — by yielding no data instead
// of an error, so a workflow written that way does not fail a LoadAll that
// only needs some other file.
func (c *Concurrency) UnmarshalYAML(node *yaml.Node) error {
	if node.Kind != yaml.MappingNode {
		return nil
	}
	type plainConcurrency Concurrency
	var plain plainConcurrency
	if err := node.Decode(&plain); err != nil {
		return err
	}
	*c = Concurrency(plain)

	return nil
}

// CancelsInProgress reports whether cancel-in-progress is set to true,
// accepting YAML's unquoted form and the quoted string form. Anything absent,
// false, or not recognizably true — a typo like `ture` included — reads as
// false, which is exactly what the guard needs to know: a superseded run is
// left alive.
func (c Concurrency) CancelsInProgress() bool {
	switch typed := c.CancelInProgress.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(typed, "true")
	}

	return false
}

// Permissions models the workflow's top-level `permissions:` block. GitHub
// accepts either a per-scope mapping (`contents: write`) or a shorthand
// string (`read-all` / `write-all`); modeling only the mapping form turned
// the shorthand into a decode error that failed LoadAll for every guard —
// the same failure mode On and Concurrency were fixed for. Scopes holds the
// mapping form, keyed by scope with its grant. Shorthand holds the string
// form. Both are zero when the workflow declares no permissions block.
type Permissions struct {
	Scopes    map[string]string
	Shorthand string
}

// UnmarshalYAML decodes the mapping form of `permissions:` into Scopes and
// the scalar shorthand form into Shorthand, tolerating either so a workflow
// written with the shorthand does not fail a LoadAll that only needs some
// other file.
func (p *Permissions) UnmarshalYAML(node *yaml.Node) error {
	switch node.Kind {
	case yaml.MappingNode:
		return node.Decode(&p.Scopes)
	case yaml.ScalarNode:
		return node.Decode(&p.Shorthand)
	default:
		return nil
	}
}

// Workflow is a single .yml file under .github/workflows.
type Workflow struct {
	// Path is repo-relative, so guard output is copy-pasteable.
	Path        string
	On          On             `yaml:"on"`
	Permissions Permissions    `yaml:"permissions"`
	Concurrency Concurrency    `yaml:"concurrency"`
	Jobs        map[string]Job `yaml:"jobs"`
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
func (s Step) BoolWith(key string) (value bool, isValid bool) {
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
