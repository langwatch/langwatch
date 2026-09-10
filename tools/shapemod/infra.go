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

// InfraFileEntry is the verdict for one server/src/ports/*.port.ts file.
type InfraFileEntry struct {
	Path    string // repository-relative
	Tier    Tier
	Status  string // "FOLD", "SKIP", "OUT-OF-SCOPE" (not infrastructure tier)
	Reason  string
	Symbols []string // interface/type names folded from this file, when Status == FOLD
}

// InfraResult is the outcome of one `shapemod infra` run.
type InfraResult struct {
	InfraFile     string // repository-relative
	InfraCreated  bool
	InterfaceName string
	Entries       []InfraFileEntry
	MembersAdded  []string
	Applied       bool
	Aborted       bool
}

// Infra folds every infrastructure-tier ports/*.port.ts file of moduleDir
// into the module's one <F>Infrastructure interface: a fully-abstract class
// becomes an interface with the same members, a plain interface or type is
// copied as is, importers are repointed, and (with apply) the port file is
// deleted and the Port suffix dropped from its symbol via tslsp-cli rename.
func Infra(root, moduleDir string, apply bool, runner Runner, stdout, stderr io.Writer) (InfraResult, int) {
	infraPath, ifaceName, found := findInfraFile(root, moduleDir)
	result := InfraResult{InfraFile: infraPath, InterfaceName: ifaceName, InfraCreated: !found}

	portFiles := listPortFiles(root, moduleDir)
	serverSrc := filepath.Join(moduleDir, "server", "src")
	sources := CollectSources(root, serverSrc)

	var ifaceContent string
	if found {
		data, err := os.ReadFile(filepath.Join(root, infraPath))
		if err != nil {
			fmt.Fprintf(stderr, "read %s: %v\n", infraPath, err)
			return result, 1
		}
		ifaceContent = string(data)
	}

	var foldable []fileFoldPlan
	for _, p := range portFiles {
		data, err := os.ReadFile(filepath.Join(root, p))
		if err != nil {
			fmt.Fprintf(stderr, "read %s: %v\n", p, err)
			continue
		}
		content := string(data)
		c := Classify(p, content, siblingsExcluding(sources, p))
		if c.Tier != TierInfrastructure {
			result.Entries = append(result.Entries, InfraFileEntry{
				Path: p, Tier: c.Tier, Status: "OUT-OF-SCOPE",
				Reason: "classified " + string(c.Tier) + ", not infrastructure: " + c.Reason,
			})
			continue
		}
		plan := planFileFold(p, content)
		foldable = append(foldable, plan)
		entry := InfraFileEntry{Path: p, Tier: c.Tier, Status: plan.Status, Reason: plan.Reason}
		if plan.Status == "FOLD" {
			for _, b := range plan.Blocks {
				entry.Symbols = append(entry.Symbols, b.Name)
			}
		}
		result.Entries = append(result.Entries, entry)
	}

	// Members to add: every folded symbol not already referenced by type name
	// in the current infrastructure interface body.
	ifaceBody := interfaceBodyOf(ifaceContent, ifaceName)
	seen := map[string]bool{}
	var membersToAdd []string
	for _, plan := range foldable {
		if plan.Status != "FOLD" {
			continue
		}
		for _, b := range plan.Blocks {
			if b.Kind != "classToInterface" {
				continue // a plain copied `interface`/`type` is a data shape, not a collaborator
			}
			if seen[b.Name] || refersToType(ifaceBody, b.Name) {
				continue
			}
			seen[b.Name] = true
			memberName := lowerFirst(strings.TrimSuffix(b.Name, "Port"))
			membersToAdd = append(membersToAdd, memberName+": "+b.Name+";")
		}
	}
	sort.Strings(membersToAdd)
	result.MembersAdded = membersToAdd

	printInfraPlan(stdout, result, ifaceContent == "" && !found)

	if !apply {
		return result, 0
	}

	moduleServerDir := filepath.Join(root, moduleDir, "server")

	// 1. Write/create the infrastructure file with the folded declarations.
	newIfaceContent, err := applyInfraFile(root, infraPath, ifaceName, ifaceContent, found, foldable, membersToAdd)
	if err != nil {
		fmt.Fprintf(stderr, "building %s: %v\n", infraPath, err)
		result.Aborted = true
		return result, 1
	}
	if err := os.MkdirAll(filepath.Dir(filepath.Join(root, infraPath)), 0o755); err != nil {
		fmt.Fprintf(stderr, "mkdir for %s: %v\n", infraPath, err)
		result.Aborted = true
		return result, 1
	}
	if err := os.WriteFile(filepath.Join(root, infraPath), []byte(newIfaceContent), 0o644); err != nil {
		fmt.Fprintf(stderr, "write %s: %v\n", infraPath, err)
		result.Aborted = true
		return result, 1
	}

	// 2. Rewrite importers (module-internal, then the package's external
	// subpath consumers) for every folded file, then delete it.
	for _, plan := range foldable {
		if plan.Status != "FOLD" {
			continue
		}
		for _, b := range plan.Blocks {
			if err := rewriteHeritageAndImports(root, moduleDir, plan.Path, infraPath, b.Name); err != nil {
				fmt.Fprintf(stderr, "rewriting importers of %s from %s: %v\n", b.Name, plan.Path, err)
				result.Aborted = true
				return result, 1
			}
			if err := rewriteExternalSubpathImports(root, moduleDir, plan.Path, b.Name); err != nil {
				fmt.Fprintf(stderr, "rewriting external importers of %s: %v\n", b.Name, err)
				result.Aborted = true
				return result, 1
			}
		}
		if err := os.Remove(filepath.Join(root, plan.Path)); err != nil {
			fmt.Fprintf(stderr, "delete %s: %v\n", plan.Path, err)
			result.Aborted = true
			return result, 1
		}
	}

	// 3. Diagnostics over the whole module before renaming.
	if out, err := runDiagnosticsGlob(runner, moduleServerDir); err != nil {
		fmt.Fprintf(stderr, "diagnostics failed after folding, aborting (nothing restored, the operator has git):\n%s\n", out)
		result.Aborted = true
		return result, 1
	}

	// 4. Drop the Port suffix from every folded symbol.
	for _, plan := range foldable {
		if plan.Status != "FOLD" {
			continue
		}
		for _, b := range plan.Blocks {
			if b.Kind != "interface" && b.Kind != "classToInterface" {
				continue
			}
			newName := strings.TrimSuffix(b.Name, "Port")
			if newName == b.Name || newName == "" {
				continue
			}
			if collides(root, moduleDir, newName, b.Name) {
				fmt.Fprintf(stdout, "skipping rename %s -> %s: a declaration already named %s exists\n", b.Name, newName, newName)
				continue
			}
			out, err := runner.Rename(moduleServerDir, b.Name, newName)
			if err != nil && ambiguousRenameRe.MatchString(out) {
				line := declarationLine(newIfaceContent, b.Name)
				if line == -1 {
					fmt.Fprintf(stderr, "rename %s -> %s ambiguous and its declaration line could not be found in %s:\n%s\n", b.Name, newName, infraPath, out)
					result.Aborted = true
					return result, 1
				}
				infraRel := mustRel(moduleServerDir, filepath.Join(root, infraPath))
				out, err = runner.RenameAtLine(moduleServerDir, infraRel, line, b.Name, newName)
			}
			if err != nil {
				fmt.Fprintf(stderr, "rename %s -> %s failed:\n%s\n", b.Name, newName, out)
				result.Aborted = true
				return result, 1
			}
		}
	}

	// 5. Diagnostics once more after every rename.
	if out, err := runDiagnosticsGlob(runner, moduleServerDir); err != nil {
		fmt.Fprintf(stderr, "diagnostics failed after renaming, aborting (nothing restored, the operator has git):\n%s\n", out)
		result.Aborted = true
		return result, 1
	}

	result.Applied = true
	return result, 0
}

// runDiagnosticsGlob shells out to tslsp-cli diagnostics for every .ts file
// under dir/src, the way the lane brief's step 4 asks ('src/**/*.ts').
func runDiagnosticsGlob(runner Runner, dir string) (string, error) {
	return runner.Diagnostics(dir, "src/**/*.ts")
}

// collides reports whether newName is already declared anywhere under
// moduleDir/server/src other than as the very symbol being renamed.
func collides(root, moduleDir, newName, oldName string) bool {
	if newName == oldName {
		return false
	}
	return findSymbolElsewhere(root, moduleDir, newName, nil) != ""
}

func lowerFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToLower(s[:1]) + s[1:]
}

// findInfraFile looks for an existing app/<m>.infrastructure.ts, or an
// exported <F>Infrastructure / <F>AppInfrastructure interface anywhere under
// app/. Returns the default create-path when neither exists.
func findInfraFile(root, moduleDir string) (path, interfaceName string, found bool) {
	f := pascalCase(filepath.Base(moduleDir))
	candidates := []string{f + "Infrastructure", f + "AppInfrastructure"}
	appDir := filepath.Join(root, moduleDir, "server", "src", "app")

	defaultRel := filepath.Join(moduleDir, "server", "src", "app", filepath.Base(moduleDir)+".infrastructure.ts")
	if data, err := os.ReadFile(filepath.Join(root, defaultRel)); err == nil {
		for _, cand := range candidates {
			if interfaceDeclRe(cand).MatchString(string(data)) {
				return defaultRel, cand, true
			}
		}
	}

	var resultPath, resultIface string
	_ = filepath.WalkDir(appDir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || resultPath != "" {
			return nil
		}
		if !strings.HasSuffix(p, ".ts") || strings.Contains(p, string(filepath.Separator)+"__tests__"+string(filepath.Separator)) {
			return nil
		}
		data, rerr := os.ReadFile(p)
		if rerr != nil {
			return nil
		}
		content := string(data)
		for _, cand := range candidates {
			if interfaceDeclRe(cand).MatchString(content) {
				rel, _ := filepath.Rel(root, p)
				resultPath, resultIface = rel, cand
				return nil
			}
		}
		return nil
	})
	if resultPath != "" {
		return resultPath, resultIface, true
	}
	return defaultRel, f + "Infrastructure", false
}

func interfaceDeclRe(name string) *regexp.Regexp {
	return regexp.MustCompile(`(?m)^export\s+interface\s+` + regexp.QuoteMeta(name) + `\b`)
}

func listPortFiles(root, moduleDir string) []string {
	dir := filepath.Join(root, moduleDir, "server", "src", "ports")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var files []string
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".port.ts") {
			continue
		}
		files = append(files, filepath.Join(moduleDir, "server", "src", "ports", e.Name()))
	}
	sort.Strings(files)
	return files
}

func printInfraPlan(w io.Writer, r InfraResult, willCreate bool) {
	verb := "existing"
	if willCreate {
		verb = "new (created on --apply)"
	}
	fmt.Fprintf(w, "infrastructure file: %s (%s interface %s)\n\n", r.InfraFile, verb, r.InterfaceName)
	if len(r.Entries) == 0 {
		fmt.Fprintln(w, "no ports/*.port.ts files found")
		return
	}
	fmt.Fprintf(w, "%-70s %-12s %-40s %s\n", "PORT FILE", "STATUS", "SYMBOLS", "REASON")
	for _, e := range r.Entries {
		symbols := strings.Join(e.Symbols, ", ")
		fmt.Fprintf(w, "%-70s %-12s %-40s %s\n", e.Path, e.Status, symbols, e.Reason)
	}
	if len(r.MembersAdded) > 0 {
		fmt.Fprintln(w, "\nmembers to add to "+r.InterfaceName+":")
		for _, m := range r.MembersAdded {
			fmt.Fprintln(w, "  "+m)
		}
	} else {
		fmt.Fprintln(w, "\nno new members needed: every folded type is already referenced in "+r.InterfaceName)
	}
}
