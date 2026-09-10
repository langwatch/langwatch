package shapemod

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
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

	if collisions := planCollisions(root, moduleDir, entries); len(collisions) > 0 {
		printCollisions(stdout, collisions)
		result.Aborted = true
		return result, 1
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
			out, err := runner.Rename(moduleServerDir, e.Symbol, e.NewSymbol)
			if err != nil && ambiguousRenameRe.MatchString(out) {
				data, readErr := os.ReadFile(filepath.Join(root, e.NewPath))
				line := -1
				if readErr == nil {
					line = declarationLine(string(data), e.Symbol)
				}
				if line == -1 {
					fmt.Fprintf(stderr, "rename %s -> %s ambiguous and its declaration line could not be found in %s:\n%s\n", e.Symbol, e.NewSymbol, e.NewPath, out)
					result.Aborted = true
					return result, 1
				}
				out, err = runner.RenameAtLine(moduleServerDir, newRel, line, e.Symbol, e.NewSymbol)
			}
			if err != nil {
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

// ambiguousRenameRe matches tslsp-cli's answer when a --symbol rename names
// more than one declaration: `ambiguous symbol "X" -- N matches. Pass
// { file, line } to disambiguate.`
var ambiguousRenameRe = regexp.MustCompile(`(?i)ambiguous symbol`)

// declarationLine finds the class/interface declaration line for one symbol
// name in a moved file's content, so an ambiguous --symbol rename can be
// retried against that file's own declaration line instead of a name.
// tslsp-cli's --line is zero-based; returns -1 when no declaration is found
// (0 is a valid line).
func declarationLine(content, symbol string) int {
	re := regexp.MustCompile(`(?m)^\s*export\s+(?:default\s+)?(?:abstract\s+class|class|interface)\s+` + regexp.QuoteMeta(symbol) + `\b`)
	loc := re.FindStringIndex(content)
	if loc == nil {
		return -1
	}
	return strings.Count(content[:loc[0]], "\n")
}

// symbolDeclRe finds any exported class/abstract-class/interface name, used
// by planCollisions to check whether a destination symbol is already
// declared somewhere else in the module.
var symbolDeclRe = regexp.MustCompile(`(?m)^\s*export\s+(?:default\s+)?(?:abstract\s+class|class|interface)\s+(\w+)\b`)

// planCollisions checks every destination path and every destination symbol
// in the whole plan against each other and against what already exists on
// disk, before anything is written. It returns one description per problem
// found, sorted, or nil when the plan is clean.
func planCollisions(root, moduleDir string, entries []Entry) []string {
	var problems []string

	destPaths := map[string][]string{}
	destSymbols := map[string][]string{}
	for _, e := range entries {
		if e.Tier == TierInfrastructure || e.Tier == TierSplit {
			continue
		}
		if e.NewPath != "" {
			destPaths[e.NewPath] = append(destPaths[e.NewPath], e.OldPath)
			if _, err := os.Stat(filepath.Join(root, e.NewPath)); err == nil {
				problems = append(problems, fmt.Sprintf("destination path %s (from %s) already exists on disk", e.NewPath, e.OldPath))
			}
		}
		if e.NewSymbol != "" {
			destSymbols[e.NewSymbol] = append(destSymbols[e.NewSymbol], e.OldPath)
		}
	}

	for path, olds := range destPaths {
		if len(olds) > 1 {
			sort.Strings(olds)
			problems = append(problems, fmt.Sprintf("destination path %s claimed by more than one file: %s", path, strings.Join(olds, ", ")))
		}
	}

	for symbol, olds := range destSymbols {
		if len(olds) > 1 {
			sort.Strings(olds)
			problems = append(problems, fmt.Sprintf("destination symbol %s claimed by more than one file: %s", symbol, strings.Join(olds, ", ")))
		}
		if existing := findSymbolElsewhere(root, moduleDir, symbol, olds); existing != "" {
			problems = append(problems, fmt.Sprintf("destination symbol %s already declared in %s", symbol, existing))
		}
	}

	sort.Strings(problems)
	return problems
}

// findSymbolElsewhere returns the repository-relative path of a file, other
// than the plan's own excludeOld paths, that already declares symbol under
// moduleDir's server/src, or "" when none does.
func findSymbolElsewhere(root, moduleDir, symbol string, excludeOld []string) string {
	excluded := map[string]bool{}
	for _, o := range excludeOld {
		excluded[filepath.Join(root, o)] = true
	}
	serverSrc := filepath.Join(root, moduleDir, "server", "src")
	var found string
	_ = filepath.WalkDir(serverSrc, func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || found != "" {
			return nil
		}
		if !strings.HasSuffix(path, ".ts") || excluded[path] {
			return nil
		}
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			return nil
		}
		for _, m := range symbolDeclRe.FindAllStringSubmatch(string(data), -1) {
			if m[1] == symbol {
				rel, _ := filepath.Rel(root, path)
				found = rel
				return nil
			}
		}
		return nil
	})
	return found
}

func printCollisions(w io.Writer, collisions []string) {
	fmt.Fprintln(w, "\naborting before any write: collisions in the plan")
	for _, c := range collisions {
		fmt.Fprintln(w, "  "+c)
	}
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
