package shapemod

import (
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// legacyTransportSymbols are the process-level builders a converted module's
// transport/ files must no longer import (ADR-133/134, feature-shape rule
// legacy-transport-runtime).
var legacyTransportSymbols = []string{
	"AppRestSecurity", "createAppRestSecurity", "SecuredApp",
	"RestApiVersionedFamily", "createTrpcService", "TrpcPolicyDecorator",
	"createServiceApp", "createVersionedApp", "createProjectVersionedApp",
	"mountProjectTransport",
}

// DeadTransportFile is one transport/ file that imports a legacy builder and
// has no importer outside its own __tests__.
type DeadTransportFile struct {
	Path       string
	Symbols    []string // legacy symbols it imports
	Exports    []string // names it exports
	Tests      []string // its own __tests__ files that reference it
	IndexRefs  []string // index.ts lines re-exporting it
	ExportsRef []string // package.json "exports" keys pointing at it
}

var exportNameRe = regexp.MustCompile(`(?m)^\s*export\s+(?:default\s+)?(?:abstract\s+class|class|interface|function|const)\s+(\w+)`)

// DeadTransports finds, and with apply deletes, transport/ files that import
// a legacy process-level builder and are imported nowhere outside their own
// __tests__.
func DeadTransports(root string, moduleDirs []string, apply bool, stdout, stderr io.Writer) []DeadTransportFile {
	var dead []DeadTransportFile
	for _, moduleDir := range moduleDirs {
		transportDir := filepath.Join(root, moduleDir, "server", "src", "transport")
		var files []string
		_ = filepath.WalkDir(transportDir, func(path string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(path, ".ts") {
				return nil
			}
			if strings.Contains(path, string(filepath.Separator)+"__tests__"+string(filepath.Separator)) {
				return nil
			}
			files = append(files, path)
			return nil
		})
		sort.Strings(files)

		for _, path := range files {
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			content := string(data)
			var hit []string
			for _, sym := range legacyTransportSymbols {
				if wordRe(sym).MatchString(content) {
					hit = append(hit, sym)
				}
			}
			if len(hit) == 0 {
				continue
			}

			exports := uniqueMatches(exportNameRe, content)
			importers := findImporters(root, exports, path, transportDir)
			indexRefs := findSelfRefs(filepath.Join(filepath.Dir(moduleServerSrc(moduleDir)), "index.ts"), path, root)
			pkgRefs := findSelfRefs(filepath.Join(root, moduleDir, "server", "package.json"), path, root)
			if len(importers) > 0 {
				continue
			}

			rel, _ := filepath.Rel(root, path)
			d := DeadTransportFile{Path: rel, Symbols: hit, Exports: exports, IndexRefs: indexRefs, ExportsRef: pkgRefs}
			d.Tests, _ = FindTests(filepath.Dir(path), path)
			for i, t := range d.Tests {
				rt, _ := filepath.Rel(root, t)
				d.Tests[i] = rt
			}
			dead = append(dead, d)
		}
	}

	printDeadTransports(stdout, dead)
	if apply {
		for _, d := range dead {
			if err := os.Remove(filepath.Join(root, d.Path)); err != nil {
				fmt.Fprintf(stderr, "remove %s: %v\n", d.Path, err)
				continue
			}
			for _, t := range d.Tests {
				_ = os.Remove(filepath.Join(root, t))
			}
			fmt.Fprintf(stdout, "removed %s (edit its index.ts/package.json/tsconfig.build entries by hand: %v %v)\n", d.Path, d.IndexRefs, d.ExportsRef)
		}
	}
	return dead
}

func moduleServerSrc(moduleDir string) string {
	return filepath.Join(moduleDir, "server", "src")
}

func wordRe(name string) *regexp.Regexp {
	return regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\b`)
}

func uniqueMatches(re *regexp.Regexp, content string) []string {
	seen := map[string]bool{}
	var out []string
	for _, m := range re.FindAllStringSubmatch(content, -1) {
		if !seen[m[1]] {
			seen[m[1]] = true
			out = append(out, m[1])
		}
	}
	return out
}

// findImporters runs `git grep` for each exported name and keeps only hits
// outside the transport file itself and its own __tests__ directory.
func findImporters(root string, exports []string, file, transportDir string) []string {
	if len(exports) == 0 {
		return nil
	}
	ownTests := filepath.Join(transportDir, "__tests__")
	var hits []string
	for _, name := range exports {
		out, _ := exec.Command("git", "-C", root, "grep", "-lw", "-F", name, "--", "*.ts", "*.tsx").Output()
		for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
			if line == "" {
				continue
			}
			abs := filepath.Join(root, line)
			if abs == file {
				continue
			}
			if strings.HasPrefix(abs, ownTests+string(filepath.Separator)) {
				continue
			}
			if strings.Contains(abs, "package.json") {
				continue
			}
			hits = append(hits, line+":"+name)
		}
	}
	return hits
}

// findSelfRefs greps one file (index.ts or package.json) for the transport
// file's basename, reporting lines that likely re-export or list it.
func findSelfRefs(path, transportFile, root string) []string {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	base := strings.TrimSuffix(filepath.Base(transportFile), filepath.Ext(transportFile))
	var refs []string
	for i, line := range strings.Split(string(data), "\n") {
		if strings.Contains(line, base) {
			relPath, _ := filepath.Rel(root, path)
			refs = append(refs, fmt.Sprintf("%s:%d", relPath, i+1))
		}
	}
	return refs
}

func printDeadTransports(w io.Writer, dead []DeadTransportFile) {
	if len(dead) == 0 {
		fmt.Fprintln(w, "no dead legacy-transport files found")
		return
	}
	for _, d := range dead {
		fmt.Fprintf(w, "%s  legacy=%v tests=%v index=%v packageExports=%v\n", d.Path, d.Symbols, d.Tests, d.IndexRefs, d.ExportsRef)
	}
}
