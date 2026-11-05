// Package releaselock checks that every uv workspace package release keeps the
// root uv.lock in step. Otherwise CI's `uv run` relocks and fails on `git diff`.
// Plain line scanning: the CI scripts job installs no TOML library.
package releaselock

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// Package is a release-please package that is also a uv workspace member.
type Package struct {
	Path     string // repo-relative directory, also the manifest key
	LockName string // the package name in uv.lock
}

// Packages must list every member of the root pyproject's uv workspace;
// WorkspaceProblems fails when it does not.
var Packages = []Package{
	{Path: "sdks/python", LockName: "langwatch"},
	{Path: "packages/ksuid-python", LockName: "langwatch-ksuid"},
}

var (
	versionLine = regexp.MustCompile(`^version = "([^"]+)"`)
	membersLine = regexp.MustCompile(`(?m)^members = \[(.*)\]`)
	quoted      = regexp.MustCompile(`"([^"]+)"`)
)

// Files holds the repository file contents checked against each other.
type Files struct {
	Config, Manifest, RootPyproject, Lock string
	Pyprojects                            map[string]string // by Package.Path
}

// Check reads the real repository files and returns one problem per failure.
func Check(root string) ([]string, error) {
	read := func(rel string) (string, error) {
		raw, err := os.ReadFile(filepath.Join(root, rel))

		return string(raw), err
	}
	files := Files{Pyprojects: map[string]string{}}
	for dest, rel := range map[*string]string{
		&files.Config:        ".github/release-please-config.json",
		&files.Manifest:      ".github/.release-please-manifest.json",
		&files.RootPyproject: "pyproject.toml",
		&files.Lock:          "uv.lock",
	} {
		content, err := read(rel)
		if err != nil {
			return nil, err
		}
		*dest = content
	}
	for _, pkg := range Packages {
		content, err := read(pkg.Path + "/pyproject.toml")
		if err != nil {
			return nil, err
		}
		files.Pyprojects[pkg.Path] = content
	}

	return Problems(files)
}

// Problems checks the file contents against each other, for every package.
func Problems(files Files) ([]string, error) {
	var manifestVersions map[string]string
	if err := json.Unmarshal([]byte(files.Manifest), &manifestVersions); err != nil {
		return nil, fmt.Errorf("release-please manifest: %w", err)
	}
	problems := WorkspaceProblems(files.RootPyproject)
	for _, pkg := range Packages {
		configProblems, err := ExtraFilesProblems(files.Config, pkg)
		if err != nil {
			return nil, err
		}
		problems = append(problems, configProblems...)
		problems = append(problems, LockProblems(pkg, LockInputs{Lock: files.Lock, Pyproject: files.Pyprojects[pkg.Path], ManifestVersion: manifestVersions[pkg.Path]})...)
	}

	return problems, nil
}

// WorkspaceProblems fails when the root uv workspace members differ from Packages.
func WorkspaceProblems(rootPyproject string) []string {
	match := membersLine.FindStringSubmatch(rootPyproject)
	if match == nil {
		return []string{"pyproject.toml has no one-line [tool.uv.workspace] members list; releaselock cannot tell which packages it must check"}
	}
	var members, known []string
	for _, quote := range quoted.FindAllStringSubmatch(match[1], -1) {
		members = append(members, quote[1])
	}
	for _, pkg := range Packages {
		known = append(known, pkg.Path)
	}
	slices.Sort(members)
	slices.Sort(known)
	if !slices.Equal(members, known) {
		return []string{fmt.Sprintf("uv workspace members %v differ from the packages releaselock checks %v: update Packages in tools/releaselock", members, known)}
	}

	return nil
}

// ExtraFilesProblems requires the toml uv.lock entry on the package.
func ExtraFilesProblems(config string, pkg Package) ([]string, error) {
	var parsed struct {
		Packages map[string]struct {
			ExtraFiles []json.RawMessage `json:"extra-files"`
		} `json:"packages"`
	}
	if err := json.Unmarshal([]byte(config), &parsed); err != nil {
		return nil, fmt.Errorf("release-please config: %w", err)
	}
	matches := 0
	for _, raw := range parsed.Packages[pkg.Path].ExtraFiles {
		if isLockEntry(raw, pkg) {
			matches++
		}
	}
	if matches != 1 {
		return []string{fmt.Sprintf("release-please would leave uv.lock stale (%d matching entries, want 1): add the toml /uv.lock entry to the %s extra-files", matches, pkg.Path)}, nil
	}

	return nil, nil
}

func isLockEntry(raw json.RawMessage, pkg Package) bool {
	var entry struct {
		Type     string `json:"type"`
		Path     string `json:"path"`
		JSONPath string `json:"jsonpath"`
	}
	if json.Unmarshal(raw, &entry) != nil {
		return false
	}

	return entry.Type == "toml" && entry.Path == "/uv.lock" &&
		entry.JSONPath == fmt.Sprintf("$.package[?(@.name.value=='%s')].version", pkg.LockName)
}

// LockInputs are the contents LockProblems compares for one package.
type LockInputs struct {
	Lock, Pyproject, ManifestVersion string
}

func fixHint(pkg Package) string {
	return fmt.Sprintf("run `uv lock` at the repo root, or check the %s extra-files entry in .github/release-please-config.json", pkg.Path)
}

// LockProblems checks the package's uv.lock entry against pyproject and manifest.
func LockProblems(pkg Package, in LockInputs) []string {
	source := fmt.Sprintf(`source = { editable = %q }`, pkg.Path)
	fix := fixHint(pkg)
	var local []string
	named := 0
	for _, block := range strings.Split(in.Lock, "\n[[package]]\n")[1:] {
		if field(block, "name") != pkg.LockName {
			continue
		}
		named++
		if slices.Contains(strings.Split(block, "\n"), source) {
			local = append(local, block)
		}
	}
	if named != 1 {
		return []string{fmt.Sprintf("uv.lock holds %d packages named %s, the jsonpath must match exactly one; %s", named, pkg.LockName, fix)}
	}
	if len(local) != 1 {
		return []string{fmt.Sprintf("uv.lock %s is not the editable %s package; %s", pkg.LockName, pkg.Path, fix)}
	}

	return versionProblems(pkg, field(local[0], "version"), in)
}

func versionProblems(pkg Package, lockVersion string, in LockInputs) []string {
	projectVersion, manifestVersion := projectVersionOf(in.Pyproject), in.ManifestVersion
	if projectVersion == "" {
		return []string{pkg.Path + "/pyproject.toml has no static [project] version; the release cannot bump a dynamic one"}
	}
	problems := []string{}
	if projectVersion != manifestVersion {
		problems = append(problems, fmt.Sprintf("%s/pyproject.toml is %q but the release manifest is %q; a release step bumped only one of them, and `uv lock` cannot fix that", pkg.Path, projectVersion, manifestVersion))
	}
	if projectVersion != lockVersion {
		problems = append(problems, fmt.Sprintf("uv.lock is out of step with %s/pyproject.toml (lock %q, pyproject %q); %s", pkg.Path, lockVersion, projectVersion, fixHint(pkg)))
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
