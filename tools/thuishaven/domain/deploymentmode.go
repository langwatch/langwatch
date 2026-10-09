package domain

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// DeploymentModesDir holds one <mode>.env per deployment mode, relative to the
// repo root. haven (`up --mode`) and the e2e compose runs both read it, so a
// mode is defined once (specs/setup/deployment-modes.feature).
const DeploymentModesDir = "dev/tests/modes"

// DeploymentMode is one mode's env, sorted, plus the variables the developer
// must supply (a `#! requires A B` line) because they are never committed.
type DeploymentMode struct {
	Name     string
	Env      []string
	Requires []string
}

// DeploymentModes lists the modes defined under repoDir, sorted.
func DeploymentModes(repoDir string) []string {
	matches, _ := filepath.Glob(filepath.Join(repoDir, DeploymentModesDir, "*.env"))
	names := make([]string, 0, len(matches))
	for _, m := range matches {
		names = append(names, strings.TrimSuffix(filepath.Base(m), ".env"))
	}
	sort.Strings(names)
	return names
}

// LoadDeploymentMode reads one mode; an unknown name is refused listing the
// valid ones.
func LoadDeploymentMode(repoDir, name string) (DeploymentMode, error) {
	path := filepath.Join(repoDir, DeploymentModesDir, name+".env")
	f, err := os.Open(path)
	if name == "" || strings.ContainsAny(name, `/\`) || err != nil {
		return DeploymentMode{}, fmt.Errorf("unknown deployment mode %q; valid modes: %s",
			name, strings.Join(DeploymentModes(repoDir), ", "))
	}
	defer f.Close()
	mode := DeploymentMode{Name: name}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if rest, ok := strings.CutPrefix(strings.TrimSpace(sc.Text()), "#! requires"); ok {
			mode.Requires = append(mode.Requires, strings.Fields(rest)...)
		}
	}
	values := map[string]string{}
	ReadEnvFile(path, values)
	for k, v := range values {
		mode.Env = append(mode.Env, k+"="+v)
	}
	sort.Strings(mode.Env)
	return mode, nil
}

// Missing names the required variables neither lookup (the shell) nor dotenv
// supplies with a non-empty value.
func (m DeploymentMode) Missing(lookup func(string) (string, bool), dotenv map[string]string) []string {
	var missing []string
	for _, key := range m.Requires {
		if v, ok := lookup(key); ok && v != "" {
			continue
		}
		if dotenv[key] != "" {
			continue
		}
		missing = append(missing, key)
	}
	return missing
}

// OverriddenBy names the mode variables the root .env sets to another value;
// the .env wins over the overlay, so each of these is not what the mode says.
func (m DeploymentMode) OverriddenBy(dotenv map[string]string) []string {
	var keys []string
	for key, want := range EnvMap(m.Env) {
		if got, ok := dotenv[key]; ok && got != want {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

// EffectiveMode is what status prints and the e2e guard compares: the mode
// name, or the name plus the .env variables that override it.
func EffectiveMode(name string, overriddenBy []string) string {
	if name == "" || len(overriddenBy) == 0 {
		return name
	}
	return name + " (overridden by .env: " + strings.Join(overriddenBy, ", ") + ")"
}
