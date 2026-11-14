package deployimpact

import (
	"fmt"
	"path"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

// valueKeys lists every key of every chart's values file as `file: dotted.key`.
func valueKeys(tree Tree) (map[string]bool, error) {
	paths, err := tree.Paths()
	if err != nil {
		return nil, err
	}
	keys := map[string]bool{}
	for _, file := range paths {
		if !strings.HasPrefix(file, "charts/") || path.Base(file) != "values.yaml" {
			continue
		}
		content, err := tree.Read(file)
		if err != nil {
			return nil, err
		}
		var values map[string]any
		if err := yaml.Unmarshal([]byte(content), &values); err != nil {
			return nil, fmt.Errorf("%s: %w", file, err)
		}
		flatten(file+": ", values, keys)
	}
	return keys, nil
}

func flatten(prefix string, values map[string]any, keys map[string]bool) {
	for name, value := range values {
		key := prefix + name
		keys[key] = true
		if nested, ok := value.(map[string]any); ok {
			flatten(key+".", nested, keys)
		}
	}
}

// missingFrom lists the keys of from that to lacks, leaving out any under a key missing too.
func missingFrom(from, to map[string]bool) []string {
	var missing []string
	for key := range from {
		if !to[key] && !underMissing(key, from, to) {
			missing = append(missing, key)
		}
	}
	sort.Strings(missing)
	return missing
}

// underMissing is whether a key that key sits under is missing too.
func underMissing(key string, from, to map[string]bool) bool {
	for i := range len(key) {
		if key[i] == '.' && from[key[:i]] && !to[key[:i]] {
			return true
		}
	}
	return false
}
