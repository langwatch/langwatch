// Package deployimpact computes a pull request's deployment impact from its
// diff: the helm values, migrations and images an operator meets on upgrade,
// and which of them break an existing install.
//
// Spec: specs/ci/deployment-impact-report.feature
package deployimpact

import (
	"regexp"
	"sort"
)

// Tree is the repository at one revision.
type Tree interface {
	// Paths lists every tracked file.
	Paths() ([]string, error)
	// Grep lists the tracked files with a line matching pattern, an extended regular expression.
	Grep(pattern string) ([]string, error)
	Read(path string) (string, error)
}

// MapTree is a Tree held in memory, keyed by path.
type MapTree map[string]string

// Paths lists the tree's files in order.
func (m MapTree) Paths() ([]string, error) {
	paths := make([]string, 0, len(m))
	for path := range m {
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths, nil
}

// Grep lists the files with a line matching pattern, in order.
func (m MapTree) Grep(pattern string) ([]string, error) {
	line, err := regexp.Compile("(?m)" + pattern)
	if err != nil {
		return nil, err
	}
	var found []string
	for path, content := range m {
		if line.MatchString(content) {
			found = append(found, path)
		}
	}
	sort.Strings(found)
	return found, nil
}

// Read returns a file's content, or an empty string when it is absent.
func (m MapTree) Read(path string) (string, error) {
	return m[path], nil
}
