package ciguard

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

// The release-lock guard keeps the root uv.lock in step with every uv workspace
// package release. Otherwise CI's `uv run` relocks and fails on `git diff`.
// Plain line scanning: the Go modules have no TOML dependency.

// releasePackage is a release-please package that is also a uv workspace member.
type releasePackage struct {
	Path     string // repo-relative directory, also the manifest key
	LockName string // the package name in uv.lock
}

// releasePackages must list every member of the root pyproject's uv workspace;
// workspaceProblems fails when it does not.
var releasePackages = []releasePackage{
	{Path: "sdks/python", LockName: "langwatch"},
	{Path: "packages/ksuid-python", LockName: "langwatch-ksuid"},
}

var (
	releaseVersionLine = regexp.MustCompile(`^version = "([^"]+)"`)
	releaseMembersLine = regexp.MustCompile(`(?m)^members = \[(.*)\]`)
	releaseQuoted      = regexp.MustCompile(`"([^"]+)"`)
)

// releaseLockFiles holds the repository file contents checked against each other.
type releaseLockFiles struct {
	Config, Manifest, RootPyproject, Lock string
	Pyprojects                            map[string]string // by releasePackage.Path
}

// releaseLockInputPaths lists the repo-relative files ReleaseLock reads, so the
// go-ci path filter can be checked against the guard rather than a copy of it.
func releaseLockInputPaths() []string {
	paths := []string{".github/release-please-config.json", ".github/.release-please-manifest.json", "pyproject.toml", "uv.lock"}
	for _, pkg := range releasePackages {
		paths = append(paths, pkg.Path+"/pyproject.toml")
	}

	return paths
}

// ReleaseLock reads the real repository files and returns one problem per failure.
// It reads in a fixed order, so the first read error is deterministic.
func ReleaseLock(root string) ([]string, error) {
	contents := map[string]string{}
	for _, rel := range releaseLockInputPaths() {
		raw, err := os.ReadFile(filepath.Join(root, rel))
		if err != nil {
			return nil, err
		}
		contents[rel] = string(raw)
	}
	files := releaseLockFiles{
		Config:        contents[".github/release-please-config.json"],
		Manifest:      contents[".github/.release-please-manifest.json"],
		RootPyproject: contents["pyproject.toml"],
		Lock:          contents["uv.lock"],
		Pyprojects:    map[string]string{},
	}
	for _, pkg := range releasePackages {
		files.Pyprojects[pkg.Path] = contents[pkg.Path+"/pyproject.toml"]
	}

	return releaseLockProblems(files)
}

// releaseLockProblems checks the file contents against each other, for every package.
func releaseLockProblems(files releaseLockFiles) ([]string, error) {
	var manifestVersions map[string]string
	if err := json.Unmarshal([]byte(files.Manifest), &manifestVersions); err != nil {
		return nil, fmt.Errorf("release-please manifest: %w", err)
	}
	var config releaseConfig
	if err := json.Unmarshal([]byte(files.Config), &config); err != nil {
		return nil, fmt.Errorf("release-please config: %w", err)
	}
	problems := workspaceProblems(files.RootPyproject)
	for _, pkg := range releasePackages {
		problems = append(problems, releaseExtraFilesProblems(config, pkg)...)
		problems = append(problems, lockProblems(pkg, lockInputs{Lock: files.Lock, Pyproject: files.Pyprojects[pkg.Path], ManifestVersion: manifestVersions[pkg.Path]})...)
	}

	return problems, nil
}

// workspaceProblems fails when the root uv workspace members differ from releasePackages.
func workspaceProblems(rootPyproject string) []string {
	match := releaseMembersLine.FindStringSubmatch(rootPyproject)
	if match == nil {
		return []string{"pyproject.toml has no one-line [tool.uv.workspace] members list; the release-lock guard cannot tell which packages it must check"}
	}
	var members, known []string
	for _, quote := range releaseQuoted.FindAllStringSubmatch(match[1], -1) {
		members = append(members, quote[1])
	}
	for _, pkg := range releasePackages {
		known = append(known, pkg.Path)
	}
	slices.Sort(members)
	slices.Sort(known)
	if !slices.Equal(members, known) {
		return []string{fmt.Sprintf("uv workspace members %v differ from the packages the release-lock guard checks %v: update releasePackages in tools/ciguard/releaselock.go", members, known)}
	}

	return nil
}

// releaseConfig is the part of the release-please config the guard reads.
type releaseConfig struct {
	Packages map[string]struct {
		ExtraFiles []json.RawMessage `json:"extra-files"`
	} `json:"packages"`
}

// releaseExtraFilesProblems requires the toml uv.lock entry on the package.
func releaseExtraFilesProblems(config releaseConfig, pkg releasePackage) []string {
	matches := 0
	var wrongJSONPaths []string
	want := releaseLockJSONPath(pkg)
	for _, raw := range config.Packages[pkg.Path].ExtraFiles {
		entry, ok := parseReleaseLockEntry(raw)
		if !ok {
			continue
		}
		if entry.JSONPath == want {
			matches++

			continue
		}
		wrongJSONPaths = append(wrongJSONPaths, entry.JSONPath)
	}
	switch {
	case matches == 0 && len(wrongJSONPaths) > 0:
		return []string{fmt.Sprintf("the %s extra-files has a toml /uv.lock entry with the wrong jsonpath: expected %q, found %q", pkg.Path, want, wrongJSONPaths)}
	case matches == 0:
		return []string{fmt.Sprintf("release-please would leave uv.lock stale: add the toml /uv.lock entry to the %s extra-files", pkg.Path)}
	case matches > 1:
		return []string{fmt.Sprintf("the %s extra-files has %d /uv.lock entries for this package: remove the extras", pkg.Path, matches)}
	}

	return nil
}

// releaseLockJSONPath is the jsonpath that selects the package's version in uv.lock.
func releaseLockJSONPath(pkg releasePackage) string {
	return fmt.Sprintf("$.package[?(@.name.value=='%s')].version", pkg.LockName)
}

// releaseExtraFile is one release-please extra-files entry, as the guard reads it.
type releaseExtraFile struct {
	Type     string `json:"type"`
	Path     string `json:"path"`
	JSONPath string `json:"jsonpath"`
}

// parseReleaseLockEntry returns the entry and true only for a toml /uv.lock entry.
func parseReleaseLockEntry(raw json.RawMessage) (releaseExtraFile, bool) {
	var entry releaseExtraFile
	if json.Unmarshal(raw, &entry) != nil {
		return entry, false
	}

	return entry, entry.Type == "toml" && entry.Path == "/uv.lock"
}

// lockInputs are the contents lockProblems compares for one package.
// ManifestVersion is empty when the manifest has no key for the package.
type lockInputs struct {
	Lock, Pyproject, ManifestVersion string
}

// lockProblems checks the package's uv.lock entry against pyproject and manifest.
func lockProblems(pkg releasePackage, in lockInputs) []string {
	var named []string
	for _, block := range strings.Split(in.Lock, "\n[[package]]\n")[1:] {
		if lockField(block, "name") == pkg.LockName {
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

	return releaseVersionProblems(pkg, lockField(named[0], "version"), in)
}

// releaseVersionProblems reports manifest drift before lock drift: while pyproject and
// manifest disagree, `uv lock` could rewind the lock to the wrong version.
func releaseVersionProblems(pkg releasePackage, lockVersion string, in lockInputs) []string {
	projectVersion, manifestVersion := releaseProjectVersionOf(in.Pyproject), in.ManifestVersion
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

func lockField(block, name string) string {
	prefix := name + ` = "`
	for _, line := range strings.Split(block, "\n") {
		if strings.HasPrefix(line, prefix) && strings.HasSuffix(line, `"`) {
			return strings.TrimSuffix(strings.TrimPrefix(line, prefix), `"`)
		}
	}

	return ""
}

// releaseProjectVersionOf reads `version` from the [project] table only.
func releaseProjectVersionOf(pyproject string) string {
	inProject := false
	for _, line := range strings.Split(pyproject, "\n") {
		if strings.HasPrefix(line, "[") {
			inProject = strings.HasPrefix(line, "[project]")

			continue
		}
		if match := releaseVersionLine.FindStringSubmatch(line); inProject && len(match) == 2 {
			return match[1]
		}
	}

	return ""
}
