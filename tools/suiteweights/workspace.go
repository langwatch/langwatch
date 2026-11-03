package suiteweights

import (
	"encoding/json"
	"os"
	"path/filepath"
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
// pnpm-workspace.yaml match; negated globs are skipped.
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
	var manifests []string
	for _, glob := range workspace.Packages {
		if strings.HasPrefix(glob, "!") {
			continue
		}
		found, err := filepath.Glob(filepath.Join(root, glob, "package.json"))
		if err != nil {
			return nil, err
		}
		manifests = append(manifests, found...)
	}
	return manifests, nil
}

// manifestScripts reads one package.json: the package name and its script names.
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
	for script := range pkg.Scripts {
		scripts = append(scripts, script)
	}
	return pkg.Name, scripts, nil
}
