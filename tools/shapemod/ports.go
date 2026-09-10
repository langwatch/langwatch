package shapemod

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// PortsResult is the outcome of one `shapemod ports` run.
type PortsResult struct {
	Entries  []Entry
	Applied  bool
	Aborted  bool
	Registry []RegistryLine
}

// Ports classifies every file under <moduleDir>/server/src/{ports,adapters}
// and, with apply, moves and renames the ones that resolve to a repository
// tier. root is the repository root (so tslsp-cli runs from <root>/<moduleDir>/server).
func Ports(root, moduleDir string, apply bool, runner Runner, stdout, stderr io.Writer) (PortsResult, int) {
	serverSrc := filepath.Join(moduleDir, "server", "src")
	var files []string
	for _, sub := range []string{"ports", "adapters"} {
		dir := filepath.Join(root, serverSrc, sub)
		_ = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return nil
			}
			if strings.Contains(path, string(filepath.Separator)+"__tests__"+string(filepath.Separator)) {
				return nil
			}
			if !strings.HasSuffix(path, ".ts") {
				return nil
			}
			rel, relErr := filepath.Rel(root, path)
			if relErr == nil {
				files = append(files, rel)
			}
			return nil
		})
	}
	sort.Strings(files)

	var entries []Entry
	for _, f := range files {
		data, err := os.ReadFile(filepath.Join(root, f))
		if err != nil {
			fmt.Fprintf(stderr, "read %s: %v\n", f, err)
			continue
		}
		entries = append(entries, PlanEntry(f, serverSrc, string(data)))
	}

	printPlan(stdout, entries)

	result := PortsResult{Entries: entries}
	if !apply {
		return result, 0
	}

	moduleServerDir := filepath.Join(root, moduleDir, "server")
	for i := range entries {
		e := &entries[i]
		if e.Tier == TierInfrastructure || e.Tier == TierSplit {
			continue
		}

		oldRel := mustRel(moduleServerDir, filepath.Join(root, e.OldPath))
		newRel := mustRel(moduleServerDir, filepath.Join(root, e.NewPath))

		if out, err := runner.RenameFile(moduleServerDir, oldRel, newRel); err != nil {
			fmt.Fprintf(stderr, "rename-file %s -> %s failed:\n%s\n", e.OldPath, e.NewPath, out)
			result.Aborted = true
			return result, 1
		}

		if e.Symbol != "" && e.NewSymbol != "" && e.Symbol != e.NewSymbol {
			if out, err := runner.Rename(moduleServerDir, e.Symbol, e.NewSymbol); err != nil {
				fmt.Fprintf(stderr, "rename %s -> %s failed:\n%s\n", e.Symbol, e.NewSymbol, out)
				result.Aborted = true
				return result, 1
			}
		}

		diagOut, diagErr := runner.Diagnostics(moduleServerDir, newRel)
		if diagErr != nil {
			fmt.Fprintf(stderr, "diagnostics %s failed, aborting:\n%s\n", e.NewPath, diagOut)
			result.Aborted = true
			return result, 1
		}

		oldDir := filepath.Dir(filepath.Join(root, e.OldPath))
		tests, err := FindTests(oldDir, e.OldPath)
		if err != nil {
			fmt.Fprintf(stderr, "find tests for %s: %v\n", e.OldPath, err)
			continue
		}
		newTestsDir := filepath.Join(filepath.Dir(e.NewPath), "__tests__")
		for _, t := range tests {
			relT, _ := filepath.Rel(root, t)
			newT := filepath.Join(newTestsDir, filepath.Base(t))
			oldTRel := mustRel(moduleServerDir, t)
			newTRel := mustRel(moduleServerDir, filepath.Join(root, newT))
			if out, err := runner.RenameFile(moduleServerDir, oldTRel, newTRel); err != nil {
				fmt.Fprintf(stderr, "rename-file (test) %s -> %s failed:\n%s\n", relT, newT, out)
				result.Aborted = true
				return result, 1
			}
			e.Tests = append(e.Tests, newT)
		}
	}

	result.Applied = true
	result.Registry = RegistryReport(root, moduleDir, entries)
	printRegistry(stdout, result.Registry)
	return result, 0
}

func mustRel(base, target string) string {
	rel, err := filepath.Rel(base, target)
	if err != nil {
		return target
	}
	return rel
}

func printPlan(w io.Writer, entries []Entry) {
	if len(entries) == 0 {
		fmt.Fprintln(w, "no ports/adapters files found")
		return
	}
	fmt.Fprintf(w, "%-70s %-14s %-70s %-40s %s\n", "OLD PATH", "TIER", "NEW PATH", "SYMBOL", "REASON")
	for _, e := range entries {
		newPath := e.NewPath
		if newPath == "" {
			newPath = "(not moved)"
		}
		symbol := e.Symbol
		if e.NewSymbol != "" && e.NewSymbol != e.Symbol {
			symbol = e.Symbol + " -> " + e.NewSymbol
		}
		if e.Tier == TierSplit {
			symbol = "SPLIT: " + strings.Join(e.Exports, ", ")
		}
		fmt.Fprintf(w, "%-70s %-14s %-70s %-40s %s\n", e.OldPath, e.Tier, newPath, symbol, e.Reason)
	}
}
