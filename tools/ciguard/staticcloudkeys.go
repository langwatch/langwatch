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

// gateTerm matches one `&&` term of a fallback step's `if:` that holds only
// while the OIDC role variable is unset (`vars.<NAME> == ”`), and oidcTerm
// the complementary term on its OIDC twin (`vars.<NAME> != ”`).
var (
	gateTerm = regexp.MustCompile(`^vars\.([A-Z0-9_]+)\s*==\s*''$`)
	oidcTerm = regexp.MustCompile(`^vars\.([A-Z0-9_]+)\s*!=\s*''$`)
)

// credentialsAction is the action both the OIDC step and its stored-key
// fallback use.
const credentialsAction = "aws-actions/configure-aws-credentials@"

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

// staticKeysIn checks one file: every stored-key line must sit inside a
// sanctioned fallback step, or it is reported.
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
	var permitted []lineSpan
	if strings.HasPrefix(rel, ciscan.WorkflowDir+"/") {
		workflow, err := ciscan.Load(repoRoot, rel)
		if err != nil {
			return nil, err
		}
		permitted, problems = sanctionedFallbacks(workflow)
	}
	for _, line := range found {
		if within(permitted, line) {
			continue
		}
		problems = append(problems, fmt.Sprintf(
			"%s:%d: stored AWS key; assume a role with GitHub OIDC (role-to-assume) instead", rel, line))
	}

	return problems, nil
}

// lineSpan is the inclusive source range of one sanctioned fallback step.
type lineSpan struct{ first, last int }

func within(spans []lineSpan, line int) bool {
	for _, span := range spans {
		if line >= span.first && line <= span.last {
			return true
		}
	}

	return false
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

// sanctionedFallbacks returns the source spans of the sanctioned fallback
// steps, whose stored-key lines are permitted, and reports gated stored-key
// steps that are not sanctioned.
func sanctionedFallbacks(workflow *ciscan.Workflow) ([]lineSpan, []string) {
	var spans []lineSpan
	var problems []string
	for _, jobName := range workflow.JobNames() {
		jobSpans, jobProblems := sanctionedFallbacksIn(workflow, jobName)
		spans = append(spans, jobSpans...)
		problems = append(problems, jobProblems...)
	}

	return spans, problems
}

// sanctionedFallbacksIn does the same for one job.
func sanctionedFallbacksIn(workflow *ciscan.Workflow, jobName string) ([]lineSpan, []string) {
	var spans []lineSpan
	var problems []string
	steps := workflow.Jobs[jobName].Steps
	for i := range steps {
		step := &steps[i]
		gateVar, gated := conditionTerm(step.If, gateTerm)
		if !gated || !hasStoredKey(step) {
			continue
		}
		if reason := fallbackProblem(workflow, jobName, gateVar); reason != "" {
			problems = append(problems, fmt.Sprintf("%s: job %s, step %q: %s", workflow.Path, jobName, step.Name, reason))

			continue
		}
		spans = append(spans, lineSpan{first: step.Line, last: step.EndLine})
	}

	return spans, problems
}

// conditionTerm reports whether the whole `if:` condition is a conjunction
// with a term matching term, returning that term's variable. Any `||`, or a
// term inside parentheses, disqualifies the condition: either can make the
// step run while the role variable is set, so only a plain `&&` chain counts.
func conditionTerm(condition string, term *regexp.Regexp) (string, bool) {
	expression := strings.TrimSpace(condition)
	if inner, ok := strings.CutPrefix(expression, "${{"); ok {
		inner, ok = strings.CutSuffix(inner, "}}")
		if !ok {
			return "", false
		}
		expression = inner
	}
	if strings.Contains(expression, "||") || strings.Contains(expression, "${{") {
		return "", false
	}
	for _, part := range strings.Split(expression, "&&") {
		if match := term.FindStringSubmatch(strings.TrimSpace(part)); match != nil {
			return match[1], true
		}
	}

	return "", false
}

// fallbackProblem explains why a gated stored-key step is not a sanctioned
// fallback, or returns "" when it is.
func fallbackProblem(workflow *ciscan.Workflow, jobName, gateVar string) string {
	if owner, listed := StaticKeyFallbackVars[gateVar]; !listed || owner != workflow.Path {
		return fmt.Sprintf("gated on vars.%s, which is not a sanctioned OIDC fallback for this workflow", gateVar)
	}
	if !hasOIDCTwin(workflow.Jobs[jobName], gateVar) {
		return fmt.Sprintf("stored-key fallback has no separate step in the same job assuming vars.%s by OIDC "+
			"(configure-aws-credentials with role-to-assume, `if: vars.%s != ''`, and no stored key)", gateVar, gateVar)
	}
	if !workflow.EffectivePermissions(jobName).Grants("id-token", "write") {
		return "the OIDC twin needs `id-token: write` in the job's effective permissions " +
			"(a job-level permissions block replaces the workflow-level one)"
	}

	return ""
}

// hasOIDCTwin reports whether the job has a separate credentials step that
// assumes the role named by roleVar, runs only while that variable is set,
// and carries no stored key of its own.
func hasOIDCTwin(job ciscan.Job, roleVar string) bool {
	for i := range job.Steps {
		step := &job.Steps[i]
		if !strings.HasPrefix(step.Uses, credentialsAction) || hasStoredKey(step) {
			continue
		}
		role, _ := step.StringWith("role-to-assume")
		if strings.Join(strings.Fields(role), "") != "${{vars."+roleVar+"}}" {
			continue
		}
		if twinVar, ok := conditionTerm(step.If, oidcTerm); ok && twinVar == roleVar {
			return true
		}
	}

	return false
}

// hasStoredKey reports whether the step's with or env entries carry a stored
// key.
func hasStoredKey(step *ciscan.Step) bool {
	for key, value := range step.With {
		text, _ := value.(string)
		if key == "aws-access-key-id" || key == "aws-secret-access-key" || storedAWSKey.MatchString(text) {
			return true
		}
	}
	for _, value := range step.Env {
		if storedAWSKey.MatchString(value) {
			return true
		}
	}

	return false
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
