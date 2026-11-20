package suiteweights

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"gopkg.in/yaml.v3"
)

// DefinedScripts reports whether a workspace package's package.json still
// defines a script, read from the globs of pnpm-workspace.yaml under root.
func DefinedScripts(root string) (func(ScriptKey) bool, error) {
	manifests, err := workspaceManifests(root)
	if err != nil {
		return nil, err
	}
	defined := map[ScriptKey]bool{}
	for _, manifest := range manifests {
		name, scripts, err := manifestScripts(manifest)
		if err != nil {
			return nil, err
		}
		for _, script := range scripts {
			defined[ScriptKey{name, script}] = true
		}
	}
	return func(key ScriptKey) bool { return defined[key] }, nil
}

// workspaceManifests lists the package.json of every package the globs of
// pnpm-workspace.yaml match, less the directories a negated glob matches.
func workspaceManifests(root string) ([]string, error) {
	source, err := os.ReadFile(filepath.Join(root, "pnpm-workspace.yaml"))
	if err != nil {
		return nil, err
	}
	var workspace struct {
		Packages []string `yaml:"packages"`
	}
	if err := yaml.Unmarshal(source, &workspace); err != nil {
		return nil, err
	}
	return matchGlobs(root, workspace.Packages)
}

// matchGlobs lists the manifests the plain globs match, less those of
// directories a negated glob matches.
func matchGlobs(root string, globs []string) ([]string, error) {
	var included, excluded []string
	for _, glob := range globs {
		pattern, negated := strings.CutPrefix(glob, "!")
		found, err := globManifests(root, pattern)
		if err != nil {
			return nil, err
		}
		if negated {
			excluded = append(excluded, found...)
		} else {
			included = append(included, found...)
		}
	}
	return slices.DeleteFunc(included, func(m string) bool { return slices.Contains(excluded, m) }), nil
}

// globManifests lists the package.json files one workspace glob matches.
func globManifests(root, glob string) ([]string, error) {
	return filepath.Glob(filepath.Join(root, glob, "package.json"))
}

// scriptsFor mirrors scriptsFor in .github/scripts/run-package-suites.ts:
// the scripts the gate runs, so only those can carry a weight.
func scriptsFor(scripts map[string]string) []string {
	var chosen []string
	if _, ok := scripts["test:unit"]; ok {
		chosen = append(chosen, "test:unit")
	} else if _, ok := scripts["test"]; ok {
		chosen = append(chosen, "test")
	}
	for _, lane := range []string{"test:integration", "test:browser"} {
		if _, ok := scripts[lane]; ok {
			chosen = append(chosen, lane)
		}
	}
	return chosen
}

// manifestScripts reads one package.json: the package name and the scripts the gate runs.
func manifestScripts(path string) (name string, scripts []string, err error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", nil, err
	}
	var pkg struct {
		Name    string            `json:"name"`
		Scripts map[string]string `json:"scripts"`
	}
	if err := json.Unmarshal(raw, &pkg); err != nil {
		return "", nil, err
	}
	return pkg.Name, scriptsFor(pkg.Scripts), nil
}
