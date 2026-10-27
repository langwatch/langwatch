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

// storedAWSKey matches a long-lived AWS key read from secrets, env or vars, by
// property (`secrets.X`) or index (`secrets['X']`), or passed as
// configure-aws-credentials' aws-access-key-id or aws-secret-access-key input,
// in block or flow (`with: { aws-access-key-id: ... }`) style. A shell
// `$AWS_ACCESS_KEY_ID` is a session the job already holds, so it is ignored.
// An AWS_* env key or `aws configure set` fed from secrets or vars is caught
// whatever the secret is called.
// Case-insensitive, because GitHub resolves context names case-insensitively.
var storedAWSKey = regexp.MustCompile(
	`(?i)\b(?:secrets|env|vars)\s*(?:\.\s*|\[\s*['"])[A-Z0-9_]*AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY)\b` +
		`|\bAWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)['"]?\s*:\s*['"]?\$\{\{\s*(?:secrets|vars)\b` +
		`|\baws_(?:access_key_id|secret_access_key|session_token)\s+['"]?\$\{\{\s*(?:secrets|vars)\b` +
		`|(?:^|[\s{,])['"]?aws-(?:access-key-id|secret-access-key)['"]?\s*:`,
)

// StaticCloudKeys reports every stored AWS key in a workflow or composite
// action. No condition or variable makes one acceptable: the OIDC cutover is
// done and break-glass is the AWS root account, not a key in GitHub. See
// specs/ci/no-static-cloud-keys.feature.
func StaticCloudKeys(repoRoot string) ([]string, error) {
	files, err := workflowAndActionFiles(repoRoot)
	if err != nil {
		return nil, err
	}

	var problems []string
	for _, rel := range files {
		raw, err := os.ReadFile(filepath.Join(repoRoot, rel))
		if err != nil {
			return nil, fmt.Errorf("read %s: %w", rel, err)
		}
		for _, line := range storedKeyLines(string(raw)) {
			problems = append(problems, fmt.Sprintf(
				"%s:%d: stored AWS key: a long-lived key in GitHub can be read by any workflow edit; assume a role with GitHub OIDC (role-to-assume) instead", rel, line))
		}
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
		files, err = appendYAML(files, repoRoot, path)

		return err
	})
	if err != nil {
		return nil, fmt.Errorf("walk %s: %w", dir, err)
	}

	return files, nil
}

// appendYAML adds path, relative to repoRoot, when it is a YAML file.
func appendYAML(files []string, repoRoot, path string) ([]string, error) {
	if !isYAML(path) {
		return files, nil
	}
	rel, err := filepath.Rel(repoRoot, path)
	if err != nil {
		return files, err
	}

	return append(files, filepath.ToSlash(rel)), nil
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
