package ciguard

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/langwatch/langwatch/pkg/ciscan"
)

// storedAWSKey matches a long-lived AWS key read from secrets, env or vars,
// or passed as configure-aws-credentials' aws-access-key-id input. A shell
// `$AWS_ACCESS_KEY_ID` is a session the job already holds, so it is ignored.
var storedAWSKey = regexp.MustCompile(
	`\b(?:secrets|env|vars)\.[A-Z0-9_]*AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)\b|^\s*-?\s*aws-access-key-id\s*:`,
)

// fallbackGate matches the `if:` of a stored-key step that runs only while
// the OIDC role variable is unset: `vars.<NAME> == ”`.
var fallbackGate = regexp.MustCompile(`vars\.([A-Z0-9_]+)\s*==\s*''`)

// StaticKeyFallbackVars are the role variables whose absence may still select
// a stored-key step during the move to OIDC, keyed to the one workflow each
// serves. Delete an entry once its fallback step is gone; a gate on any other
// variable is rejected, so a new stored key cannot hide behind a new variable.
var StaticKeyFallbackVars = map[string]string{
	"EMBEDS_AWS_ROLE_ARN": ".github/workflows/embedded-binaries-publish.yml",
	"MATRIX_AWS_ROLE_ARN": ".github/workflows/gateway-matrix.yaml",
}

// StaticCloudKeys reports every stored AWS key in a workflow or composite
// action that is not a sanctioned, gated fallback with an OIDC twin in the
// same job. See specs/ci/no-static-cloud-keys.feature.
func StaticCloudKeys(repoRoot string) ([]string, error) {
	files, err := workflowAndActionFiles(repoRoot)
	if err != nil {
		return nil, err
	}

	var problems []string
	for _, rel := range files {
		fileProblems, err := staticKeysIn(repoRoot, rel)
		if err != nil {
			return nil, err
		}
		problems = append(problems, fileProblems...)
	}

	return problems, nil
}

// staticKeysIn checks one file: every stored-key line must be accounted for
// by a sanctioned fallback step, or each one is reported.
func staticKeysIn(repoRoot, rel string) ([]string, error) {
	raw, err := os.ReadFile(filepath.Join(repoRoot, rel))
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", rel, err)
	}
	found := storedKeyLines(string(raw))
	if len(found) == 0 {
		return nil, nil
	}

	var problems []string
	allowed := 0
	if strings.HasPrefix(rel, ciscan.WorkflowDir+"/") {
		workflow, err := ciscan.Load(repoRoot, rel)
		if err != nil {
			return nil, err
		}
		allowed, problems = sanctionedFallbacks(workflow)
	}
	if len(found) <= allowed {
		return problems, nil
	}
	for _, line := range found {
		problems = append(problems, fmt.Sprintf(
			"%s:%d: stored AWS key; assume a role with GitHub OIDC (role-to-assume) instead", rel, line))
	}

	return problems, nil
}

// storedKeyLines returns the 1-based numbers of non-comment lines naming a
// stored AWS key.
func storedKeyLines(text string) []int {
	var lines []int
	for i, line := range strings.Split(text, "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "#") {
			continue
		}
		if storedAWSKey.MatchString(line) {
			lines = append(lines, i+1)
		}
	}

	return lines
}

// sanctionedFallbacks counts the stored-key lines that sit in sanctioned
// fallback steps, and reports gated steps that are not sanctioned.
func sanctionedFallbacks(workflow *ciscan.Workflow) (int, []string) {
	allowed := 0
	var problems []string
	for _, jobName := range workflow.JobNames() {
		job := workflow.Jobs[jobName]
		for _, step := range job.Steps {
			keys := storedKeyFields(step)
			match := fallbackGate.FindStringSubmatch(step.If)
			if keys == 0 || match == nil {
				continue
			}
			where := fmt.Sprintf("%s: job %s, step %q", workflow.Path, jobName, step.Name)
			if reason := fallbackProblem(workflow, jobName, match[1]); reason != "" {
				problems = append(problems, where+": "+reason)

				continue
			}
			allowed += keys
		}
	}

	return allowed, problems
}

// fallbackProblem explains why a gated stored-key step is not a sanctioned
// fallback, or returns "" when it is.
func fallbackProblem(workflow *ciscan.Workflow, jobName, gateVar string) string {
	job := workflow.Jobs[jobName]
	if owner, listed := StaticKeyFallbackVars[gateVar]; !listed || owner != workflow.Path {
		return fmt.Sprintf("gated on vars.%s, which is not a sanctioned OIDC fallback for this workflow", gateVar)
	}
	if !assumesRole(job) {
		return "stored-key fallback has no step assuming a role by OIDC in the same job"
	}
	if job.Permissions.Scopes["id-token"] != "write" && workflow.Permissions.Scopes["id-token"] != "write" {
		return "the OIDC twin needs `id-token: write`"
	}

	return ""
}

// assumesRole reports whether any step in the job assumes a role by OIDC.
func assumesRole(job ciscan.Job) bool {
	for _, step := range job.Steps {
		if _, ok := step.StringWith("role-to-assume"); ok {
			return true
		}
	}

	return false
}

// storedKeyFields counts the step's with and env entries that carry a stored
// key, one per YAML line, matching what storedKeyLines counts in the text.
func storedKeyFields(step ciscan.Step) int {
	count := 0
	for key, value := range step.With {
		text, _ := value.(string)
		if key == "aws-access-key-id" || storedAWSKey.MatchString(text) {
			count++
		}
	}
	for _, value := range step.Env {
		if storedAWSKey.MatchString(value) {
			count++
		}
	}

	return count
}

// workflowAndActionFiles lists the workflows and every composite action,
// sorted so output is stable.
func workflowAndActionFiles(repoRoot string) ([]string, error) {
	workflows, err := yamlFiles(repoRoot, ciscan.WorkflowDir, false)
	if err != nil {
		return nil, err
	}
	actions, err := yamlFiles(repoRoot, ".github/actions", true)
	if err != nil {
		return nil, err
	}
	files := make([]string, 0, len(workflows)+len(actions))
	files = append(files, workflows...)
	files = append(files, actions...)
	sort.Strings(files)

	return files, nil
}

// yamlFiles lists .yml and .yaml files under dir, relative to repoRoot,
// descending into subdirectories only when recursive is set.
func yamlFiles(repoRoot, dir string, recursive bool) ([]string, error) {
	base := filepath.Join(repoRoot, dir)
	if _, err := os.Stat(base); os.IsNotExist(err) {
		return nil, nil
	}
	var files []string
	err := filepath.WalkDir(base, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return skipNested(path != base && !recursive)
		}
		if !isYAML(path) {
			return nil
		}
		rel, err := filepath.Rel(repoRoot, path)
		files = append(files, filepath.ToSlash(rel))

		return err
	})
	if err != nil {
		return nil, fmt.Errorf("walk %s: %w", dir, err)
	}

	return files, nil
}

func skipNested(skip bool) error {
	if skip {
		return filepath.SkipDir
	}

	return nil
}

func isYAML(path string) bool {
	ext := filepath.Ext(path)

	return ext == ".yml" || ext == ".yaml"
}
