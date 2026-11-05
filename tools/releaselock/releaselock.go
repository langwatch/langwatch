// Package releaselock checks that every uv workspace package release keeps the
// root uv.lock in step. Otherwise CI's `uv run` relocks and fails on `git diff`.
// Plain line scanning: the Go modules have no TOML dependency.
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
// It reads in a fixed order, so the first read error is deterministic.
func Check(root string) ([]string, error) {
	read := func(rel string) (string, error) {
		raw, err := os.ReadFile(filepath.Join(root, rel))

		return string(raw), err
	}
	files := Files{Pyprojects: map[string]string{}}
	var err error
	if files.Config, err = read(".github/release-please-config.json"); err != nil {
		return nil, err
	}
	if files.Manifest, err = read(".github/.release-please-manifest.json"); err != nil {
		return nil, err
	}
	if files.RootPyproject, err = read("pyproject.toml"); err != nil {
		return nil, err
	}
	if files.Lock, err = read("uv.lock"); err != nil {
		return nil, err
	}
	for _, pkg := range Packages {
		if files.Pyprojects[pkg.Path], err = read(pkg.Path + "/pyproject.toml"); err != nil {
			return nil, err
		}
	}

	return Problems(files)
}

// Problems checks the file contents against each other, for every package.
func Problems(files Files) ([]string, error) {
	var manifestVersions map[string]string
	if err := json.Unmarshal([]byte(files.Manifest), &manifestVersions); err != nil {
		return nil, fmt.Errorf("release-please manifest: %w", err)
	}
	var config Config
	if err := json.Unmarshal([]byte(files.Config), &config); err != nil {
		return nil, fmt.Errorf("release-please config: %w", err)
	}
	problems := WorkspaceProblems(files.RootPyproject)
	for _, pkg := range Packages {
		problems = append(problems, ExtraFilesProblems(config, pkg)...)
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

// Config is the part of the release-please config the guard reads.
type Config struct {
	Packages map[string]struct {
		ExtraFiles []json.RawMessage `json:"extra-files"`
	} `json:"packages"`
}

// ExtraFilesProblems requires the toml uv.lock entry on the package.
func ExtraFilesProblems(config Config, pkg Package) []string {
	matches := 0
	for _, raw := range config.Packages[pkg.Path].ExtraFiles {
		if isLockEntry(raw, pkg) {
			matches++
		}
	}
	switch {
	case matches == 0:
		return []string{fmt.Sprintf("release-please would leave uv.lock stale: add the toml /uv.lock entry to the %s extra-files", pkg.Path)}
	case matches > 1:
		return []string{fmt.Sprintf("the %s extra-files has %d /uv.lock entries for this package: remove the extras", pkg.Path, matches)}
	}

	return nil
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
// ManifestVersion is empty when the manifest has no key for the package.
type LockInputs struct {
	Lock, Pyproject, ManifestVersion string
}

// LockProblems checks the package's uv.lock entry against pyproject and manifest.
func LockProblems(pkg Package, in LockInputs) []string {
	var named []string
	for _, block := range strings.Split(in.Lock, "\n[[package]]\n")[1:] {
		if field(block, "name") == pkg.LockName {
			named = append(named, block)
		}
	}
	switch {
	case len(named) == 0:
		return []string{fmt.Sprintf("uv.lock has no entry named %s: run `uv lock` at the repo root", pkg.LockName)}
	case len(named) > 1:
		return []string{fmt.Sprintf("uv.lock holds %d packages named %s, the release-please jsonpath must match exactly one; `uv lock` does not remove a duplicate, fix uv.lock by hand", len(named), pkg.LockName)}
	}
	if !slices.Contains(strings.Split(named[0], "\n"), fmt.Sprintf(`source = { editable = %q }`, pkg.Path)) {
		return []string{fmt.Sprintf("uv.lock %s is not the editable %s package; the workspace member must be the one entry of that name", pkg.LockName, pkg.Path)}
	}

	return versionProblems(pkg, field(named[0], "version"), in)
}

// versionProblems reports manifest drift before lock drift: while pyproject and
// manifest disagree, `uv lock` could rewind the lock to the wrong version.
func versionProblems(pkg Package, lockVersion string, in LockInputs) []string {
	projectVersion, manifestVersion := projectVersionOf(in.Pyproject), in.ManifestVersion
	switch {
	case projectVersion == "":
		return []string{pkg.Path + "/pyproject.toml has no static [project] version; the release cannot bump a dynamic one"}
	case manifestVersion == "":
		return []string{fmt.Sprintf("the release manifest has no %q key; add it at %q", pkg.Path, projectVersion)}
	case projectVersion != manifestVersion:
		return []string{fmt.Sprintf("%s/pyproject.toml is %q but the release manifest is %q; a release step bumped only one of them, and `uv lock` cannot fix that", pkg.Path, projectVersion, manifestVersion)}
	case projectVersion != lockVersion:
		return []string{fmt.Sprintf("uv.lock is out of step with %s/pyproject.toml (lock %q, pyproject %q); run `uv lock` at the repo root, or check the %s extra-files entry in .github/release-please-config.json", pkg.Path, lockVersion, projectVersion, pkg.Path)}
	}

	return nil
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
