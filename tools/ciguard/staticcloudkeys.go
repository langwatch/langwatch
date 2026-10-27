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

// awsKeyName is an AWS key variable, setting or input in any spelling:
// AWS_ACCESS_KEY_ID, aws_secret_access_key, aws-session-token.
const awsKeyName = `aws[_-](?:access[_-]key[_-]id|secret[_-]access[_-]key|session[_-]token)`

// awsKeyAssignment finds where a line sets an AWS key: a YAML key, `X=`,
// `export X=`, `-e X=`, or `aws configure set [profile.]x`. A read
// (`env.X`, `outputs.x`, `$X`, `${X}`) is not an assignment.
var awsKeyAssignment = regexp.MustCompile(`(?i)(?:(?:^|[^\w.${-]|[^$]\{|\\n)['"]?` + awsKeyName + `['"]?\s*[:=]` +
	`|\bset\s+(?:[\w.-]+\.)?` + awsKeyName + `\s)\s*`)

// awsKeyFromSession is the only value an AWS key may take: an OIDC step's
// output or a shell variable, whole. Anything else (secrets, vars, inputs,
// format(), a prefix, an empty or block value) is refused.
var awsKeyFromSession = regexp.MustCompile(`(?i)^['"]?(?:\$\{\{\s*steps\.[\w-]+\.outputs\.[\w-]+\s*\}\}|\$[a-z_]\w*|\$\{[a-z_]\w*\})['"]?(?:$|[\s;,})&|])`)

// storedAWSKey is refused anywhere: a secret or var named for a key, the
// whole secrets context as JSON, or the shared credentials file.
var storedAWSKey = regexp.MustCompile(`(?i)\b(?:secrets|vars)\s*(?:\.\s*|\[\s*['"])[A-Z0-9_]*AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN)\b` +
	`|\btoJSON\(\s*secrets\s*\)|\bfromJSON\(\s*secrets\s*[.\[]|\.aws/credentials`)

// IsStoredAWSKeyLine reports whether a non-comment line sets an AWS key from
// anything but an OIDC session, or names a stored key outright. A tripwire for
// copied snippets, not a boundary: a key relayed under a neutral name passes.
func IsStoredAWSKeyLine(line string) bool {
	if strings.HasPrefix(strings.TrimSpace(line), "#") {
		return false
	}
	if storedAWSKey.MatchString(line) {
		return true
	}
	for _, at := range awsKeyAssignment.FindAllStringIndex(line, -1) {
		if !awsKeyFromSession.MatchString(line[at[1]:]) {
			return true
		}
	}

	return false
}

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

// storedKeyLines returns the 1-based numbers of lines naming a stored AWS key.
func storedKeyLines(text string) []int {
	var lines []int
	for i, line := range strings.Split(text, "\n") {
		if IsStoredAWSKeyLine(line) {
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
