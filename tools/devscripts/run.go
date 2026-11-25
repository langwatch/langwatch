// Package devscripts is the repository's dev scripts as one binary, ported
// from dev/scripts/*.mjs.
package devscripts

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
)

// Run dispatches a subcommand and returns the process exit code.
func Run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprintln(stderr, "usage: devscripts generate-modules [args]")
		return 2
	}
	command, rest := args[0], args[1:]
	root, rest, err := rootFrom(rest)
	if err != nil {
		fmt.Fprintln(stderr, command+":", err)
		return 1
	}
	if command == "generate-modules" {
		return runGenerateModules(subcommand{root: root, args: rest, stdout: stdout, stderr: stderr})
	}
	fmt.Fprintf(stderr, "devscripts: unknown subcommand %q\n", command)
	return 2
}

// subcommand is one dispatched subcommand: the workspace root, its remaining
// arguments and where it writes.
type subcommand struct {
	root           string
	args           []string
	stdout, stderr io.Writer
}

// rootFrom takes `--root DIR` out of args. Without it, the workspace root is the
// nearest directory above the working directory holding pnpm-workspace.yaml.
func rootFrom(args []string) (string, []string, error) {
	if i := slices.Index(args, "--root"); i >= 0 {
		if i+1 >= len(args) {
			return "", nil, fmt.Errorf("--root needs a directory")
		}
		root, err := filepath.Abs(args[i+1])
		return root, slices.Delete(slices.Clone(args), i, i+2), err
	}
	root, err := findRoot()
	return root, args, err
}

func findRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if exists(filepath.Join(dir, "pnpm-workspace.yaml")) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("no pnpm-workspace.yaml above the working directory")
		}
		dir = parent
	}
}
