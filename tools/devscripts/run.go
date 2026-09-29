// Package devscripts is the repository's dev scripts as one binary, ported
// from dev/scripts/*.mjs and the sync-tsconfig-references tool.
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
		fmt.Fprintln(stderr, "usage: devscripts generate-modules|sync-references|ensure-built [args]")
		return 2
	}
	command, rest := args[0], args[1:]
	if command == "ensure-built" {
		root, err := findRoot()
		if err != nil {
			fmt.Fprintln(stderr, "ensure-built:", err)
			return 1
		}
		return EnsureBuilt(root, rest, stderr)
	}
	root, rest, err := rootFrom(command, rest)
	if err != nil {
		fmt.Fprintln(stderr, command+":", err)
		return 1
	}
	switch command {
	case "generate-modules":
		return runGenerateModules(root, rest, stdout, stderr)
	case "sync-references":
		return runSyncReferences(root, rest, stdout, stderr)
	}
	fmt.Fprintf(stderr, "devscripts: unknown subcommand %q\n", command)
	return 2
}

// rootFrom takes `--root DIR` out of args. Without it, sync-references uses the
// working directory as its script did; the others look for the workspace root.
func rootFrom(command string, args []string) (string, []string, error) {
	if i := slices.Index(args, "--root"); i >= 0 {
		if i+1 >= len(args) {
			return "", nil, fmt.Errorf("--root needs a directory")
		}
		root, err := filepath.Abs(args[i+1])
		return root, slices.Delete(slices.Clone(args), i, i+2), err
	}
	if command == "sync-references" {
		root, err := os.Getwd()
		return root, args, err
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
