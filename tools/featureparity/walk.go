package featureparity

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

var skipDir = map[string]bool{"node_modules": true, ".next": true, "dist": true, "build": true}

// walkFiles is the Node tool's walkFiles: dot entries and skipDir are skipped,
// symlinks are followed, unreadable entries are ignored, order is by name.
func walkFiles(root string, keep func(name string) bool) []string {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	var out []string
	for _, e := range entries {
		name := e.Name()
		if skipDir[name] || strings.HasPrefix(name, ".") {
			continue
		}
		full := filepath.Join(root, name)
		isDir := e.IsDir()
		if e.Type()&os.ModeSymlink != 0 {
			info, err := os.Stat(full)
			if err != nil {
				continue
			}
			isDir = info.IsDir()
		}
		if isDir {
			out = append(out, walkFiles(full, keep)...)
		} else if keep(name) {
			out = append(out, full)
		}
	}
	return out
}

// walkRoots walks every root concurrently and keeps the roots' order.
func walkRoots(roots []string, keep func(string) bool) []string {
	lists := make([][]string, len(roots))
	var wg sync.WaitGroup
	for i, r := range roots {
		wg.Go(func() { lists[i] = walkFiles(r, keep) })
	}
	wg.Wait()
	var out []string
	for _, l := range lists {
		out = append(out, l...)
	}
	return out
}

// discoverPackageSpecRoots lists every `specs` directory under root, not
// descending into one, skipping node_modules and not following symlinks.
func discoverPackageSpecRoots(root string) ([]string, error) {
	if _, err := os.Stat(root); err != nil {
		return nil, nil
	}
	var roots []string
	var visit func(string) error
	visit = func(dir string) error {
		entries, err := os.ReadDir(dir)
		if err != nil {
			return err
		}
		for _, e := range entries {
			if !e.IsDir() || e.Name() == "node_modules" {
				continue
			}
			p := filepath.Join(dir, e.Name())
			if e.Name() == "specs" {
				roots = append(roots, p)
			} else if err := visit(p); err != nil {
				return err
			}
		}
		return nil
	}
	if err := visit(root); err != nil {
		return nil, err
	}
	sort.Strings(roots)
	return roots, nil
}

func specRoots(repo string) ([]string, error) {
	roots := []string{filepath.Join(repo, "specs")}
	for _, dir := range []string{"packages", "modules", "enterprise"} {
		found, err := discoverPackageSpecRoots(filepath.Join(repo, dir))
		if err != nil {
			return nil, err
		}
		roots = append(roots, found...)
	}
	return append(roots, filepath.Join(repo, "sdks/typescript/specs")), nil
}

// DiscoverFeatureFiles lists the .feature files under roots, relative to repo
// and sorted. A missing root is a configuration failure, never an empty tree.
func DiscoverFeatureFiles(repo string, roots []string) ([]string, error) {
	for _, root := range roots {
		info, err := os.Stat(root)
		if err != nil {
			return nil, fmt.Errorf("Configured specs root does not exist: %s. Fix SPECS_ROOTS in scripts/check-feature-parity.ts, or restore the tree — a missing root would silently report every scenario under it as bound.", root)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("Configured specs root is not a directory: %s. Fix SPECS_ROOTS in scripts/check-feature-parity.ts.", root)
		}
	}
	files := walkRoots(roots, func(n string) bool { return strings.HasSuffix(n, ".feature") })
	for i, f := range files {
		files[i] = rel(repo, f)
	}
	sort.Strings(files)
	return files, nil
}

func rel(repo, path string) string {
	r, err := filepath.Rel(repo, path)
	if err != nil {
		return path
	}
	return r
}

// FindRepoRoot walks up from dir to the directory holding pnpm-workspace.yaml.
func FindRepoRoot(dir string) (string, error) {
	for d := dir; ; {
		if _, err := os.Stat(filepath.Join(d, "pnpm-workspace.yaml")); err == nil {
			return d, nil
		}
		parent := filepath.Dir(d)
		if parent == d {
			return "", errors.New("pnpm-workspace.yaml not found above " + dir + "; is this inside the repository?")
		}
		d = parent
	}
}
