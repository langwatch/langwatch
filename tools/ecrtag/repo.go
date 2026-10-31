package ecrtag

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// GitRepo is the git repository at Root, read by running git with Run.
type GitRepo struct {
	Run  Exec
	Root string
}

// Tree is the Tree of a commit, read from its tree objects alone, so a clone
// without file contents can read it.
func (g GitRepo) Tree(ctx context.Context, rev string) (Tree, error) {
	out, err := g.Run(ctx, Command{Name: "git", Args: []string{"-C", g.Root, "ls-tree", "-r", "-z", "--full-tree", rev}})
	if err != nil {
		return nil, err
	}
	tree := Tree{}
	for _, entry := range strings.Split(out, "\x00") {
		meta, file, ok := strings.Cut(entry, "\t")
		if !ok {
			continue
		}
		// "<mode> <type> <object id>"; submodules are commits, not files.
		fields := strings.Fields(meta)
		if len(fields) == 3 && fields[1] == "blob" {
			tree[file] = fields[2]
		}
	}
	if len(tree) == 0 {
		return nil, fmt.Errorf("git ls-tree %s listed no files", rev)
	}

	return tree, nil
}

// ReadFile reads a file of the checkout at root, which must be the commit
// the Tree lists.
func ReadFile(root string) func(string) (string, error) {
	return func(name string) (string, error) {
		b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(name)))
		return string(b), err
	}
}

// GoList is the GoDeps of `go list -deps` in the checkout at root, for the
// platform the images build for (linux/arm64, no cgo).
func GoList(run Exec, root string) GoDeps {
	return func(ctx context.Context, dir, pkg string) ([]string, error) {
		out, err := run(ctx, Command{Name: "env", Args: []string{
			"GOOS=linux", "GOARCH=arm64", "CGO_ENABLED=0", "GOFLAGS=-mod=readonly",
			"go", "-C", filepath.Join(root, filepath.FromSlash(dir)), "list", "-deps",
			"-json=Dir,Standard,GoFiles,CgoFiles,SFiles,HFiles,CFiles,CXXFiles,SysoFiles,EmbedFiles", pkg,
		}})
		if err != nil {
			return nil, err
		}

		return goListFiles(out, root)
	}
}

// goListFiles is the repository files of `go list -json` output, relative to
// root. A standard library or module cache package is not the repository's.
func goListFiles(out, root string) ([]string, error) {
	absRoot, err := resolvedRoot(root)
	if err != nil {
		return nil, err
	}
	var files []string
	dec := json.NewDecoder(strings.NewReader(out))
	for {
		var p goPackage
		if err := dec.Decode(&p); errors.Is(err, io.EOF) {
			break
		} else if err != nil {
			return nil, fmt.Errorf("read go list: %w", err)
		}
		files = append(files, p.repoFiles(absRoot)...)
	}

	return files, nil
}

// resolvedRoot is root as an absolute path with symlinks resolved, since go
// reports directories that way.
func resolvedRoot(root string) (string, error) {
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return "", err
	}

	return filepath.EvalSymlinks(absRoot)
}

// goPackage is the part of a `go list -json` package that names its files.
type goPackage struct {
	Dir                                                                        string
	Standard                                                                   bool
	GoFiles, CgoFiles, SFiles, HFiles, CFiles, CXXFiles, SysoFiles, EmbedFiles []string
}

// repoFiles is the package's files relative to absRoot, or none when the
// package is outside it.
func (p goPackage) repoFiles(absRoot string) []string {
	dir, err := filepath.EvalSymlinks(p.Dir)
	if err != nil {
		dir = p.Dir
	}
	rel, err := filepath.Rel(absRoot, dir)
	if p.Standard || err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return nil
	}
	var files []string
	for _, group := range [][]string{p.GoFiles, p.CgoFiles, p.SFiles, p.HFiles, p.CFiles, p.CXXFiles, p.SysoFiles, p.EmbedFiles} {
		for _, f := range group {
			files = append(files, filepath.ToSlash(filepath.Join(rel, f)))
		}
	}

	return files
}
