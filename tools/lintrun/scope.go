package lintrun

import (
	"encoding/json"
	"fmt"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
)

var lintable = regexp.MustCompile(`\.(?:[cm]?[jt]sx?)$`)

type namedInputs map[string][]json.RawMessage

// expand is a named input's path globs, with the named inputs it lists expanded;
// an object entry ({externalDependencies}) names no path.
func (n namedInputs) expand(input string) []string {
	entries, named := n[input]
	if !named {
		return []string{input}
	}
	var out []string
	for _, raw := range entries {
		var entry string
		if json.Unmarshal(raw, &entry) != nil {
			continue
		}
		if entry == input {
			out = append(out, entry)
		} else {
			out = append(out, n.expand(entry)...)
		}
	}
	return out
}

// LintGlobals is nx.json's `lintGlobals` named input as root-relative globs: editing
// one re-lints everything.
func LintGlobals(nxJSON []byte) ([]string, error) {
	var nx struct {
		NamedInputs namedInputs `json:"namedInputs"`
	}
	if err := json.Unmarshal(nxJSON, &nx); err != nil {
		return nil, fmt.Errorf("nx.json: %w", err)
	}
	globs := []string{}
	for _, glob := range nx.NamedInputs.expand("lintGlobals") {
		globs = append(globs, strings.Replace(glob, "{workspaceRoot}/", "", 1))
	}
	return globs, nil
}

// MatchGlob matches a slash-separated path against a glob where `**` spans any
// number of segments and every other segment follows path.Match.
func MatchGlob(glob, name string) bool {
	return matchSegments(strings.Split(glob, "/"), strings.Split(name, "/"))
}

func matchSegments(glob, name []string) bool {
	if len(glob) == 0 {
		return len(name) == 0
	}
	if glob[0] == "**" {
		return matchGlobstar(glob[1:], name)
	}
	if len(name) == 0 {
		return false
	}
	ok, err := path.Match(glob[0], name[0])
	return err == nil && ok && matchSegments(glob[1:], name[1:])
}

// matchGlobstar matches the glob after a `**` against any tail of name.
func matchGlobstar(rest, name []string) bool {
	for i := range len(name) + 1 {
		if matchSegments(rest, name[i:]) {
			return true
		}
	}
	return false
}

// PlainScope is a plain run's scope: the changed lintable files that still exist,
// or the whole tree when a lint global changed.
func PlainScope(files, globals []string, exists func(string) bool) []string {
	for _, file := range files {
		if slices.ContainsFunc(globals, func(glob string) bool { return MatchGlob(glob, file) }) {
			return []string{"."}
		}
	}
	scope := []string{}
	for _, file := range files {
		if lintable.MatchString(file) && exists(file) {
			scope = append(scope, file)
		}
	}
	return scope
}

var packagesBlock = regexp.MustCompile(`(?m)^packages:\n((?:[ \t]+-.*\n)+)`)
var packageEntry = regexp.MustCompile(`-\s+(\S+)`)

// MemberPatterns is the `packages:` globs of pnpm-workspace.yaml.
func MemberPatterns(workspace []byte) []string {
	block := packagesBlock.FindSubmatch(workspace)
	if block == nil {
		return nil
	}
	var out []string
	for _, m := range packageEntry.FindAllSubmatch(block[1], -1) {
		out = append(out, string(m[1]))
	}
	return out
}

// MemberRoots is every directory a member pattern names that holds a package.json,
// workspace-relative and sorted.
func MemberRoots(root string, patterns []string) ([]string, error) {
	var roots []string
	for _, pattern := range patterns {
		manifests, err := filepath.Glob(filepath.Join(root, filepath.FromSlash(pattern), "package.json"))
		if err != nil {
			return nil, err
		}
		for _, manifest := range manifests {
			rel, err := filepath.Rel(root, filepath.Dir(manifest))
			if err != nil {
				return nil, err
			}
			roots = append(roots, filepath.ToSlash(rel))
		}
	}
	slices.Sort(roots)
	return roots, nil
}
