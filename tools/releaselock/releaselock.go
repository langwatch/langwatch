// Package releaselock checks that the Python SDK release keeps the root
// uv.lock in step. Otherwise CI's `uv run` relocks and fails on `git diff`.
// Plain line scanning: the CI scripts job installs no TOML library.
package releaselock

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	packagePath = "sdks/python"
	fix         = "run `uv lock` at the repo root, or check the sdks/python extra-files entry in .github/release-please-config.json"
)

var (
	lockSource  = regexp.MustCompile(`(?m)^source = \{ editable = "sdks/python" \}$`)
	versionLine = regexp.MustCompile(`^version = "([^"]+)"`)
)

// Check reads the real repository files and returns one problem per failure.
func Check(root string) ([]string, error) {
	read := func(rel string) (string, error) {
		raw, err := os.ReadFile(filepath.Join(root, rel))

		return string(raw), err
	}
	config, err := read(".github/release-please-config.json")
	if err != nil {
		return nil, err
	}
	manifest, err := read(".github/.release-please-manifest.json")
	if err != nil {
		return nil, err
	}
	pyproject, err := read("sdks/python/pyproject.toml")
	if err != nil {
		return nil, err
	}
	lock, err := read("uv.lock")
	if err != nil {
		return nil, err
	}

	return Problems(Files{Config: config, Manifest: manifest, Pyproject: pyproject, Lock: lock})
}

// Files holds the contents of the four files checked against each other.
type Files struct {
	Config, Manifest, Pyproject, Lock string
}

// Problems checks the four file contents against each other.
func Problems(files Files) ([]string, error) {
	configProblems, err := ExtraFilesProblems(files.Config)
	if err != nil {
		return nil, err
	}
	var manifestVersions map[string]string
	if err := json.Unmarshal([]byte(files.Manifest), &manifestVersions); err != nil {
		return nil, fmt.Errorf("release-please manifest: %w", err)
	}

	return append(configProblems, LockProblems(files.Lock, files.Pyproject, manifestVersions[packagePath])...), nil
}

// ExtraFilesProblems requires the toml uv.lock entry on the Python SDK package.
func ExtraFilesProblems(config string) ([]string, error) {
	var parsed struct {
		Packages map[string]struct {
			ExtraFiles []json.RawMessage `json:"extra-files"`
		} `json:"packages"`
	}
	if err := json.Unmarshal([]byte(config), &parsed); err != nil {
		return nil, fmt.Errorf("release-please config: %w", err)
	}
	matches := 0
	for _, raw := range parsed.Packages[packagePath].ExtraFiles {
		if isLockEntry(raw) {
			matches++
		}
	}
	if matches != 1 {
		return []string{fmt.Sprintf("release-please would leave uv.lock stale (%d matching entries, want 1): add the toml /uv.lock entry to the sdks/python extra-files", matches)}, nil
	}

	return nil, nil
}

func isLockEntry(raw json.RawMessage) bool {
	var entry struct {
		Type     string `json:"type"`
		Path     string `json:"path"`
		JSONPath string `json:"jsonpath"`
	}
	if json.Unmarshal(raw, &entry) != nil {
		return false
	}

	return entry.Type == "toml" && entry.Path == "/uv.lock" &&
		entry.JSONPath == "$.package[?(@.name.value=='langwatch')].version"
}

// LockProblems checks the langwatch package in uv.lock against both versions.
func LockProblems(lock, pyproject, manifestVersion string) []string {
	blocks := strings.Split(lock, "\n[[package]]\n")[1:]
	named, local := 0, []string{}
	for _, block := range blocks {
		if field(block, "name") != "langwatch" {
			continue
		}
		named++
		if lockSource.MatchString(block) {
			local = append(local, block)
		}
	}
	if named != 1 {
		return []string{fmt.Sprintf("uv.lock holds %d packages named langwatch, the jsonpath must match exactly one; %s", named, fix)}
	}
	if len(local) != 1 {
		return []string{"uv.lock langwatch is not the editable sdks/python package; " + fix}
	}

	return versionProblems(field(local[0], "version"), pyproject, manifestVersion)
}

func versionProblems(lockVersion, pyproject, manifestVersion string) []string {
	projectVersion := projectVersionOf(pyproject)
	if projectVersion == "" {
		return []string{"sdks/python/pyproject.toml has no static [project] version; the release cannot bump a dynamic one"}
	}
	problems := []string{}
	if projectVersion != lockVersion {
		problems = append(problems, fmt.Sprintf("uv.lock is out of step with pyproject.toml (lock %q); %s", lockVersion, fix))
	}
	if manifestVersion != lockVersion {
		problems = append(problems, fmt.Sprintf("uv.lock is out of step with the release manifest (lock %q, manifest %q); %s", lockVersion, manifestVersion, fix))
	}

	return problems
}

func field(block, name string) string {
	prefix := name + ` = "`
	for _, line := range strings.Split(block, "\n") {
		if strings.HasPrefix(line, prefix) && strings.HasSuffix(line, `"`) {
			return strings.TrimSuffix(strings.TrimPrefix(line, prefix), `"`)
		}
	}

	return ""
}

// projectVersionOf reads `version` from the [project] table only.
func projectVersionOf(pyproject string) string {
	inProject := false
	for _, line := range strings.Split(pyproject, "\n") {
		if strings.HasPrefix(line, "[") {
			inProject = strings.HasPrefix(line, "[project]")

			continue
		}
		if match := versionLine.FindStringSubmatch(line); inProject && len(match) == 2 {
			return match[1]
		}
	}

	return ""
}
